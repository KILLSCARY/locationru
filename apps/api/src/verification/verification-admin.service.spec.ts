import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import type { DocumentVersionService } from '../driver-documents/document-version.service.js';
import {
  DocumentRejectionReasonCode,
  DocumentStatus,
  DriverVerificationStatus,
  VehicleVerificationStatus,
  VerificationCaseStatus,
} from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import type { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { ObjectStorageProvider } from '../storage/object-storage-provider.interface.js';
import { VerificationAdminService } from './verification-admin.service.js';

const ADMIN_ID = 'admin-1';
const DRIVER_ID = 'driver-1';
const VEHICLE_ID = 'vehicle-1';
const CASE_ID = 'case-1';
const REQUIRED_DRIVER_TYPES = ['PASSPORT_MAIN_PAGE'];
const REQUIRED_VEHICLE_TYPES = ['VEHICLE_REGISTRATION_FRONT'];

const CONFIG = new ConfigService({
  driverVerification: {
    requiredDriverDocumentTypes: REQUIRED_DRIVER_TYPES,
    requiredVehicleDocumentTypes: REQUIRED_VEHICLE_TYPES,
  },
});

class InMemoryPrisma {
  verificationCases: Record<string, Record<string, unknown>> = {
    [CASE_ID]: {
      id: CASE_ID,
      driverId: DRIVER_ID,
      status: VerificationCaseStatus.ASSIGNED,
      assignedAdminId: ADMIN_ID,
      submittedSnapshot: { vehicleId: VEHICLE_ID },
      createdAt: new Date(),
    },
  };
  profile: Record<string, unknown> = {
    userId: DRIVER_ID,
    verificationStatus: DriverVerificationStatus.UNDER_REVIEW,
  };
  vehicle: Record<string, unknown> = {
    id: VEHICLE_ID,
    driverId: DRIVER_ID,
    verificationStatus: VehicleVerificationStatus.UNDER_REVIEW,
  };
  driverDocuments: Record<string, Record<string, unknown>> = {
    'doc-1': {
      id: 'doc-1',
      driverId: DRIVER_ID,
      type: 'PASSPORT_MAIN_PAGE',
      status: DocumentStatus.READY_FOR_REVIEW,
    },
  };
  auditLogs: Array<Record<string, unknown>> = [];

  readonly verificationCase = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.verificationCases[where.id] ?? null,
    findFirst: async () => null,
    findMany: async () => Object.values(this.verificationCases),
    count: async () => Object.keys(this.verificationCases).length,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      Object.assign(this.verificationCases[where.id] as object, data);
      return this.verificationCases[where.id];
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
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === VEHICLE_ID ? this.vehicle : null,
    findMany: async () => [this.vehicle],
    update: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(this.vehicle, data);
      return this.vehicle;
    },
  };

  readonly driverDocument = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.driverDocuments[where.id] ?? null,
    findMany: async ({
      where,
    }: {
      where: { type: { in: string[] }; status: DocumentStatus };
    }) =>
      Object.values(this.driverDocuments).filter(
        (doc) =>
          where.type.in.includes(doc.type as string) &&
          doc.status === where.status,
      ),
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      Object.assign(this.driverDocuments[where.id] as object, data);
      return this.driverDocuments[where.id];
    },
  };

  readonly vehicleDocument = {
    findUnique: async () => null,
    findMany: async () => [],
    update: async () => ({}),
  };

  readonly adminAuditLog = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.auditLogs.push(data);
      return data;
    },
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe('VerificationAdminService', () => {
  let prisma: InMemoryPrisma;
  let metrics: MetricsService;
  let notifyCalls: unknown[];
  let service: VerificationAdminService;

  beforeEach(() => {
    prisma = new InMemoryPrisma();
    metrics = new MetricsService();
    notifyCalls = [];

    const fakeDocumentVersions = {
      activateVersion: async () => undefined,
    } as unknown as DocumentVersionService;
    const fakeNotifications = {
      createDraft: (input: unknown) => input,
    } as unknown as NotificationService;
    const fakeOutbox = {
      enqueue: async (_client: unknown, draft: unknown) => {
        notifyCalls.push(draft);
      },
    } as unknown as NotificationOutboxService;
    const fakeStorage = {
      createSecureDownloadUrl: async (objectKey: string) => ({
        url: `https://example.test/${objectKey}`,
        expiresInSeconds: 60,
      }),
    } as unknown as ObjectStorageProvider;

    service = new VerificationAdminService(
      CONFIG,
      prisma as unknown as PrismaService,
      fakeDocumentVersions,
      metrics,
      fakeNotifications,
      fakeOutbox,
      fakeStorage,
    );
  });

  it('refuses to act on a case not assigned to the acting admin', async () => {
    prisma.verificationCases[CASE_ID].assignedAdminId = 'someone-else';

    const error = await captureError(service.startReview(ADMIN_ID, CASE_ID));

    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({
      code: 'CASE_NOT_ASSIGNED_TO_YOU',
    });
  });

  it('moves an assigned case into review and marks profile/vehicle UNDER_REVIEW', async () => {
    await service.startReview(ADMIN_ID, CASE_ID);

    expect(prisma.verificationCases[CASE_ID].status).toBe(
      VerificationCaseStatus.IN_REVIEW,
    );
    expect(prisma.profile.verificationStatus).toBe(
      DriverVerificationStatus.UNDER_REVIEW,
    );
  });

  it('approves a document and clears any prior rejection reason', async () => {
    await service.approveDocument(ADMIN_ID, CASE_ID, 'DRIVER', 'doc-1');

    expect(prisma.driverDocuments['doc-1'].status).toBe(
      DocumentStatus.APPROVED,
    );
    expect(prisma.driverDocuments['doc-1'].rejectionReasonCode).toBeNull();
  });

  it('requires a comment when rejecting with OTHER', async () => {
    const error = await captureError(
      service.rejectDocument(ADMIN_ID, CASE_ID, 'DRIVER', 'doc-1', {
        reasonCode: DocumentRejectionReasonCode.OTHER,
      }),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({
      code: 'COMMENT_REQUIRED_FOR_OTHER',
    });
  });

  it('rejects a document with a named reason and no comment required', async () => {
    await service.rejectDocument(ADMIN_ID, CASE_ID, 'DRIVER', 'doc-1', {
      reasonCode: DocumentRejectionReasonCode.DOCUMENT_UNREADABLE,
    });

    expect(prisma.driverDocuments['doc-1'].status).toBe(
      DocumentStatus.REJECTED,
    );
  });

  it('refuses to approve the driver until the case is IN_REVIEW', async () => {
    const error = await captureError(service.approveDriver(ADMIN_ID, CASE_ID));

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code: 'CASE_NOT_IN_REVIEW' });
  });

  it('refuses to approve the driver while documents or the vehicle are not approved', async () => {
    await service.startReview(ADMIN_ID, CASE_ID);

    const error = await captureError(service.approveDriver(ADMIN_ID, CASE_ID));

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'DRIVER_NOT_APPROVABLE',
    });
  });

  it('approves the driver once every required document and the vehicle are approved, and sends a push', async () => {
    await service.startReview(ADMIN_ID, CASE_ID);
    prisma.driverDocuments['doc-1'].status = DocumentStatus.APPROVED;
    prisma.vehicle.verificationStatus = VehicleVerificationStatus.APPROVED;

    await service.approveDriver(ADMIN_ID, CASE_ID);

    expect(prisma.profile.verificationStatus).toBe(
      DriverVerificationStatus.APPROVED,
    );
    expect(prisma.verificationCases[CASE_ID].status).toBe(
      VerificationCaseStatus.APPROVED,
    );
    expect(notifyCalls).toHaveLength(1);
  });

  it('escalates a case and bumps its priority', async () => {
    await service.escalate(ADMIN_ID, CASE_ID, {});

    expect(prisma.verificationCases[CASE_ID].status).toBe(
      VerificationCaseStatus.ESCALATED,
    );
  });

  it('only suspends a currently-approved driver', async () => {
    const error = await captureError(
      service.suspendDriver(ADMIN_ID, DRIVER_ID, { comment: 'fraud report' }),
    );

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code: 'DRIVER_NOT_ACTIVE' });
  });

  it('suspends an approved driver', async () => {
    prisma.profile.verificationStatus = DriverVerificationStatus.APPROVED;

    await service.suspendDriver(ADMIN_ID, DRIVER_ID, {
      comment: 'fraud report',
    });

    expect(prisma.profile.verificationStatus).toBe(
      DriverVerificationStatus.SUSPENDED,
    );
  });
});

async function captureError(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }

  throw new Error('Expected promise to reject');
}
