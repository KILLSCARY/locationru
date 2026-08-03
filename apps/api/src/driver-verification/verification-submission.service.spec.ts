import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import {
  DocumentStatus,
  DocumentVersionStatus,
  DriverConsentType,
  DriverVerificationStatus,
  VehicleStatus,
  VehicleVerificationStatus,
  VerificationCaseStatus,
} from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import { DriverConsentService } from './driver-consent.service.js';
import { VerificationSubmissionService } from './verification-submission.service.js';

const DRIVER_ID = '00000000-0000-4000-8000-000000000010';
const VEHICLE_ID = 'vehicle-1';

const CONFIG = new ConfigService({
  driverVerification: {
    requiredDriverDocumentTypes: ['PASSPORT_MAIN_PAGE', 'DRIVER_LICENSE_FRONT'],
    requiredVehicleDocumentTypes: ['VEHICLE_REGISTRATION_FRONT'],
  },
});

class InMemoryPrisma {
  profile: Record<string, unknown> | null = {
    userId: DRIVER_ID,
    firstName: 'Ivan',
    lastName: 'Ivanov',
    middleName: null,
    birthDate: new Date('1990-01-01'),
    cityId: 'moscow',
    verificationStatus: DriverVerificationStatus.DOCUMENTS_REQUIRED,
  };
  openCase: Record<string, unknown> | null = null;
  vehicles: Array<Record<string, unknown>> = [
    { id: VEHICLE_ID, status: VehicleStatus.INACTIVE },
  ];
  versions: Array<{
    documentFamily: string;
    status: DocumentVersionStatus;
    driverDocument?: { status: DocumentStatus } | null;
    vehicleDocument?: { status: DocumentStatus } | null;
  }> = [];
  createdCase: Record<string, unknown> | null = null;

  readonly driverProfile = {
    findUnique: async () => this.profile,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(this.profile as Record<string, unknown>, data);
      return this.profile;
    },
  };

  readonly verificationCase = {
    findFirst: async () => this.openCase,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.createdCase = {
        id: 'case-1',
        createdAt: new Date(),
        ...data,
      };
      return this.createdCase;
    },
  };

  readonly vehicle = {
    findMany: async () => this.vehicles,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const vehicle = this.vehicles.find((v) => v.id === where.id);
      Object.assign(vehicle as Record<string, unknown>, data);
      return vehicle;
    },
  };

  readonly documentVersion = {
    findMany: async ({
      where,
    }: {
      where: { documentFamily: { in: string[] } };
    }) =>
      this.versions.filter((version) =>
        where.documentFamily.in.includes(version.documentFamily),
      ),
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return fn(this);
  }

  markDriverDocReady(type: string): void {
    this.versions.push({
      documentFamily: `driver:${DRIVER_ID}:${type}`,
      status: DocumentVersionStatus.ACTIVE,
      driverDocument: { status: DocumentStatus.READY_FOR_REVIEW },
    });
  }

  markVehicleDocReady(type: string): void {
    this.versions.push({
      documentFamily: `vehicle:${VEHICLE_ID}:${type}`,
      status: DocumentVersionStatus.ACTIVE,
      vehicleDocument: { status: DocumentStatus.READY_FOR_REVIEW },
    });
  }
}

class FakeConsentService {
  active = new Set<DriverConsentType>();

  async getActiveConsentTypes(): Promise<Set<DriverConsentType>> {
    return this.active;
  }
}

describe('VerificationSubmissionService', () => {
  let prisma: InMemoryPrisma;
  let consents: FakeConsentService;
  let metrics: MetricsService;
  let service: VerificationSubmissionService;

  function markAllReady(): void {
    prisma.markDriverDocReady('PASSPORT_MAIN_PAGE');
    prisma.markDriverDocReady('DRIVER_LICENSE_FRONT');
    prisma.markVehicleDocReady('VEHICLE_REGISTRATION_FRONT');
    consents.active = new Set([
      DriverConsentType.PERSONAL_DATA_PROCESSING,
      DriverConsentType.DOCUMENT_PROCESSING,
      DriverConsentType.TERMS_OF_SERVICE,
      DriverConsentType.DRIVER_PARTNER_AGREEMENT,
    ]);
  }

  beforeEach(() => {
    prisma = new InMemoryPrisma();
    consents = new FakeConsentService();
    metrics = new MetricsService();
    service = new VerificationSubmissionService(
      CONFIG,
      prisma as unknown as PrismaService,
      consents as unknown as DriverConsentService,
      metrics,
    );
  });

  it('rejects submission when the profile is incomplete', async () => {
    prisma.profile = null;

    const error = await captureError(service.submit(DRIVER_ID));

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      blockingReasons: ['PROFILE_INCOMPLETE'],
    });
  });

  it('rejects submission when a required driver document is not ready', async () => {
    prisma.markVehicleDocReady('VEHICLE_REGISTRATION_FRONT');
    consents.active = new Set([
      DriverConsentType.PERSONAL_DATA_PROCESSING,
      DriverConsentType.DOCUMENT_PROCESSING,
      DriverConsentType.TERMS_OF_SERVICE,
      DriverConsentType.DRIVER_PARTNER_AGREEMENT,
    ]);

    const error = await captureError(service.submit(DRIVER_ID));

    expect(error.getResponse()).toMatchObject({
      blockingReasons: ['REQUIRED_DRIVER_DOCUMENT_NOT_READY'],
    });
  });

  it('rejects submission when no vehicle has all required documents ready', async () => {
    prisma.markDriverDocReady('PASSPORT_MAIN_PAGE');
    prisma.markDriverDocReady('DRIVER_LICENSE_FRONT');
    consents.active = new Set([
      DriverConsentType.PERSONAL_DATA_PROCESSING,
      DriverConsentType.DOCUMENT_PROCESSING,
      DriverConsentType.TERMS_OF_SERVICE,
      DriverConsentType.DRIVER_PARTNER_AGREEMENT,
    ]);

    const error = await captureError(service.submit(DRIVER_ID));

    expect(error.getResponse()).toMatchObject({
      blockingReasons: ['NO_ELIGIBLE_VEHICLE'],
    });
  });

  it('rejects submission when required consent is missing', async () => {
    prisma.markDriverDocReady('PASSPORT_MAIN_PAGE');
    prisma.markDriverDocReady('DRIVER_LICENSE_FRONT');
    prisma.markVehicleDocReady('VEHICLE_REGISTRATION_FRONT');

    const error = await captureError(service.submit(DRIVER_ID));

    expect(error.getResponse()).toMatchObject({
      blockingReasons: ['CONSENT_MISSING'],
    });
  });

  it('rejects submission when a case is already open', async () => {
    markAllReady();
    prisma.openCase = { id: 'existing-case' };

    const error = await captureError(service.submit(DRIVER_ID));

    expect(error.getResponse()).toMatchObject({
      blockingReasons: ['CASE_ALREADY_OPEN'],
    });
  });

  it('creates a VerificationCase and advances profile/vehicle status once every check passes', async () => {
    markAllReady();

    const result = await service.submit(DRIVER_ID);

    expect(result.status).toBe(VerificationCaseStatus.QUEUED);
    expect(prisma.profile?.verificationStatus).toBe(
      DriverVerificationStatus.DOCUMENTS_SUBMITTED,
    );
    expect(
      prisma.vehicles.find((v) => v.id === VEHICLE_ID)?.verificationStatus,
    ).toBe(VehicleVerificationStatus.SUBMITTED);
    expect(prisma.createdCase?.submittedSnapshot).toMatchObject({
      vehicleId: VEHICLE_ID,
    });
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
