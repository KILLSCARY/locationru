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
import { TripStatus, TripStatusActorType } from '../generated/prisma/client.js';
import { MapsService } from '../maps/maps.service.js';
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
  destinationProviderPlaceId: string | null;
  destinationLatitude: number;
  destinationLongitude: number;
  estimatedDistanceMeters: number;
  estimatedDurationSeconds: number;
  finalPriceKopecks: number | null;
  luggage: boolean;
  passengerPriceKopecks: number;
  pet: boolean;
  pickupAddress: string;
  pickupProviderPlaceId: string | null;
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
  providerPlaceId: string | null;
}

export interface PassengerTripDetails extends TripSummaryRow {
  cancelledAt: Date | null;
  comment: string | null;
  completedAt: Date | null;
  createdAt: Date;
  destination: {
    formattedAddress: string;
    latitude: number;
    longitude: number;
    providerPlaceId: string | null;
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
    formattedAddress: string;
    latitude: number;
    longitude: number;
    providerPlaceId: string | null;
  };
  selectedDriverId: string | null;
  selectedVehicleId: string | null;
  startedAt: Date | null;
  waypoints: Array<{
    formattedAddress: string;
    latitude: number;
    longitude: number;
    providerPlaceId: string | null;
    sequence: number;
  }>;
  updatedAt: Date;
}

@Injectable()
export class TripService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stateMachine: TripStateMachine,
    private readonly maps: MapsService,
  ) {}

  async create(
    passenger: AuthenticatedUser,
    input: CreateTripDto,
    idempotencyKey: string | undefined,
  ): Promise<TripSummaryRow> {
    this.assertPassenger(passenger);
    const key = this.normalizeIdempotencyKey(idempotencyKey);
    this.assertMinimumPrice(input.passengerPriceKopecks);
    const stops = [...(input.waypoints ?? [])].sort(
      (left, right) => left.sequence - right.sequence,
    );
    if (new Set(stops.map((stop) => stop.sequence)).size !== stops.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_STOP_SEQUENCE',
        message: 'Waypoint sequence values must be unique',
      });
    }
    const requestHash = this.hashRequest(input);
    const route = await this.maps.buildRoute({
      origin: input.pickup,
      destination: input.destination,
      waypoints: stops,
      transportMode: 'CAR',
      avoidTolls: false,
      avoidUnpavedRoads: false,
    });
    const routeWkt = `SRID=4326;LINESTRING(${route.geometry.coordinates
      .map(([longitude, latitude]) => `${longitude} ${latitude}`)
      .join(',')})`;

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
              "pickupLocation", "destinationLocation", "pickupAddress", "destinationAddress",
              "pickupProviderPlaceId", "destinationProviderPlaceId",
              "estimatedDistanceMeters", "estimatedDurationSeconds", "route", "routeBounds",
              "routeProvider", "routeProviderRouteId", "childSeat", "pet", "luggage", "comment",
              "createdAt", "updatedAt"
           ) VALUES (
              $1, $2, 'DRAFT', $3,
              ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
              ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
              $8, $9, $10, $11, $12, $13, ST_GeogFromText($14), $15::jsonb,
              $16, $17, $18, $19, $20, $21, NOW(), NOW()
           )
           RETURNING "id", "status", "version"`,
          tripId,
          passenger.id,
          input.passengerPriceKopecks,
          input.pickup.longitude,
          input.pickup.latitude,
          input.destination.longitude,
          input.destination.latitude,
          input.pickup.formattedAddress,
          input.destination.formattedAddress,
          input.pickup.providerPlaceId ?? null,
          input.destination.providerPlaceId ?? null,
          route.distanceMeters,
          route.durationSeconds,
          routeWkt,
          JSON.stringify(route.bounds),
          route.provider,
          route.providerRouteId,
          options.childSeat ?? false,
          options.pet ?? false,
          options.luggage ?? false,
          input.comment ?? null,
        );

        for (const stop of stops) {
          await transaction.$queryRawUnsafe(
            `INSERT INTO "trip_stops" (
                "id", "tripId", "sequence", "location", "address", "providerPlaceId"
             ) VALUES (
                $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7
             )`,
            randomUUID(),
            tripId,
            stop.sequence,
            stop.longitude,
            stop.latitude,
            stop.formattedAddress,
            stop.providerPlaceId ?? null,
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
          "pickupProviderPlaceId", "destinationProviderPlaceId",
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
          "sequence", "address", "providerPlaceId",
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
        formattedAddress: trip.pickupAddress,
        latitude: Number(trip.pickupLatitude),
        longitude: Number(trip.pickupLongitude),
        providerPlaceId: trip.pickupProviderPlaceId,
      },
      destination: {
        formattedAddress: trip.destinationAddress,
        latitude: Number(trip.destinationLatitude),
        longitude: Number(trip.destinationLongitude),
        providerPlaceId: trip.destinationProviderPlaceId,
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
      waypoints: stops.map((stop) => ({
        sequence: stop.sequence,
        formattedAddress: stop.address,
        providerPlaceId: stop.providerPlaceId,
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
      return await this.stateMachine.transition({
        tripId,
        expectedVersion: trip.version,
        newStatus: TripStatus.CANCELLED_BY_PASSENGER,
        actorType: TripStatusActorType.PASSENGER,
        actorId: passenger.id,
      });
    } catch (error) {
      const latest = await this.findPassengerTrip(passenger, tripId);

      if (latest.status === TripStatus.CANCELLED_BY_PASSENGER) {
        return latest;
      }

      throw error;
    }
  }

  private async findPassengerTrip(
    passenger: AuthenticatedUser,
    tripId: string,
  ): Promise<TripTransitionResult> {
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
          passengerPriceKopecks: input.passengerPriceKopecks,
          waypoints: input.waypoints ?? [],
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
