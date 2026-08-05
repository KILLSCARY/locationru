import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  DriverLocationConfidence,
  DriverOperationalStatus,
  DriverVerificationStatus,
  TripStatus,
} from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import type { BatchDriverLocationDto } from './dto/batch-driver-location.dto.js';
import type { DriverLocationDto } from './dto/driver-location.dto.js';
import { GoOnlineDto } from './dto/go-online.dto.js';
import {
  DriverEligibilityService,
  type BlockingReason,
} from './driver-eligibility.service.js';

interface DriverProfileForStatus {
  operationalStatus: DriverOperationalStatus;
  verificationStatus: DriverVerificationStatus;
}

interface LatestPosition {
  accuracyMeters: number;
  confidence: DriverLocationConfidence;
  latitude: number;
  longitude: number;
  recordedAt: string;
  suspectedSpoofing: boolean;
}

interface InsertedLocation {
  id: string;
}

export interface DriverStatusResponse {
  hasApprovedVehicle: boolean;
  lastLocation: LatestPosition | null;
  status: DriverOperationalStatus;
  verificationStatus: DriverVerificationStatus;
  eligibility: {
    eligible: boolean;
    blockingReasons: BlockingReason[];
    warnings: string[];
    expiresSoon: boolean;
  };
}

export interface LocationSubmissionResult {
  accepted: number;
  deduplicated: number;
  stale: number;
}

@Injectable()
export class DriverService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly realtimeOutbox: RealtimeOutboxService,
    private readonly eligibility: DriverEligibilityService,
  ) {}

  /**
   * The only place a driver flips ONLINE — every rule about whether that's
   * allowed lives in DriverEligibilityService, never duplicated here. See
   * docs/drivers/eligibility.md.
   */
  async goOnline(
    user: AuthenticatedUser,
    input: GoOnlineDto = {},
  ): Promise<DriverStatusResponse> {
    await this.getDriverProfile(user);
    const result = await this.eligibility.evaluateDriverEligibility(user.id, {
      locationPermissionGranted: input.locationPermissionGranted,
    });

    if (!result.eligible) {
      throw new ConflictException({
        code: 'DRIVER_NOT_ELIGIBLE',
        message: 'Driver does not currently meet the requirements to go online',
        blockingReasons: result.blockingReasons,
      });
    }

    await this.prisma.driverProfile.update({
      where: { userId: user.id },
      data: { operationalStatus: DriverOperationalStatus.ONLINE },
    });

    return this.getStatus(user);
  }

  async goOffline(user: AuthenticatedUser): Promise<DriverStatusResponse> {
    await this.getDriverProfile(user);

    await this.prisma.driverProfile.update({
      where: { userId: user.id },
      data: { operationalStatus: DriverOperationalStatus.OFFLINE },
    });
    await this.redis.delete(this.latestPositionKey(user.id));

    return this.getStatus(user);
  }

  async submitLocation(
    user: AuthenticatedUser,
    input: DriverLocationDto,
  ): Promise<LocationSubmissionResult> {
    return this.submitLocations(user, [input]);
  }

  async submitLocationBatch(
    user: AuthenticatedUser,
    input: BatchDriverLocationDto,
  ): Promise<LocationSubmissionResult> {
    return this.submitLocations(user, input.locations);
  }

  async getStatus(user: AuthenticatedUser): Promise<DriverStatusResponse> {
    const profile = await this.getDriverProfile(user);
    const lastLocation = this.parseLatestPosition(
      await this.redis.get(this.latestPositionKey(user.id)),
    );
    const result = await this.eligibility.evaluateDriverEligibility(user.id);

    return {
      status: profile.operationalStatus,
      verificationStatus: profile.verificationStatus,
      hasApprovedVehicle: result.approvedVehicleIds.length > 0,
      lastLocation,
      eligibility: {
        eligible: result.eligible,
        blockingReasons: result.blockingReasons,
        warnings: result.warnings,
        expiresSoon: result.expiresSoon,
      },
    };
  }

  private async submitLocations(
    user: AuthenticatedUser,
    inputs: DriverLocationDto[],
  ): Promise<LocationSubmissionResult> {
    if (user.role !== 'DRIVER') {
      throw new ForbiddenException({
        code: 'DRIVER_ROLE_REQUIRED',
        message: 'Driver role is required',
      });
    }

    const maxBatchSize = this.configService.getOrThrow<number>(
      'driverLocations.batchMaxSize',
    );
    if (!inputs.length || inputs.length > maxBatchSize) {
      throw new UnprocessableEntityException({
        code: 'LOCATION_BATCH_SIZE_INVALID',
        message: `Location batch must contain between 1 and ${maxBatchSize} points`,
      });
    }

    const now = new Date();
    const futureToleranceMs =
      this.configService.getOrThrow<number>(
        'driverLocations.futureToleranceSeconds',
      ) * 1_000;
    for (const input of inputs) {
      if (input.recordedAt.getTime() > now.getTime() + futureToleranceMs) {
        throw new UnprocessableEntityException({
          code: 'LOCATION_IN_FUTURE',
          message: 'Location recordedAt cannot be too far in the future',
        });
      }
    }

    await this.getDriverProfile(user, { requireApproval: true });
    const deviceId = await this.getDeviceId(user);
    await this.consumeLocationRateLimit(user.id, inputs.length);

    const staleAfterMs =
      this.configService.getOrThrow<number>(
        'driverLocations.staleAfterSeconds',
      ) * 1_000;
    let previous = this.parseLatestPosition(
      await this.redis.get(this.latestPositionKey(user.id)),
    );
    const activeTripId = await this.findActiveTripId(user.id);
    const ordered = [...inputs].sort(
      (left, right) => left.recordedAt.getTime() - right.recordedAt.getTime(),
    );
    const result: LocationSubmissionResult = {
      accepted: 0,
      deduplicated: 0,
      stale: 0,
    };

    for (const input of ordered) {
      this.assertPlausibleSpeed(previous, input);

      const stale = now.getTime() - input.recordedAt.getTime() > staleAfterMs;
      const confidence = this.serverConfidence(input);
      const inserted = await this.insertLocation({
        driverId: user.id,
        deviceId,
        input,
        confidence,
        stale,
      });

      if (!inserted) {
        result.deduplicated += 1;
        continue;
      }

      result.accepted += 1;
      if (stale) result.stale += 1;

      const candidate: LatestPosition = {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMeters: input.accuracyMeters,
        confidence,
        suspectedSpoofing: input.suspectedSpoofing,
        recordedAt: input.recordedAt.toISOString(),
      };
      if (
        !previous ||
        input.recordedAt.getTime() >= new Date(previous.recordedAt).getTime()
      ) {
        previous = candidate;
      }

      if (!stale) {
        await this.redis.setWithTtl(
          this.latestPositionKey(user.id),
          JSON.stringify(candidate),
          this.configService.getOrThrow<number>(
            'driverLocations.latestPositionTtlSeconds',
          ),
        );
        await this.realtimeOutbox.enqueueDriverLocationUpdate(
          {
            driverId: user.id,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            accuracyMeters: candidate.accuracyMeters,
            recordedAt: candidate.recordedAt,
          },
          activeTripId,
        );
      }
    }

    return result;
  }

  /**
   * The trip the driver is currently assigned to and en route on, if any — used
   * to fan location updates out to the passenger's trip room. Statuses before
   * DRIVER_SELECTED have no assigned driver yet, so they are excluded.
   */
  private async findActiveTripId(driverId: string): Promise<string | null> {
    const trip = await this.prisma.trip.findFirst({
      where: {
        selectedDriverId: driverId,
        status: {
          in: [
            TripStatus.DRIVER_SELECTED,
            TripStatus.PAYMENT_PENDING,
            TripStatus.PAYMENT_RESERVED,
            TripStatus.DRIVER_EN_ROUTE,
            TripStatus.DRIVER_ARRIVED,
            TripStatus.IN_PROGRESS,
          ],
        },
      },
      select: { id: true },
    });
    return trip?.id ?? null;
  }

  private async getDriverProfile(
    user: AuthenticatedUser,
    options: { requireApproval?: boolean } = {},
  ): Promise<DriverProfileForStatus> {
    if (user.role !== 'DRIVER') {
      throw new ForbiddenException({
        code: 'DRIVER_ROLE_REQUIRED',
        message: 'Driver role is required',
      });
    }

    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: user.id },
      select: {
        operationalStatus: true,
        verificationStatus: true,
      },
    });

    if (!profile) {
      throw new ForbiddenException({
        code: 'DRIVER_PROFILE_REQUIRED',
        message: 'Driver profile is required',
      });
    }

    if (
      options.requireApproval &&
      profile.verificationStatus !== DriverVerificationStatus.APPROVED
    ) {
      throw new ForbiddenException({
        code: 'DRIVER_APPROVAL_REQUIRED',
        message: 'Only an approved driver can submit locations or go online',
      });
    }

    return profile;
  }

  private async getDeviceId(user: AuthenticatedUser): Promise<string> {
    const session = await this.prisma.deviceSession.findUnique({
      where: { id: user.sessionId },
      select: { deviceId: true, userId: true },
    });

    if (!session || session.userId !== user.id) {
      throw new ForbiddenException({
        code: 'DEVICE_SESSION_REQUIRED',
        message: 'An active device session is required for location updates',
      });
    }

    return session.deviceId;
  }

  private async consumeLocationRateLimit(
    driverId: string,
    points: number,
  ): Promise<void> {
    const limit = this.configService.getOrThrow<number>(
      'driverLocations.rateLimitPerMinute',
    );
    const window = Math.floor(Date.now() / 60_000);
    const key = `driver:location:rate:${driverId}:${window}`;
    const count = await this.redis.incrementBy(key, points);

    if (count === points) {
      await this.redis.setExpiry(key, 60);
    }

    if (count > limit) {
      throw new HttpException(
        {
          code: 'LOCATION_RATE_LIMITED',
          message: 'Too many location updates',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async insertLocation(input: {
    confidence: DriverLocationConfidence;
    deviceId: string;
    driverId: string;
    input: DriverLocationDto;
    stale: boolean;
  }): Promise<boolean> {
    const location = input.input;
    const rows = await this.prisma.$queryRawUnsafe<InsertedLocation[]>(
      `INSERT INTO "driver_locations" (
          "id", "driverId", "deviceId", "recordedAt", "location", "accuracyMeters",
          "speedMetersPerSecond", "bearingDegrees", "altitudeMeters", "provider",
          "reportedConfidence", "confidence", "suspectedSpoofing", "stale",
          "satellitesVisible", "cellCount"
       ) VALUES (
          $1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7,
          $8, $9, $10, $11, $12::"DriverLocationConfidence", $13::"DriverLocationConfidence", $14, $15,
          $16, $17
       )
       ON CONFLICT ("deviceId", "recordedAt") DO NOTHING
       RETURNING "id"`,
      randomUUID(),
      input.driverId,
      input.deviceId,
      location.recordedAt,
      location.longitude,
      location.latitude,
      location.accuracyMeters,
      location.speedMetersPerSecond ?? null,
      location.bearingDegrees ?? null,
      location.altitudeMeters ?? null,
      location.provider,
      location.confidence,
      input.confidence,
      location.suspectedSpoofing,
      input.stale,
      location.satellitesVisible ?? null,
      location.cellCount ?? null,
    );

    return Boolean(rows[0]);
  }

  private assertPlausibleSpeed(
    previous: LatestPosition | null,
    next: DriverLocationDto,
  ): void {
    if (!previous) return;

    const elapsedSeconds =
      (next.recordedAt.getTime() - new Date(previous.recordedAt).getTime()) /
      1_000;
    if (elapsedSeconds <= 0) return;

    const distanceMeters = this.distanceMeters(
      previous.latitude,
      previous.longitude,
      next.latitude,
      next.longitude,
    );
    const speed = distanceMeters / elapsedSeconds;
    const maximum = this.configService.getOrThrow<number>(
      'driverLocations.maxPlausibleSpeedMetersPerSecond',
    );

    if (speed > maximum) {
      throw new UnprocessableEntityException({
        code: 'IMPOSSIBLE_LOCATION_SPEED',
        message: 'Location implies an implausible travel speed',
      });
    }
  }

  private serverConfidence(
    location: DriverLocationDto,
  ): DriverLocationConfidence {
    if (location.suspectedSpoofing || location.accuracyMeters > 100) {
      return DriverLocationConfidence.LOW;
    }

    if (location.accuracyMeters <= 20) {
      return DriverLocationConfidence.HIGH;
    }

    return DriverLocationConfidence.MEDIUM;
  }

  private distanceMeters(
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number,
  ): number {
    const degreesToRadians = Math.PI / 180;
    const latitudeDelta = (toLatitude - fromLatitude) * degreesToRadians;
    const longitudeDelta = (toLongitude - fromLongitude) * degreesToRadians;
    const a =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(fromLatitude * degreesToRadians) *
        Math.cos(toLatitude * degreesToRadians) *
        Math.sin(longitudeDelta / 2) ** 2;

    return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private latestPositionKey(driverId: string): string {
    return `driver:location:latest:${driverId}`;
  }

  private parseLatestPosition(value: string | null): LatestPosition | null {
    if (!value) return null;

    try {
      const parsed = JSON.parse(value) as LatestPosition;
      if (
        typeof parsed.latitude !== 'number' ||
        typeof parsed.longitude !== 'number' ||
        typeof parsed.recordedAt !== 'string'
      ) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }
}
