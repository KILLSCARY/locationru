import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { DriverEligibilityService } from '../drivers/driver-eligibility.service.js';
import {
  DocumentStatus,
  DriverOperationalStatus,
  DriverVerificationStatus,
  NotificationType,
  TripStatus,
  VehicleVerificationStatus,
} from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { NotificationService } from '../notifications/notification.service.js';

const ACTIVE_TRIP_STATUSES: TripStatus[] = [
  TripStatus.DRIVER_SELECTED,
  TripStatus.PAYMENT_PENDING,
  TripStatus.PAYMENT_RESERVED,
  TripStatus.DRIVER_EN_ROUTE,
  TripStatus.DRIVER_ARRIVED,
  TripStatus.IN_PROGRESS,
];

/**
 * Task 29 section 18. Polls approved driver/vehicle documents for two
 * things on every tick: (1) an expiresAt that has already passed — the
 * document (and its parent profile/vehicle, if it was APPROVED) moves to
 * EXPIRED, and the driver is forced OFFLINE only if they have no active
 * trip right now (an in-progress trip is never interrupted — see
 * docs/drivers/document-expiration.md); (2) an expiresAt inside one of the
 * configured warning windows, which enqueues a DRIVER_DOCUMENT_EXPIRING
 * push. Push de-duplication is handled by NotificationOutboxService's
 * existing per-deduplicationKey check, keyed by (documentId, thresholdDay),
 * so re-running this tick never double-sends a warning.
 */
@Injectable()
export class DocumentExpirationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentExpirationWorker.name);
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly eligibility: DriverEligibilityService,
    private readonly notifications: NotificationService,
    private readonly notificationOutbox: NotificationOutboxService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    if (this.config.getOrThrow<string>('app.environment') === 'test') return;
    const intervalMs = this.config.getOrThrow<number>(
      'documents.expirationCheckIntervalMs',
    );
    this.pollTimer = setInterval(() => {
      void this.runCheck().catch((error: unknown) => {
        this.logger.error({
          event: 'documents.expiration_check_failed',
          error,
        });
      });
    }, intervalMs);
    this.pollTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  isRunning(): boolean {
    if (this.config.getOrThrow<string>('app.environment') === 'test') {
      return true;
    }
    return this.pollTimer !== undefined;
  }

  async runCheck(): Promise<void> {
    await this.processExpiredDriverDocuments();
    await this.processExpiredVehicleDocuments();
    await this.processExpiringWarnings();
  }

  private async processExpiredDriverDocuments(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.driverDocument.findMany({
      where: {
        status: DocumentStatus.APPROVED,
        expiresAt: { lte: now },
      },
    });

    for (const document of expired) {
      await this.prisma.driverDocument.update({
        where: { id: document.id },
        data: { status: DocumentStatus.EXPIRED },
      });
      const profile = await this.prisma.driverProfile.findUnique({
        where: { userId: document.driverId },
      });
      if (profile?.verificationStatus === DriverVerificationStatus.APPROVED) {
        await this.prisma.driverProfile.update({
          where: { userId: document.driverId },
          data: { verificationStatus: DriverVerificationStatus.EXPIRED },
        });
      }
      this.metrics.increment(
        'document_expired_total',
        'Documents that crossed their expiresAt date while still APPROVED',
        { documentKind: 'driver' },
      );
      await this.forceOfflineIfIneligibleAndIdle(document.driverId);
    }
  }

  private async processExpiredVehicleDocuments(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.vehicleDocument.findMany({
      where: {
        status: DocumentStatus.APPROVED,
        expiresAt: { lte: now },
      },
      include: {
        vehicle: {
          select: { id: true, driverId: true, verificationStatus: true },
        },
      },
    });

    for (const document of expired) {
      await this.prisma.vehicleDocument.update({
        where: { id: document.id },
        data: { status: DocumentStatus.EXPIRED },
      });
      if (
        document.vehicle.verificationStatus ===
        VehicleVerificationStatus.APPROVED
      ) {
        await this.prisma.vehicle.update({
          where: { id: document.vehicle.id },
          data: { verificationStatus: VehicleVerificationStatus.EXPIRED },
        });
      }
      this.metrics.increment(
        'document_expired_total',
        'Documents that crossed their expiresAt date while still APPROVED',
        { documentKind: 'vehicle' },
      );
      await this.forceOfflineIfIneligibleAndIdle(document.vehicle.driverId);
    }
  }

  /** Re-derives eligibility through the single source of truth rather than re-deriving its own rules — see DriverEligibilityService. */
  private async forceOfflineIfIneligibleAndIdle(
    driverId: string,
  ): Promise<void> {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
      select: { operationalStatus: true },
    });
    if (profile?.operationalStatus !== DriverOperationalStatus.ONLINE) return;

    const result = await this.eligibility.evaluateDriverEligibility(driverId);
    if (result.eligible) return;

    const activeTrip = await this.prisma.trip.findFirst({
      where: {
        selectedDriverId: driverId,
        status: { in: ACTIVE_TRIP_STATUSES },
      },
      select: { id: true },
    });
    if (activeTrip) return; // never interrupt a trip in progress

    await this.prisma.driverProfile.update({
      where: { userId: driverId },
      data: { operationalStatus: DriverOperationalStatus.OFFLINE },
    });
  }

  private async processExpiringWarnings(): Promise<void> {
    const warningDays = this.config
      .getOrThrow<number[]>('documents.expirationWarningDays')
      .slice()
      .sort((a, b) => a - b);
    if (warningDays.length === 0) return;
    const widestWindowDays = warningDays[warningDays.length - 1] as number;
    const now = Date.now();
    const horizon = new Date(now + widestWindowDays * 86_400_000);

    const driverDocuments = await this.prisma.driverDocument.findMany({
      where: {
        status: DocumentStatus.APPROVED,
        expiresAt: { gt: new Date(now), lte: horizon },
      },
    });
    for (const document of driverDocuments) {
      await this.enqueueExpiryWarning(
        document.driverId,
        document.id,
        document.expiresAt as Date,
        warningDays,
      );
    }

    const vehicleDocuments = await this.prisma.vehicleDocument.findMany({
      where: {
        status: DocumentStatus.APPROVED,
        expiresAt: { gt: new Date(now), lte: horizon },
      },
      include: { vehicle: { select: { driverId: true } } },
    });
    for (const document of vehicleDocuments) {
      await this.enqueueExpiryWarning(
        document.vehicle.driverId,
        document.id,
        document.expiresAt as Date,
        warningDays,
      );
    }
  }

  private async enqueueExpiryWarning(
    driverId: string,
    documentId: string,
    expiresAt: Date,
    warningDays: number[],
  ): Promise<void> {
    const daysUntilExpiry = Math.ceil(
      (expiresAt.getTime() - Date.now()) / 86_400_000,
    );
    // The smallest configured threshold that still covers the remaining
    // days — e.g. with [30,14,7,1] and 10 days left, bucket is 14 (already
    // past the 30-day warning, not yet inside the 7-day one).
    const bucket = warningDays.find((days) => daysUntilExpiry <= days);
    if (bucket === undefined) return;

    const draft = this.notifications.createDraft({
      userId: driverId,
      type: NotificationType.DRIVER_DOCUMENT_EXPIRING,
      application: 'DRIVER' as never,
      entityType: 'DOCUMENT',
      entityId: documentId,
      idempotencyKey: `document-expiring:${documentId}:${bucket}`,
      templateParams: {},
    });
    await this.notificationOutbox.enqueue(this.prisma, draft);
  }
}
