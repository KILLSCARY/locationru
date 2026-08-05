import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import {
  DocumentStatus,
  DocumentVersionStatus,
  DriverVerificationStatus,
  VehicleStatus,
  VehicleVerificationStatus,
  VerificationCasePriority,
  VerificationCaseStatus,
} from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import {
  DriverConsentService,
  REQUIRED_CONSENT_TYPES,
} from './driver-consent.service.js';
import { DriverDuplicateDetectionService } from './driver-duplicate-detection.service.js';

/** Case statuses where a driver may not submit a second time — see the VerificationCase model comment in schema.prisma. */
const OPEN_CASE_STATUSES = [
  VerificationCaseStatus.CREATED,
  VerificationCaseStatus.QUEUED,
  VerificationCaseStatus.ASSIGNED,
  VerificationCaseStatus.IN_REVIEW,
  VerificationCaseStatus.CHANGES_REQUESTED,
  VerificationCaseStatus.ESCALATED,
];

/** Mirrors the QUEUE_STATUSES list in VerificationAdminService — the population verification_queue_size reports on. */
const QUEUE_STATUSES = [
  VerificationCaseStatus.CREATED,
  VerificationCaseStatus.QUEUED,
  VerificationCaseStatus.ASSIGNED,
  VerificationCaseStatus.IN_REVIEW,
  VerificationCaseStatus.ESCALATED,
];

export type SubmissionBlockingReason =
  | 'PROFILE_INCOMPLETE'
  | 'REQUIRED_DRIVER_DOCUMENT_NOT_READY'
  | 'NO_ELIGIBLE_VEHICLE'
  | 'CONSENT_MISSING'
  | 'CASE_ALREADY_OPEN';

/**
 * Task 29 section 12 — the endpoint a driver calls once profile, vehicle and
 * documents are all in place. There is no automated approval anywhere in
 * this system: submitting only opens a VerificationCase for a human admin
 * to review (task 93/94 builds the admin side).
 */
@Injectable()
export class VerificationSubmissionService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly consents: DriverConsentService,
    private readonly duplicateDetection: DriverDuplicateDetectionService,
    private readonly metrics: MetricsService,
  ) {}

  async submit(driverId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
    });
    if (!profile || !profile.birthDate) {
      throw new ConflictException({
        code: 'VERIFICATION_NOT_SUBMITTABLE',
        message: 'The driver profile must be completed before submitting',
        blockingReasons: ['PROFILE_INCOMPLETE'] as SubmissionBlockingReason[],
      });
    }

    const openCase = await this.prisma.verificationCase.findFirst({
      where: { driverId, status: { in: OPEN_CASE_STATUSES } },
      select: { id: true },
    });
    if (openCase) {
      throw new ConflictException({
        code: 'VERIFICATION_NOT_SUBMITTABLE',
        message: 'A verification case is already open for this driver',
        blockingReasons: ['CASE_ALREADY_OPEN'] as SubmissionBlockingReason[],
      });
    }

    const requiredDriverTypes = this.config.getOrThrow<string[]>(
      'driverVerification.requiredDriverDocumentTypes',
    );
    const driverDocuments = await this.readyDocumentsByFamily(
      requiredDriverTypes.map((type) => `driver:${driverId}:${type}`),
    );
    const driverDocumentsReady = requiredDriverTypes.every((type) =>
      driverDocuments.has(`driver:${driverId}:${type}`),
    );
    if (!driverDocumentsReady) {
      throw new ConflictException({
        code: 'VERIFICATION_NOT_SUBMITTABLE',
        message: 'All required driver documents must finish processing first',
        blockingReasons: [
          'REQUIRED_DRIVER_DOCUMENT_NOT_READY',
        ] as SubmissionBlockingReason[],
      });
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: { driverId, status: { not: VehicleStatus.ARCHIVED } },
      select: { id: true },
    });
    const requiredVehicleTypes = this.config.getOrThrow<string[]>(
      'driverVerification.requiredVehicleDocumentTypes',
    );
    let eligibleVehicleId: string | null = null;
    for (const vehicle of vehicles) {
      const families = requiredVehicleTypes.map(
        (type) => `vehicle:${vehicle.id}:${type}`,
      );
      const ready = await this.readyDocumentsByFamily(families);
      if (
        requiredVehicleTypes.every((type) =>
          ready.has(`vehicle:${vehicle.id}:${type}`),
        )
      ) {
        eligibleVehicleId = vehicle.id;
        break;
      }
    }
    if (!eligibleVehicleId) {
      throw new ConflictException({
        code: 'VERIFICATION_NOT_SUBMITTABLE',
        message:
          'At least one vehicle with all required documents ready is required',
        blockingReasons: ['NO_ELIGIBLE_VEHICLE'] as SubmissionBlockingReason[],
      });
    }

    const activeConsents = await this.consents.getActiveConsentTypes(driverId);
    const consentGiven = REQUIRED_CONSENT_TYPES.every((type) =>
      activeConsents.has(type),
    );
    if (!consentGiven) {
      throw new ConflictException({
        code: 'VERIFICATION_NOT_SUBMITTABLE',
        message: 'Required consents have not all been given',
        blockingReasons: ['CONSENT_MISSING'] as SubmissionBlockingReason[],
      });
    }

    const snapshot = {
      submittedAt: new Date().toISOString(),
      profile: {
        firstName: profile.firstName,
        lastName: profile.lastName,
        middleName: profile.middleName,
        birthDate: profile.birthDate.toISOString(),
        cityId: profile.cityId,
      },
      vehicleId: eligibleVehicleId,
      requiredDriverDocumentTypes: requiredDriverTypes,
      requiredVehicleDocumentTypes: requiredVehicleTypes,
    };

    // Never blocks submission itself — only informs the admin queue (Task
    // 29 section 19/20: a duplicate signal never auto-blocks on its own).
    const duplicateCheckResult =
      await this.duplicateDetection.checkForDuplicates(driverId);

    const verificationCase = await this.prisma.$transaction(async (tx) => {
      const createdCase = await tx.verificationCase.create({
        data: {
          driverId,
          status: VerificationCaseStatus.QUEUED,
          submittedSnapshot: snapshot,
          duplicateCheckResult: duplicateCheckResult as never,
          priority:
            duplicateCheckResult.result === 'MANUAL_REVIEW_REQUIRED' ||
            duplicateCheckResult.result === 'STRONG_MATCH'
              ? VerificationCasePriority.HIGH
              : VerificationCasePriority.NORMAL,
        },
      });
      await tx.driverProfile.update({
        where: { userId: driverId },
        data: {
          verificationStatus: DriverVerificationStatus.DOCUMENTS_SUBMITTED,
        },
      });
      await tx.vehicle.update({
        where: { id: eligibleVehicleId as string },
        data: { verificationStatus: VehicleVerificationStatus.SUBMITTED },
      });
      return createdCase;
    });

    this.metrics.increment(
      'driver_verification_submitted_total',
      'Driver verification submissions that opened a new VerificationCase',
    );
    const queueSize = await this.prisma.verificationCase.count({
      where: { status: { in: QUEUE_STATUSES } },
    });
    this.metrics.setGauge(
      'verification_queue_size',
      'Number of VerificationCase rows currently awaiting or under admin review',
      {},
      queueSize,
    );

    return {
      caseId: verificationCase.id,
      status: verificationCase.status,
      submittedAt: verificationCase.createdAt,
    };
  }

  /** Families whose currently-ACTIVE DocumentVersion points at a driver/vehicle document that has actually finished the processing pipeline (READY_FOR_REVIEW) — a still-UPLOADING/PROCESSING/FAILED row does not count as ready. */
  private async readyDocumentsByFamily(
    families: string[],
  ): Promise<Set<string>> {
    if (families.length === 0) return new Set();
    const versions = await this.prisma.documentVersion.findMany({
      where: {
        status: DocumentVersionStatus.ACTIVE,
        documentFamily: { in: families },
      },
      include: {
        driverDocument: { select: { status: true } },
        vehicleDocument: { select: { status: true } },
      },
    });
    const ready = new Set<string>();
    for (const version of versions) {
      const status =
        version.driverDocument?.status ?? version.vehicleDocument?.status;
      if (
        status === DocumentStatus.READY_FOR_REVIEW ||
        status === DocumentStatus.APPROVED
      ) {
        ready.add(version.documentFamily);
      }
    }
    return ready;
  }
}
