import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import {
  DocumentStatus,
  DocumentVersionStatus,
  DriverVerificationStatus,
  PushApplication,
  PushTokenStatus,
  UserStatus,
  VehicleStatus,
  VehicleVerificationStatus,
} from '../generated/prisma/client.js';

export type BlockingReason =
  | 'DRIVER_NOT_APPROVED'
  | 'ACCOUNT_BLOCKED'
  | 'NO_APPROVED_VEHICLE'
  | 'REQUIRED_DOCUMENT_MISSING'
  | 'DOCUMENT_EXPIRED'
  | 'VEHICLE_DOCUMENT_EXPIRED'
  | 'LOCATION_PERMISSION_MISSING'
  | 'ACTIVE_SUSPENSION'
  | 'CITY_NOT_ACTIVE';

export interface DriverEligibilityInput {
  /** Reported by the client at the moment it asks to go online — absent (older client) is treated as granted, `false` blocks. */
  locationPermissionGranted?: boolean | undefined;
}

export interface DriverEligibilityResult {
  eligible: boolean;
  blockingReasons: BlockingReason[];
  /** Soft issues that never block ONLINE — currently only `NOTIFICATION_PERMISSION_WARNING`. */
  warnings: string[];
  /** True if any required document (driver or vehicle) expires within push.documentExpirationWarningDays' widest window. */
  expiresSoon: boolean;
  approvedVehicleIds: string[];
}

/**
 * The single source of truth for "can this driver go ONLINE right now" —
 * every endpoint that needs the answer (drivers/me/online, the bid-creation
 * eligibility check, the login-time suspension check) calls this instead of
 * re-deriving its own rules. See docs/drivers/eligibility.md.
 */
@Injectable()
export class DriverEligibilityService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async evaluateDriverEligibility(
    driverId: string,
    input: DriverEligibilityInput = {},
  ): Promise<DriverEligibilityResult> {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
      include: {
        user: { select: { status: true } },
        vehicles: {
          where: {
            verificationStatus: VehicleVerificationStatus.APPROVED,
            status: VehicleStatus.ACTIVE,
          },
          select: { id: true },
        },
      },
    });

    if (!profile) {
      return {
        eligible: false,
        blockingReasons: ['DRIVER_NOT_APPROVED'],
        warnings: [],
        expiresSoon: false,
        approvedVehicleIds: [],
      };
    }

    const blockingReasons = new Set<BlockingReason>();
    const warnings: string[] = [];
    let expiresSoon = false;

    if (profile.verificationStatus === DriverVerificationStatus.SUSPENDED) {
      blockingReasons.add('ACTIVE_SUSPENSION');
    } else if (
      profile.verificationStatus !== DriverVerificationStatus.APPROVED
    ) {
      blockingReasons.add('DRIVER_NOT_APPROVED');
    }

    if (profile.user.status !== UserStatus.ACTIVE) {
      blockingReasons.add('ACCOUNT_BLOCKED');
    }

    const approvedVehicleIds = profile.vehicles.map((vehicle) => vehicle.id);
    if (approvedVehicleIds.length === 0) {
      blockingReasons.add('NO_APPROVED_VEHICLE');
    }

    const now = Date.now();
    const warningDays = this.config.getOrThrow<number[]>(
      'documents.expirationWarningDays',
    );
    const soonestWindowMs = Math.max(0, ...warningDays) * 86_400_000;

    // A document family's ACTIVE version is only "in force" once its
    // underlying row is actually APPROVED — recordNewVersion marks a
    // family's first-ever upload ACTIVE immediately (nothing to protect
    // yet), even before an admin has reviewed it, so ACTIVE alone doesn't
    // imply approved. See DocumentVersionService/docs/drivers/documents.md.
    const requiredDriverTypes = this.config.getOrThrow<string[]>(
      'driverVerification.requiredDriverDocumentTypes',
    );
    const activeDriverVersions = await this.prisma.documentVersion.findMany({
      where: {
        status: DocumentVersionStatus.ACTIVE,
        documentFamily: {
          in: requiredDriverTypes.map((type) => `driver:${driverId}:${type}`),
        },
      },
      include: {
        driverDocument: {
          select: { type: true, status: true, expiresAt: true },
        },
      },
    });
    const approvedByType = new Map(
      activeDriverVersions
        .map((version) => version.driverDocument)
        .filter(
          (doc): doc is NonNullable<typeof doc> =>
            doc !== null && doc.status === DocumentStatus.APPROVED,
        )
        .map((doc) => [doc.type, doc]),
    );
    for (const type of requiredDriverTypes) {
      const doc = approvedByType.get(type as never);
      if (!doc) {
        blockingReasons.add('REQUIRED_DOCUMENT_MISSING');
        continue;
      }
      if (doc.expiresAt) {
        const expiresAtMs = doc.expiresAt.getTime();
        if (expiresAtMs <= now) {
          blockingReasons.add('DOCUMENT_EXPIRED');
        } else if (expiresAtMs - now <= soonestWindowMs) {
          expiresSoon = true;
        }
      }
    }

    if (approvedVehicleIds.length) {
      const requiredVehicleTypes = this.config.getOrThrow<string[]>(
        'driverVerification.requiredVehicleDocumentTypes',
      );
      const families = approvedVehicleIds.flatMap((vehicleId) =>
        requiredVehicleTypes.map((type) => `vehicle:${vehicleId}:${type}`),
      );
      const activeVehicleVersions = await this.prisma.documentVersion.findMany({
        where: {
          status: DocumentVersionStatus.ACTIVE,
          documentFamily: { in: families },
        },
        include: {
          vehicleDocument: {
            select: {
              vehicleId: true,
              type: true,
              status: true,
              expiresAt: true,
            },
          },
        },
      });
      const approvedVehicleDocs = activeVehicleVersions
        .map((version) => version.vehicleDocument)
        .filter(
          (doc): doc is NonNullable<typeof doc> =>
            doc !== null && doc.status === DocumentStatus.APPROVED,
        );

      for (const vehicleId of approvedVehicleIds) {
        const byType = new Map(
          approvedVehicleDocs
            .filter((doc) => doc.vehicleId === vehicleId)
            .map((doc) => [doc.type, doc]),
        );
        for (const type of requiredVehicleTypes) {
          const doc = byType.get(type as never);
          if (!doc) {
            blockingReasons.add('REQUIRED_DOCUMENT_MISSING');
            continue;
          }
          if (doc.expiresAt) {
            const expiresAtMs = doc.expiresAt.getTime();
            if (expiresAtMs <= now) {
              blockingReasons.add('VEHICLE_DOCUMENT_EXPIRED');
            } else if (expiresAtMs - now <= soonestWindowMs) {
              expiresSoon = true;
            }
          }
        }
      }
    }

    if (input.locationPermissionGranted === false) {
      blockingReasons.add('LOCATION_PERMISSION_MISSING');
    }

    const activeCityIds = this.config.getOrThrow<string[]>(
      'driverVerification.activeCityIds',
    );
    if (activeCityIds.length && !activeCityIds.includes(profile.cityId)) {
      blockingReasons.add('CITY_NOT_ACTIVE');
    }

    const deniedNotifications = await this.prisma.devicePushToken.findFirst({
      where: {
        userId: driverId,
        application: PushApplication.DRIVER,
        status: PushTokenStatus.ACTIVE,
        notificationsPermission: false,
      },
      select: { id: true },
    });
    if (deniedNotifications) {
      warnings.push('NOTIFICATION_PERMISSION_WARNING');
    }

    return {
      eligible: blockingReasons.size === 0,
      blockingReasons: [...blockingReasons],
      warnings,
      expiresSoon,
      approvedVehicleIds,
    };
  }
}
