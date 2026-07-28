import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import {
  type Prisma,
  DispatchAttemptLogStatus,
  TripStatus,
} from '../generated/prisma/client.js';
import {
  ROUTE_ESTIMATOR,
  type RouteEstimator,
  type RouteLeg,
} from './routing/route-estimator.interface.js';

interface DispatchTripRow {
  id: string;
  status: TripStatus;
}

interface DispatchCandidateRow extends UnrankedDispatchCandidate {
  driverLongitude: number;
  driverLatitude: number;
  pickupLongitude: number;
  pickupLatitude: number;
}

export interface DispatchCandidate {
  distanceMeters: number;
  driverId: string;
  estimatedPickupSeconds: number;
  rank: number;
  rating: number;
}

type UnrankedDispatchCandidate = Omit<DispatchCandidate, 'rank'>;

export interface DispatchRequest {
  redispatchReason?: string;
  tripId: string;
}

export interface DispatchResult {
  attemptId: string;
  candidates: DispatchCandidate[];
  radiusMeters: number;
}

export function rankDispatchCandidates(
  candidates: UnrankedDispatchCandidate[],
): DispatchCandidate[] {
  return [...candidates]
    .sort(
      (left, right) =>
        left.estimatedPickupSeconds - right.estimatedPickupSeconds ||
        left.distanceMeters - right.distanceMeters ||
        right.rating - left.rating ||
        left.driverId.localeCompare(right.driverId),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

@Injectable()
export class DispatchService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(ROUTE_ESTIMATOR) private readonly routeEstimator: RouteEstimator,
  ) {}

  async findCandidates(request: DispatchRequest): Promise<DispatchResult> {
    const redispatchReason = this.normalizeRedispatchReason(
      request.redispatchReason,
    );

    return this.prisma.$transaction(async (transaction) => {
      const trip = await this.lockSearchableTrip(transaction, request.tripId);
      const radii = this.searchRadii();
      let radiusMeters = radii.at(-1);
      let candidates: DispatchCandidate[] = [];

      for (const radius of radii) {
        const found = await this.findCandidatesWithinRadius(
          transaction,
          trip.id,
          radius,
          Boolean(redispatchReason),
        );
        if (found.length) {
          candidates = rankDispatchCandidates(await this.refineEtas(found));
          radiusMeters = radius;
          break;
        }
      }

      if (!radiusMeters) {
        throw new Error('Dispatch search radii are not configured');
      }

      const attempt = await transaction.dispatchAttempt.create({
        data: {
          id: randomUUID(),
          tripId: trip.id,
          radiusMeters,
          candidateCount: candidates.length,
          redispatchReason,
        },
        select: { id: true },
      });

      if (candidates.length) {
        await transaction.dispatchAttemptLog.createMany({
          data: candidates.map((candidate) => ({
            id: randomUUID(),
            attemptId: attempt.id,
            driverId: candidate.driverId,
            rank: candidate.rank,
            distanceMeters: candidate.distanceMeters,
            estimatedPickupSeconds: candidate.estimatedPickupSeconds,
            status: DispatchAttemptLogStatus.CANDIDATE,
          })),
        });
      }

      return {
        attemptId: attempt.id,
        radiusMeters,
        candidates,
      };
    });
  }

  private async lockSearchableTrip(
    transaction: Prisma.TransactionClient,
    tripId: string,
  ): Promise<DispatchTripRow> {
    const trips = await transaction.$queryRawUnsafe<DispatchTripRow[]>(
      `SELECT "id", "status"
       FROM "trips"
       WHERE "id" = $1
       FOR UPDATE`,
      tripId,
    );
    const trip = trips[0];

    if (!trip) {
      throw new NotFoundException({
        code: 'TRIP_NOT_FOUND',
        message: 'Trip was not found',
      });
    }

    if (trip.status !== TripStatus.SEARCHING) {
      throw new ConflictException({
        code: 'TRIP_NOT_SEARCHING',
        message:
          'Candidates can be searched only for a trip in SEARCHING status',
      });
    }

    return trip;
  }

  /**
   * Refines the straight-line ETA of the shortlisted candidates through the
   * configured route estimator, then returns candidates ready to be ranked.
   */
  private async refineEtas(
    rows: DispatchCandidateRow[],
  ): Promise<UnrankedDispatchCandidate[]> {
    const legs: RouteLeg[] = rows.map((row) => ({
      driverId: row.driverId,
      straightLineSeconds: row.estimatedPickupSeconds,
      origin: { longitude: row.driverLongitude, latitude: row.driverLatitude },
      destination: {
        longitude: row.pickupLongitude,
        latitude: row.pickupLatitude,
      },
    }));

    const estimates = await this.routeEstimator.estimate(legs);
    const secondsByDriver = new Map(
      estimates.map((estimate) => [
        estimate.driverId,
        estimate.estimatedPickupSeconds,
      ]),
    );

    return rows.map((row) => ({
      driverId: row.driverId,
      distanceMeters: row.distanceMeters,
      estimatedPickupSeconds:
        secondsByDriver.get(row.driverId) ?? row.estimatedPickupSeconds,
      rating: row.rating,
    }));
  }

  private async findCandidatesWithinRadius(
    transaction: Prisma.TransactionClient,
    tripId: string,
    radiusMeters: number,
    allowRedispatch: boolean,
  ): Promise<DispatchCandidateRow[]> {
    const freshLocationSeconds = this.configService.getOrThrow<number>(
      'dispatch.locationMaxAgeSeconds',
    );
    const averageSpeedMetersPerSecond = this.configService.getOrThrow<number>(
      'dispatch.averageSpeedMetersPerSecond',
    );
    const maxCandidates = this.configService.getOrThrow<number>(
      'dispatch.maxCandidates',
    );
    const priorAttemptFilter = allowRedispatch
      ? ''
      : `AND NOT EXISTS (
           SELECT 1
           FROM "dispatch_attempt_logs" AS "previousLog"
           INNER JOIN "dispatch_attempts" AS "previousAttempt"
             ON "previousAttempt"."id" = "previousLog"."attemptId"
           WHERE "previousAttempt"."tripId" = $1
             AND "previousLog"."driverId" = "driver_profiles"."userId"
         )`;

    return transaction.$queryRawUnsafe<DispatchCandidateRow[]>(
      `WITH "pickup" AS (
          SELECT "pickupLocation"
          FROM "trips"
          WHERE "id" = $1
        ),
        "latestLocations" AS (
          SELECT DISTINCT ON ("driverId") "driverId", "location", "recordedAt"
          FROM "driver_locations"
          WHERE "stale" = false
            AND "recordedAt" >= NOW() - ($2 * INTERVAL '1 second')
          ORDER BY "driverId", "recordedAt" DESC
        )
       SELECT
          "driver_profiles"."userId" AS "driverId",
          ROUND(ST_Distance("latestLocations"."location", "pickup"."pickupLocation"))::integer AS "distanceMeters",
          CEIL(
            ST_Distance("latestLocations"."location", "pickup"."pickupLocation") / $4
          )::integer AS "estimatedPickupSeconds",
          "driver_profiles"."rating"::double precision AS "rating",
          ST_X("latestLocations"."location"::geometry)::double precision AS "driverLongitude",
          ST_Y("latestLocations"."location"::geometry)::double precision AS "driverLatitude",
          ST_X("pickup"."pickupLocation"::geometry)::double precision AS "pickupLongitude",
          ST_Y("pickup"."pickupLocation"::geometry)::double precision AS "pickupLatitude"
       FROM "driver_profiles"
       INNER JOIN "latestLocations"
         ON "latestLocations"."driverId" = "driver_profiles"."userId"
       CROSS JOIN "pickup"
       WHERE "driver_profiles"."status" = 'ONLINE'
         AND "driver_profiles"."verificationStatus" = 'APPROVED'
         AND ST_DWithin(
           "latestLocations"."location",
           "pickup"."pickupLocation",
           $3
         )
         ${priorAttemptFilter}
       ORDER BY
         "estimatedPickupSeconds" ASC,
         "distanceMeters" ASC,
         "rating" DESC,
         "driverId" ASC
       LIMIT $5`,
      tripId,
      freshLocationSeconds,
      radiusMeters,
      averageSpeedMetersPerSecond,
      maxCandidates,
    );
  }

  private searchRadii(): number[] {
    const initialRadius = this.configService.getOrThrow<number>(
      'dispatch.initialRadiusMeters',
    );
    const maximumRadius = this.configService.getOrThrow<number>(
      'dispatch.maxRadiusMeters',
    );
    const multiplier = this.configService.getOrThrow<number>(
      'dispatch.radiusMultiplier',
    );
    const radii = [initialRadius];

    while (radii.at(-1)! < maximumRadius) {
      const nextRadius = Math.min(
        maximumRadius,
        Math.ceil(radii.at(-1)! * multiplier),
      );
      if (nextRadius <= radii.at(-1)!) break;
      radii.push(nextRadius);
    }

    return radii;
  }

  private normalizeRedispatchReason(reason: string | undefined): string | null {
    if (reason === undefined) return null;

    const normalized = reason.trim();
    if (!normalized || normalized.length > 512) {
      throw new ConflictException({
        code: 'REDISPATCH_REASON_INVALID',
        message: 'A redispatch reason must contain at most 512 characters',
      });
    }

    return normalized;
  }
}
