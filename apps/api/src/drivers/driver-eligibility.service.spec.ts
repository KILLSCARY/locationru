import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import {
  DocumentStatus,
  DocumentVersionStatus,
  DriverVerificationStatus,
  UserStatus,
} from '../generated/prisma/client.js';
import { DriverEligibilityService } from './driver-eligibility.service.js';

const DRIVER_ID = 'driver-1';
const VEHICLE_ID = 'vehicle-1';

interface FakeProfile {
  cityId: string;
  verificationStatus: DriverVerificationStatus;
  user: { status: UserStatus };
  vehicles: { id: string }[];
}

interface FakeDocumentVersion {
  documentFamily: string;
  status: DocumentVersionStatus;
  driverDocument?: {
    type: string;
    status: DocumentStatus;
    expiresAt: Date | null;
  } | null;
  vehicleDocument?: {
    vehicleId: string;
    type: string;
    status: DocumentStatus;
    expiresAt: Date | null;
  } | null;
}

class FakePrisma {
  profile: FakeProfile | null = null;
  driverVersions: FakeDocumentVersion[] = [];
  vehicleVersions: FakeDocumentVersion[] = [];
  notificationsDenied = false;

  driverProfile = {
    findUnique: async () => this.profile,
  };

  documentVersion = {
    findMany: async ({
      where,
    }: {
      where: { documentFamily: { in: string[] } };
    }) => {
      const isVehicleQuery = where.documentFamily.in.some((family) =>
        family.startsWith('vehicle:'),
      );
      return isVehicleQuery ? this.vehicleVersions : this.driverVersions;
    },
  };

  devicePushToken = {
    findFirst: async () =>
      this.notificationsDenied ? { id: 'token-1' } : null,
  };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return new ConfigService({
    documents: { expirationWarningDays: [3, 7] },
    driverVerification: {
      requiredDriverDocumentTypes: ['PASSPORT_MAIN_PAGE'],
      requiredVehicleDocumentTypes: ['VEHICLE_REGISTRATION'],
      activeCityIds: [],
    },
    ...overrides,
  });
}

function approvedProfile(): FakeProfile {
  return {
    cityId: 'msk',
    verificationStatus: DriverVerificationStatus.APPROVED,
    user: { status: UserStatus.ACTIVE },
    vehicles: [{ id: VEHICLE_ID }],
  };
}

function approvedDriverDocVersion(expiresAt: Date | null): FakeDocumentVersion {
  return {
    documentFamily: `driver:${DRIVER_ID}:PASSPORT_MAIN_PAGE`,
    status: DocumentVersionStatus.ACTIVE,
    driverDocument: {
      type: 'PASSPORT_MAIN_PAGE',
      status: DocumentStatus.APPROVED,
      expiresAt,
    },
  };
}

function approvedVehicleDocVersion(
  expiresAt: Date | null,
): FakeDocumentVersion {
  return {
    documentFamily: `vehicle:${VEHICLE_ID}:VEHICLE_REGISTRATION`,
    status: DocumentVersionStatus.ACTIVE,
    vehicleDocument: {
      vehicleId: VEHICLE_ID,
      type: 'VEHICLE_REGISTRATION',
      status: DocumentStatus.APPROVED,
      expiresAt,
    },
  };
}

describe('DriverEligibilityService', () => {
  let prisma: FakePrisma;
  let service: DriverEligibilityService;

  beforeEach(() => {
    prisma = new FakePrisma();
    service = new DriverEligibilityService(
      makeConfig(),
      prisma as unknown as PrismaService,
    );
  });

  it('is eligible when approved, active, with an approved vehicle and all required documents in force', async () => {
    prisma.profile = approvedProfile();
    prisma.driverVersions = [approvedDriverDocVersion(null)];
    prisma.vehicleVersions = [approvedVehicleDocVersion(null)];

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result).toMatchObject({
      eligible: true,
      blockingReasons: [],
      expiresSoon: false,
      approvedVehicleIds: [VEHICLE_ID],
    });
  });

  it('blocks with DRIVER_NOT_APPROVED when no profile exists', async () => {
    prisma.profile = null;

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.eligible).toBe(false);
    expect(result.blockingReasons).toEqual(['DRIVER_NOT_APPROVED']);
  });

  it('blocks with ACTIVE_SUSPENSION (not DRIVER_NOT_APPROVED) when suspended', async () => {
    prisma.profile = {
      ...approvedProfile(),
      verificationStatus: DriverVerificationStatus.SUSPENDED,
    };
    prisma.driverVersions = [approvedDriverDocVersion(null)];
    prisma.vehicleVersions = [approvedVehicleDocVersion(null)];

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.blockingReasons).toContain('ACTIVE_SUSPENSION');
    expect(result.blockingReasons).not.toContain('DRIVER_NOT_APPROVED');
  });

  it('blocks with ACCOUNT_BLOCKED when the user account is not ACTIVE', async () => {
    prisma.profile = {
      ...approvedProfile(),
      user: { status: UserStatus.BLOCKED },
    };
    prisma.driverVersions = [approvedDriverDocVersion(null)];
    prisma.vehicleVersions = [approvedVehicleDocVersion(null)];

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.blockingReasons).toContain('ACCOUNT_BLOCKED');
  });

  it('blocks with NO_APPROVED_VEHICLE and skips vehicle document checks when there is no approved vehicle', async () => {
    prisma.profile = { ...approvedProfile(), vehicles: [] };
    prisma.driverVersions = [approvedDriverDocVersion(null)];

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.blockingReasons).toEqual(['NO_APPROVED_VEHICLE']);
    expect(result.approvedVehicleIds).toEqual([]);
  });

  it('blocks with REQUIRED_DOCUMENT_MISSING when a required driver document has no approved active version', async () => {
    prisma.profile = approvedProfile();
    prisma.driverVersions = [];
    prisma.vehicleVersions = [approvedVehicleDocVersion(null)];

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.blockingReasons).toContain('REQUIRED_DOCUMENT_MISSING');
  });

  it('does not count an ACTIVE version whose underlying document is not yet APPROVED', async () => {
    prisma.profile = approvedProfile();
    prisma.driverVersions = [
      {
        documentFamily: `driver:${DRIVER_ID}:PASSPORT_MAIN_PAGE`,
        status: DocumentVersionStatus.ACTIVE,
        driverDocument: {
          type: 'PASSPORT_MAIN_PAGE',
          status: DocumentStatus.READY_FOR_REVIEW,
          expiresAt: null,
        },
      },
    ];
    prisma.vehicleVersions = [approvedVehicleDocVersion(null)];

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.blockingReasons).toContain('REQUIRED_DOCUMENT_MISSING');
  });

  it('blocks with DOCUMENT_EXPIRED when a required driver document already expired', async () => {
    prisma.profile = approvedProfile();
    prisma.driverVersions = [
      approvedDriverDocVersion(new Date(Date.now() - 1_000)),
    ];
    prisma.vehicleVersions = [approvedVehicleDocVersion(null)];

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.blockingReasons).toContain('DOCUMENT_EXPIRED');
    expect(result.eligible).toBe(false);
  });

  it('sets expiresSoon (without blocking) when a document expires within the configured warning window', async () => {
    prisma.profile = approvedProfile();
    const soon = new Date(Date.now() + 2 * 86_400_000); // within the 7-day window
    prisma.driverVersions = [approvedDriverDocVersion(soon)];
    prisma.vehicleVersions = [approvedVehicleDocVersion(null)];

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.expiresSoon).toBe(true);
    expect(result.eligible).toBe(true);
  });

  it('blocks with VEHICLE_DOCUMENT_EXPIRED for an expired required vehicle document', async () => {
    prisma.profile = approvedProfile();
    prisma.driverVersions = [approvedDriverDocVersion(null)];
    prisma.vehicleVersions = [
      approvedVehicleDocVersion(new Date(Date.now() - 1_000)),
    ];

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.blockingReasons).toContain('VEHICLE_DOCUMENT_EXPIRED');
  });

  it('blocks with LOCATION_PERMISSION_MISSING only when explicitly denied', async () => {
    prisma.profile = approvedProfile();
    prisma.driverVersions = [approvedDriverDocVersion(null)];
    prisma.vehicleVersions = [approvedVehicleDocVersion(null)];

    const denied = await service.evaluateDriverEligibility(DRIVER_ID, {
      locationPermissionGranted: false,
    });
    expect(denied.blockingReasons).toContain('LOCATION_PERMISSION_MISSING');

    const omitted = await service.evaluateDriverEligibility(DRIVER_ID, {});
    expect(omitted.blockingReasons).not.toContain(
      'LOCATION_PERMISSION_MISSING',
    );
  });

  it('blocks with CITY_NOT_ACTIVE when an active-city allowlist is configured and the driver is outside it', async () => {
    prisma.profile = approvedProfile();
    prisma.driverVersions = [approvedDriverDocVersion(null)];
    prisma.vehicleVersions = [approvedVehicleDocVersion(null)];
    service = new DriverEligibilityService(
      makeConfig({
        driverVerification: {
          requiredDriverDocumentTypes: ['PASSPORT_MAIN_PAGE'],
          requiredVehicleDocumentTypes: ['VEHICLE_REGISTRATION'],
          activeCityIds: ['spb'],
        },
      }),
      prisma as unknown as PrismaService,
    );

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.blockingReasons).toContain('CITY_NOT_ACTIVE');
  });

  it('adds a NOTIFICATION_PERMISSION_WARNING without blocking when push notifications are denied', async () => {
    prisma.profile = approvedProfile();
    prisma.driverVersions = [approvedDriverDocVersion(null)];
    prisma.vehicleVersions = [approvedVehicleDocVersion(null)];
    prisma.notificationsDenied = true;

    const result = await service.evaluateDriverEligibility(DRIVER_ID);

    expect(result.eligible).toBe(true);
    expect(result.warnings).toEqual(['NOTIFICATION_PERMISSION_WARNING']);
  });
});
