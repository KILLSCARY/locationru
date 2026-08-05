import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import type { DriverEligibilityService } from '../drivers/driver-eligibility.service.js';
import {
  DocumentStatus,
  DriverOperationalStatus,
  DriverVerificationStatus,
  VehicleVerificationStatus,
} from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import type { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { DocumentExpirationWorker } from './document-expiration.worker.js';

const DRIVER_ID = 'driver-1';
const VEHICLE_ID = 'vehicle-1';

const CONFIG = new ConfigService({
  app: { environment: 'test' },
  documents: {
    expirationCheckIntervalMs: 3_600_000,
    expirationWarningDays: [30, 14, 7, 1],
  },
});

class InMemoryPrisma {
  driverDocuments: Array<Record<string, unknown>> = [];
  vehicleDocuments: Array<Record<string, unknown>> = [];
  profile: Record<string, unknown> = {
    userId: DRIVER_ID,
    verificationStatus: DriverVerificationStatus.APPROVED,
    operationalStatus: DriverOperationalStatus.ONLINE,
  };
  vehicleRow: Record<string, unknown> = {
    id: VEHICLE_ID,
    driverId: DRIVER_ID,
    verificationStatus: VehicleVerificationStatus.APPROVED,
  };
  activeTrip: Record<string, unknown> | null = null;

  readonly driverDocument = {
    findMany: async ({
      where,
    }: {
      where: { status: DocumentStatus; expiresAt: { lte?: Date; gt?: Date } };
    }) =>
      this.driverDocuments.filter((doc) => {
        if (doc.status !== where.status) return false;
        const expiresAt = doc.expiresAt as Date;
        if (
          where.expiresAt.lte &&
          expiresAt.getTime() > where.expiresAt.lte.getTime()
        )
          return false;
        if (
          where.expiresAt.gt &&
          expiresAt.getTime() <= where.expiresAt.gt.getTime()
        )
          return false;
        return true;
      }),
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const doc = this.driverDocuments.find((d) => d.id === where.id);
      Object.assign(doc as object, data);
      return doc;
    },
  };

  readonly vehicleDocument = {
    findMany: async ({
      where,
    }: {
      where: { status: DocumentStatus; expiresAt: { lte?: Date; gt?: Date } };
    }) =>
      this.vehicleDocuments
        .filter((doc) => {
          if (doc.status !== where.status) return false;
          const expiresAt = doc.expiresAt as Date;
          if (
            where.expiresAt.lte &&
            expiresAt.getTime() > where.expiresAt.lte.getTime()
          )
            return false;
          if (
            where.expiresAt.gt &&
            expiresAt.getTime() <= where.expiresAt.gt.getTime()
          )
            return false;
          return true;
        })
        .map((doc) => ({ ...doc, vehicle: this.vehicleRow })),
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const doc = this.vehicleDocuments.find((d) => d.id === where.id);
      Object.assign(doc as object, data);
      return doc;
    },
  };

  readonly driverProfile = {
    findUnique: async () => this.profile,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(this.profile, data);
      return this.profile;
    },
  };

  readonly vehicle = {
    update: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(this.vehicleRow, data);
      return this.vehicleRow;
    },
  };

  readonly trip = {
    findFirst: async () => this.activeTrip,
  };
}

describe('DocumentExpirationWorker', () => {
  let prisma: InMemoryPrisma;
  let metrics: MetricsService;
  let eligible: boolean;
  let notifyCalls: unknown[];
  let worker: DocumentExpirationWorker;

  beforeEach(() => {
    prisma = new InMemoryPrisma();
    metrics = new MetricsService();
    eligible = false;
    notifyCalls = [];

    const fakeEligibility = {
      evaluateDriverEligibility: async () => ({
        eligible,
        blockingReasons: eligible ? [] : ['DOCUMENT_EXPIRED'],
        warnings: [],
        expiresSoon: false,
        approvedVehicleIds: [],
      }),
    } as unknown as DriverEligibilityService;
    const fakeNotifications = {
      createDraft: (input: unknown) => input,
    } as unknown as NotificationService;
    const fakeOutbox = {
      enqueue: async (_client: unknown, draft: unknown) => {
        notifyCalls.push(draft);
      },
    } as unknown as NotificationOutboxService;

    worker = new DocumentExpirationWorker(
      CONFIG,
      prisma as unknown as PrismaService,
      fakeEligibility,
      fakeNotifications,
      fakeOutbox,
      metrics,
    );
  });

  it('expires an approved driver document past its expiresAt and reverts the profile', async () => {
    prisma.driverDocuments.push({
      id: 'doc-1',
      driverId: DRIVER_ID,
      status: DocumentStatus.APPROVED,
      expiresAt: new Date(Date.now() - 1_000),
    });

    await worker.runCheck();

    expect(prisma.driverDocuments[0].status).toBe(DocumentStatus.EXPIRED);
    expect(prisma.profile.verificationStatus).toBe(
      DriverVerificationStatus.EXPIRED,
    );
  });

  it('forces an ineligible online driver offline once no trip is active', async () => {
    prisma.driverDocuments.push({
      id: 'doc-1',
      driverId: DRIVER_ID,
      status: DocumentStatus.APPROVED,
      expiresAt: new Date(Date.now() - 1_000),
    });

    await worker.runCheck();

    expect(prisma.profile.operationalStatus).toBe(
      DriverOperationalStatus.OFFLINE,
    );
  });

  it('never interrupts a driver mid-trip even if newly ineligible', async () => {
    prisma.activeTrip = { id: 'trip-1' };
    prisma.driverDocuments.push({
      id: 'doc-1',
      driverId: DRIVER_ID,
      status: DocumentStatus.APPROVED,
      expiresAt: new Date(Date.now() - 1_000),
    });

    await worker.runCheck();

    expect(prisma.profile.operationalStatus).toBe(
      DriverOperationalStatus.ONLINE,
    );
  });

  it('expires an approved vehicle document and the vehicle itself', async () => {
    prisma.vehicleDocuments.push({
      id: 'vdoc-1',
      type: 'VEHICLE_REGISTRATION_FRONT',
      status: DocumentStatus.APPROVED,
      expiresAt: new Date(Date.now() - 1_000),
    });

    await worker.runCheck();

    expect(prisma.vehicleDocuments[0].status).toBe(DocumentStatus.EXPIRED);
    expect(prisma.vehicleRow.verificationStatus).toBe(
      VehicleVerificationStatus.EXPIRED,
    );
  });

  it('enqueues a single expiry warning for a document inside the warning window', async () => {
    prisma.driverDocuments.push({
      id: 'doc-2',
      driverId: DRIVER_ID,
      status: DocumentStatus.APPROVED,
      expiresAt: new Date(Date.now() + 5 * 86_400_000),
    });

    await worker.runCheck();

    expect(notifyCalls).toHaveLength(1);
  });

  it('does not warn about a document outside every configured window', async () => {
    prisma.driverDocuments.push({
      id: 'doc-3',
      driverId: DRIVER_ID,
      status: DocumentStatus.APPROVED,
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    });

    await worker.runCheck();

    expect(notifyCalls).toHaveLength(0);
  });
});
