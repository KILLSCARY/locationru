import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  NotificationType,
  TripStatus,
  TripStatusActorType,
} from '../generated/prisma/client.js';
import { MapsService } from '../maps/maps.service.js';
import type { RouteRequest, RouteResult } from '../maps/maps.types.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  TripStateMachine,
  type TripTransitionResult,
} from './trip-state-machine.service.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';

interface IdempotencyRecord {
  requestHash: string;
  tripId: string;
}

interface TripSummaryRow {
  id: string;
  status: TripStatus;
  version: number;
}

interface TripDetailsRow extends TripSummaryRow {
  cancelledAt: Date | null;
  childSeat: boolean;
  comment: string | null;
  completedAt: Date | null;
  createdAt: Date;
  destinationAddress: string;
  destinationLatitude: number;
  destinationLongitude: number;
  estimatedDistanceMeters: number;
  estimatedDurationSeconds: number;
  finalPriceKopecks: number | null;
  luggage: boolean;
  passengerPriceKopecks: number;
  pet: boolean;
  pickupAddress: string;
  pickupLatitude: number;
  pickupLongitude: number;
  selectedDriverId: string | null;
  selectedVehicleId: string | null;
  startedAt: Date | null;
  updatedAt: Date;
}

interface TripStopRow {
  address: string;
  latitude: number;
  longitude: number;
  sequence: number;
}

export interface PassengerTripDetails extends TripSummaryRow {
  cancelledAt: Date | null;
  comment: string | null;
  completedAt: Date | null;
  createdAt: Date;
  destination: {
    address: string;
    latitude: number;
    longitude: number;
  };
  estimatedDistanceMeters: number;
  estimatedDurationSeconds: number;
  finalPriceKopecks: number | null;
  options: {
    childSeat: boolean;
    luggage: boolean;
    pet: boolean;
  };
  passengerPriceKopecks: number;
  pickup: {
    address: string;
    latitude: number;
    longitude: number;
  };
  selectedDriverId: string | null;
  selectedVehicleId: string | null;
  startedAt: Date | null;
  stops: TripStopRow[];
  updatedAt: Date;
}

@Injectable()
export class TripService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stateMachine: TripStateMachine,
    private readonly mapsService: MapsService,
    private readonly notifications: NotificationService,
    private readonly notificationOutbox: NotificationOutboxService,
  ) {}

  async create(
    passenger: AuthenticatedUser,
    input: CreateTripDto,
    idempotencyKey: string | undefined,
  ): Promise<TripSummaryRow> {
    this.assertPassenger(passenger);
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    this.assertMinimumPrice(input.passengerPriceKopecks);
    const requestHash = this.hashRequest(input);
    // The server always computes distance/duration/geometry; values that might
    // arrive from the client are never trusted.
    const route = await this.estimateTripRoute(input);
    const routeWkt = this.toLineStringWkt(route);
    const routeBounds = JSON.stringify(route.bounds);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.$queryRawUnsafe<IdempotencyRecord[]>(
          `SELECT "requestHash", "tripId"
           FROM "trip_idempotency_keys"
           WHERE "passengerId" = $1 AND "key" = $2
           FOR UPDATE`,
          passenger.id,
          key,
        );

        if (existing[0]) {
          if (existing[0].requestHash !== requestHash) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'Idempotency-Key was already used with another request',
            });
          }

          const trip = await transaction.$queryRawUnsafe<TripSummaryRow[]>(
            `SELECT "id", "status", "version"
             FROM "trips"
             WHERE "id" = $1 AND "passengerId" = $2`,
            existing[0].tripId,
            passenger.id,
          );

          if (trip[0]) return trip[0];
        }

        const activeTrip = await transaction.$queryRawUnsafe<{ id: string }[]>(
          `SELECT "id"
           FROM "trips"
           WHERE "passengerId" = $1
             AND "status" IN (
                'DRAFT', 'SEARCHING', 'OFFERS_RECEIVED', 'DRIVER_SELECTED',
                'PAYMENT_PENDING', 'PAYMENT_RESERVED', 'DRIVER_EN_ROUTE',
                'DRIVER_ARRIVED', 'IN_PROGRESS'
             )
           LIMIT 1
           FOR UPDATE`,
          passenger.id,
        );

        if (activeTrip[0]) {
          throw this.activeTripConflict();
        }

        const tripId = randomUUID();
        const options = input.options ?? {};
        const created = await transaction.$queryRawUnsafe<TripSummaryRow[]>(
          `INSERT INTO "trips" (
              "id", "passengerId", "status", "passengerPriceKopecks",
              "pickupLocation", "destinationLocation", "route",
              "pickupAddress", "destinationAddress", "pickupPlaceId", "destinationPlaceId",
              "estimatedDistanceMeters", "estimatedDurationSeconds", "routeProvider", "routeBounds",
              "childSeat", "pet", "luggage", "comment",
              "createdAt", "updatedAt"
           ) VALUES (
              $1, $2, 'DRAFT', $3,
              ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
              ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
              ST_GeogFromText($8),
              $9, $10, $11, $12,
              $13, $14, $15, $16::jsonb,
              $17, $18, $19, $20, NOW(), NOW()
           )
           RETURNING "id", "status", "version"`,
          tripId,
          passenger.id,
          input.passengerPriceKopecks,
          input.pickup.longitude,
          input.pickup.latitude,
          input.destination.longitude,
          input.destination.latitude,
          routeWkt,
          input.pickupAddress,
          input.destinationAddress,
          input.pickupPlaceId ?? null,
          input.destinationPlaceId ?? null,
          route.distanceMeters,
          route.durationSeconds,
          route.provider,
          routeBounds,
          options.childSeat ?? false,
          options.pet ?? false,
          options.luggage ?? false,
          input.comment ?? null,
        );

        for (const [index, stop] of (input.stops ?? []).entries()) {
          await transaction.$queryRawUnsafe(
            `INSERT INTO "trip_stops" (
                "id", "tripId", "sequence", "location", "address"
             ) VALUES (
                $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6
             )`,
            randomUUID(),
            tripId,
            index + 1,
            stop.location.longitude,
            stop.location.latitude,
            stop.address,
          );
        }

        await transaction.$queryRawUnsafe(
          `INSERT INTO "trip_idempotency_keys" (
              "id", "passengerId", "key", "requestHash", "tripId", "createdAt"
           ) VALUES ($1, $2, $3, $4, $5, NOW())`,
          randomUUID(),
          passenger.id,
          key,
          requestHash,
          tripId,
        );

        if (!created[0]) {
          throw new Error('Trip insert did not return a row');
        }

        return created[0];
      });
    } catch (error) {
      if (this.isActiveTripUniqueViolation(error)) {
        throw this.activeTripConflict();
      }

      throw error;
    }
  }

  async getById(
    passenger: AuthenticatedUser,
    tripId: string,
  ): Promise<PassengerTripDetails> {
    this.assertPassenger(passenger);
    const rows = await this.prisma.$queryRawUnsafe<TripDetailsRow[]>(
      `SELECT
          "id", "status", "version", "passengerPriceKopecks", "finalPriceKopecks",
          "selectedDriverId", "selectedVehicleId", "pickupAddress", "destinationAddress",
          ST_Y("pickupLocation"::geometry) AS "pickupLatitude",
          ST_X("pickupLocation"::geometry) AS "pickupLongitude",
          ST_Y("destinationLocation"::geometry) AS "destinationLatitude",
          ST_X("destinationLocation"::geometry) AS "destinationLongitude",
          "estimatedDistanceMeters", "estimatedDurationSeconds", "startedAt", "completedAt", "cancelledAt",
          "createdAt", "updatedAt", "childSeat", "pet", "luggage", "comment"
       FROM "trips"
       WHERE "id" = $1 AND "passengerId" = $2`,
      tripId,
      passenger.id,
    );
    const trip = rows[0];

    if (!trip) {
      throw new NotFoundException({
        code: 'TRIP_NOT_FOUND',
        message: 'Trip was not found',
      });
    }

    const stops = await this.prisma.$queryRawUnsafe<TripStopRow[]>(
      `SELECT
          "sequence", "address",
          ST_Y("location"::geometry) AS "latitude",
          ST_X("location"::geometry) AS "longitude"
       FROM "trip_stops"
       WHERE "tripId" = $1
       ORDER BY "sequence" ASC`,
      trip.id,
    );

    return {
      id: trip.id,
      status: trip.status,
      version: trip.version,
      passengerPriceKopecks: trip.passengerPriceKopecks,
      finalPriceKopecks: trip.finalPriceKopecks,
      selectedDriverId: trip.selectedDriverId,
      selectedVehicleId: trip.selectedVehicleId,
      pickup: {
        address: trip.pickupAddress,
        latitude: Number(trip.pickupLatitude),
        longitude: Number(trip.pickupLongitude),
      },
      destination: {
        address: trip.destinationAddress,
        latitude: Number(trip.destinationLatitude),
        longitude: Number(trip.destinationLongitude),
      },
      estimatedDistanceMeters: trip.estimatedDistanceMeters,
      estimatedDurationSeconds: trip.estimatedDurationSeconds,
      startedAt: trip.startedAt,
      completedAt: trip.completedAt,
      cancelledAt: trip.cancelledAt,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
      options: {
        childSeat: trip.childSeat,
        pet: trip.pet,
        luggage: trip.luggage,
      },
      comment: trip.comment,
      stops: stops.map((stop) => ({
        ...stop,
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
      })),
    };
  }

  async startSearch(
    passenger: AuthenticatedUser,
    tripId: string,
  ): Promise<TripTransitionResult> {
    const trip = await this.findPassengerTrip(passenger, tripId);

    if (trip.status !== TripStatus.DRAFT) {
      throw new ConflictException({
        code: 'TRIP_NOT_READY_TO_SEARCH',
        message: 'Only a draft trip can start driver search',
      });
    }

    return this.stateMachine.transition({
      tripId,
      expectedVersion: trip.version,
      newStatus: TripStatus.SEARCHING,
      actorType: TripStatusActorType.PASSENGER,
      actorId: passenger.id,
    });
  }

  async cancel(
    passenger: AuthenticatedUser,
    tripId: string,
  ): Promise<TripTransitionResult> {
    const trip = await this.findPassengerTrip(passenger, tripId);

    if (trip.status === TripStatus.CANCELLED_BY_PASSENGER) {
      return trip;
    }

    try {
      const result = await this.stateMachine.transition({
        tripId,
        expectedVersion: trip.version,
        newStatus: TripStatus.CANCELLED_BY_PASSENGER,
        actorType: TripStatusActorType.PASSENGER,
        actorId: passenger.id,
      });
      await this.notifyDriverOfCancellation(trip.selectedDriverId, tripId);
      return result;
    } catch (error) {
      const latest = await this.findPassengerTrip(passenger, tripId);

      if (latest.status === TripStatus.CANCELLED_BY_PASSENGER) {
        return latest;
      }

      throw error;
    }
  }

  /** Best-effort push wake-up on top of the already-committed cancellation above (see TripLifecycleService.notifyLifecycleAction for the same reasoning). Deduplication key is the trip id itself — a trip can only be cancelled-by-passenger once. */
  private async notifyDriverOfCancellation(
    selectedDriverId: string | null,
    tripId: string,
  ): Promise<void> {
    if (!selectedDriverId) return;

    const draft = this.notifications.createDraft({
      userId: selectedDriverId,
      type: NotificationType.DRIVER_TRIP_CANCELLED,
      application: 'DRIVER' as never,
      entityType: 'TRIP',
      entityId: tripId,
      idempotencyKey: `trip-cancelled:${tripId}`,
      templateParams: { tripId },
    });
    await this.notificationOutbox.enqueue(this.prisma, draft);
  }

  private async findPassengerTrip(
    passenger: AuthenticatedUser,
    tripId: string,
  ): Promise<TripTransitionResult & { selectedDriverId: string | null }> {
    this.assertPassenger(passenger);
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: tripId,
        passengerId: passenger.id,
      },
      select: {
        id: true,
        status: true,
        version: true,
        selectedDriverId: true,
      },
    });

    if (!trip) {
      throw new NotFoundException({
        code: 'TRIP_NOT_FOUND',
        message: 'Trip was not found',
      });
    }

    return trip;
  }

  /**
   * Builds a route from pickup through any stops to the destination. Distance,
   * duration and geometry always come from the maps provider — never from the
   * client — so pricing and dispatch reason about server-owned figures.
   */
  private async estimateTripRoute(input: CreateTripDto): Promise<RouteResult> {
    const request: RouteRequest = {
      origin: {
        latitude: input.pickup.latitude,
        longitude: input.pickup.longitude,
      },
      destination: {
        latitude: input.destination.latitude,
        longitude: input.destination.longitude,
      },
      waypoints: (input.stops ?? []).map((stop, index) => ({
        latitude: stop.location.latitude,
        longitude: stop.location.longitude,
        sequence: index + 1,
      })),
      transportMode: 'driving',
      avoidTolls: false,
      avoidUnpavedRoads: false,
    };
    return this.mapsService.buildRoute(request);
  }

  /** WKT LINESTRING for ST_GeogFromText, bound as a single query parameter. */
  private toLineStringWkt(route: RouteResult): string {
    const points = route.geometry
      .map((point) => `${point.longitude} ${point.latitude}`)
      .join(', ');
    return `SRID=4326;LINESTRING(${points})`;
  }

  private assertPassenger(user: AuthenticatedUser): void {
    if (user.role !== 'PASSENGER') {
      throw new ForbiddenException({
        code: 'PASSENGER_ROLE_REQUIRED',
        message: 'Passenger role is required',
      });
    }
  }

  private assertMinimumPrice(priceKopecks: number): void {
    if (!Number.isSafeInteger(priceKopecks)) {
      throw new BadRequestException({
        code: 'INVALID_PRICE',
        message: 'Passenger price must be an integer number of kopecks',
      });
    }

    const minimum = this.configService.getOrThrow<number>(
      'trips.minPassengerPriceKopecks',
    );

    if (priceKopecks < minimum) {
      throw new BadRequestException({
        code: 'PRICE_BELOW_MINIMUM',
        message: `Passenger price must be at least ${minimum} kopecks`,
      });
    }
  }

  private normalizeIdempotencyKey(key: string | undefined): string {
    const normalized = key?.trim();

    if (!normalized || normalized.length > 255) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message:
          'Idempotency-Key header is required and must be at most 255 characters',
      });
    }

    return normalized;
  }

  private hashRequest(input: CreateTripDto): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          pickup: input.pickup,
          destination: input.destination,
          pickupAddress: input.pickupAddress,
          destinationAddress: input.destinationAddress,
          passengerPriceKopecks: input.passengerPriceKopecks,
          stops: input.stops ?? [],
          options: input.options ?? {},
          comment: input.comment ?? null,
        }),
      )
      .digest('hex');
  }

  private activeTripConflict(): ConflictException {
    return new ConflictException({
      code: 'ACTIVE_TRIP_EXISTS',
      message: 'Passenger already has an active trip',
    });
  }

  private isActiveTripUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes('trips_one_active_per_passenger_idx')
    );
  }
}
