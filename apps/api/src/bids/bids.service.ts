import { randomUUID } from 'node:crypto';

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
import { FareCalculator } from '../finance/fare-calculator.service.js';
import {
  type Prisma,
  DriverBidStatus,
  DriverStatus,
  DriverVerificationStatus,
  TripStatus,
  TripStatusActorType,
  VehicleStatus,
  RealtimeEventType,
} from '../generated/prisma/client.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import type { CreateDriverBidDto } from './dto/create-driver-bid.dto.js';

interface LockedTrip {
  cityCode: string | null;
  id: string;
  passengerId: string;
  passengerPriceKopecks: number;
  selectedDriverId: string | null;
  status: TripStatus;
  version: number;
}

interface PickupMetrics {
  distanceToPickupMeters: number;
  estimatedPickupSeconds: number;
}

export interface AvailableDriverTrip extends PickupMetrics {
  passengerPriceKopecks: number;
  pickupAddress: string;
  pickupLatitude: number;
  pickupLongitude: number;
  destinationAddress: string;
  estimatedDistanceMeters: number;
  estimatedDurationSeconds: number;
  tripId: string;
}

export interface DriverBidResponse extends PickupMetrics {
  expiresAt: Date;
  id: string;
  offeredPriceKopecks: number;
  status: DriverBidStatus;
  tripId: string;
  vehicleId: string;
  version: number;
}

export interface PassengerBidResponse extends DriverBidResponse {
  driver: {
    firstName: string;
    lastName: string;
    rating: number;
  };
  vehicle: {
    brand: string;
    color: string;
    model: string;
    registrationNumber: string;
  };
}

export interface SelectedBidResponse {
  bidId: string;
  commissionKopecks: number;
  driverPayoutKopecks: number;
  finalPriceKopecks: number;
  status: TripStatus;
  tripId: string;
  version: number;
}

@Injectable()
export class BidsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly fareCalculator: FareCalculator,
    private readonly realtimeOutbox: RealtimeOutboxService,
  ) {}

  async getAvailableTrips(
    driver: AuthenticatedUser,
  ): Promise<AvailableDriverTrip[]> {
    this.assertDriver(driver);
    await this.prisma.$transaction((transaction) =>
      this.expireActiveBids(transaction, undefined, driver.id),
    );

    return this.prisma.$queryRawUnsafe<AvailableDriverTrip[]>(
      `SELECT DISTINCT ON ("dispatch_attempts"."tripId")
          "dispatch_attempts"."tripId" AS "tripId",
          "trips"."passengerPriceKopecks",
          "trips"."pickupAddress",
          "trips"."destinationAddress",
          "trips"."estimatedDistanceMeters",
          "trips"."estimatedDurationSeconds",
          "dispatch_attempt_logs"."estimatedPickupSeconds",
          "dispatch_attempt_logs"."distanceMeters" AS "distanceToPickupMeters"
       FROM "dispatch_attempt_logs"
       INNER JOIN "dispatch_attempts"
         ON "dispatch_attempts"."id" = "dispatch_attempt_logs"."attemptId"
       INNER JOIN "trips"
         ON "trips"."id" = "dispatch_attempts"."tripId"
       WHERE "dispatch_attempt_logs"."driverId" = $1
         AND "trips"."status" IN ('SEARCHING', 'OFFERS_RECEIVED')
         AND "trips"."selectedDriverId" IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM "driver_bids"
           WHERE "driver_bids"."tripId" = "trips"."id"
             AND "driver_bids"."driverId" = $1
             AND "driver_bids"."status" = 'ACTIVE'
             AND "driver_bids"."expiresAt" > NOW()
         )
       ORDER BY "dispatch_attempts"."tripId", "dispatch_attempt_logs"."createdAt" DESC`,
      driver.id,
    );
  }

  async create(
    driver: AuthenticatedUser,
    tripId: string,
    input: CreateDriverBidDto,
  ): Promise<DriverBidResponse> {
    this.assertDriver(driver);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const trip = await this.lockTrip(transaction, tripId);
        this.assertTripAcceptsBids(trip);
        await this.expireActiveBids(transaction, trip.id);
        await this.assertEligibleDriver(
          transaction,
          driver.id,
          input.vehicleId,
        );
        await this.assertDriverWasDispatched(transaction, trip.id, driver.id);

        const offeredPriceKopecks =
          input.offeredPriceKopecks ?? trip.passengerPriceKopecks;
        this.assertOfferedPrice(offeredPriceKopecks);
        const metrics = await this.calculatePickupMetrics(
          transaction,
          trip.id,
          driver.id,
        );
        const expiresAt = new Date(
          Date.now() +
            this.configService.getOrThrow<number>('bids.ttlSeconds') * 1_000,
        );
        const bid = await transaction.driverBid.create({
          data: {
            id: randomUUID(),
            tripId: trip.id,
            driverId: driver.id,
            vehicleId: input.vehicleId,
            offeredPriceKopecks,
            estimatedPickupSeconds: metrics.estimatedPickupSeconds,
            distanceToPickupMeters: metrics.distanceToPickupMeters,
            expiresAt,
          },
          select: {
            id: true,
            tripId: true,
            vehicleId: true,
            offeredPriceKopecks: true,
            estimatedPickupSeconds: true,
            distanceToPickupMeters: true,
            status: true,
            expiresAt: true,
            version: true,
          },
        });

        if (trip.status === TripStatus.SEARCHING) {
          const moved = await transaction.trip.updateMany({
            where: {
              id: trip.id,
              status: TripStatus.SEARCHING,
              version: trip.version,
            },
            data: {
              status: TripStatus.OFFERS_RECEIVED,
              version: { increment: 1 },
            },
          });
          if (moved.count !== 1) throw this.tripVersionConflict();

          await transaction.tripStatusHistory.create({
            data: {
              tripId: trip.id,
              previousStatus: TripStatus.SEARCHING,
              newStatus: TripStatus.OFFERS_RECEIVED,
              actorType: TripStatusActorType.DRIVER,
              actorId: driver.id,
              reason: 'First driver bid received',
            },
          });
        }

        await this.realtimeOutbox.enqueueTripEvent(
          transaction,
          trip.id,
          RealtimeEventType.BID_CREATED,
          this.bidEventPayload(bid, driver.id),
        );

        return bid;
      });
    } catch (error) {
      if (this.isActiveBidUniqueViolation(error)) {
        throw new ConflictException({
          code: 'ACTIVE_BID_EXISTS',
          message: 'Driver already has an active bid for this trip',
        });
      }
      throw error;
    }
  }

  async withdraw(
    driver: AuthenticatedUser,
    tripId: string,
    bidId: string,
  ): Promise<DriverBidResponse> {
    this.assertDriver(driver);

    return this.prisma.$transaction(async (transaction) => {
      await this.lockTrip(transaction, tripId);
      await this.expireActiveBids(transaction, tripId);
      const bid = await transaction.driverBid.findFirst({
        where: { id: bidId, tripId, driverId: driver.id },
        select: {
          id: true,
          tripId: true,
          vehicleId: true,
          offeredPriceKopecks: true,
          estimatedPickupSeconds: true,
          distanceToPickupMeters: true,
          status: true,
          expiresAt: true,
          version: true,
        },
      });
      if (!bid) throw this.bidNotFound();
      if (bid.status !== DriverBidStatus.ACTIVE) {
        throw new ConflictException({
          code: 'BID_NOT_ACTIVE',
          message: 'Only an active bid can be withdrawn',
        });
      }

      const updated = await transaction.driverBid.updateMany({
        where: {
          id: bid.id,
          status: DriverBidStatus.ACTIVE,
          version: bid.version,
        },
        data: {
          status: DriverBidStatus.WITHDRAWN,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw this.bidVersionConflict();

      const withdrawn = {
        ...bid,
        status: DriverBidStatus.WITHDRAWN,
        version: bid.version + 1,
      };
      await this.realtimeOutbox.enqueueTripEvent(
        transaction,
        tripId,
        RealtimeEventType.BID_WITHDRAWN,
        this.bidEventPayload(withdrawn, driver.id),
      );

      return withdrawn;
    });
  }

  async listForPassenger(
    passenger: AuthenticatedUser,
    tripId: string,
  ): Promise<PassengerBidResponse[]> {
    this.assertPassenger(passenger);
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, passengerId: passenger.id },
      select: { id: true },
    });
    if (!trip) throw this.tripNotFound();

    await this.prisma.$transaction((transaction) =>
      this.expireActiveBids(transaction, trip.id),
    );
    const bids = await this.prisma.driverBid.findMany({
      where: {
        tripId: trip.id,
        status: DriverBidStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      orderBy: [
        { estimatedPickupSeconds: 'asc' },
        { distanceToPickupMeters: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        tripId: true,
        vehicleId: true,
        offeredPriceKopecks: true,
        estimatedPickupSeconds: true,
        distanceToPickupMeters: true,
        status: true,
        expiresAt: true,
        version: true,
        driver: {
          select: { firstName: true, lastName: true, rating: true },
        },
        vehicle: {
          select: {
            brand: true,
            model: true,
            color: true,
            registrationNumber: true,
          },
        },
      },
    });

    return bids.map((bid) => ({
      ...bid,
      driver: { ...bid.driver, rating: Number(bid.driver.rating) },
    }));
  }

  async select(
    passenger: AuthenticatedUser,
    tripId: string,
    bidId: string,
  ): Promise<SelectedBidResponse> {
    this.assertPassenger(passenger);

    return this.prisma.$transaction(async (transaction) => {
      const trip = await this.lockTrip(transaction, tripId);
      if (trip.passengerId !== passenger.id) throw this.tripNotFound();
      this.assertTripAcceptsBids(trip);
      await this.expireActiveBids(transaction, trip.id);

      const bid = await transaction.driverBid.findFirst({
        where: {
          id: bidId,
          tripId: trip.id,
          status: DriverBidStatus.ACTIVE,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          driverId: true,
          vehicleId: true,
          offeredPriceKopecks: true,
          status: true,
          version: true,
          vehicle: { select: { driverId: true, status: true } },
        },
      });
      if (!bid) throw this.bidNotFound();
      if (
        bid.vehicle.driverId !== bid.driverId ||
        bid.vehicle.status !== VehicleStatus.APPROVED
      ) {
        throw new ConflictException({
          code: 'BID_VEHICLE_NOT_ELIGIBLE',
          message: 'The vehicle attached to this bid is no longer eligible',
        });
      }

      const fare = await this.fareCalculator.calculateForDriver(
        {
          driverId: bid.driverId,
          cityCode: trip.cityCode,
          totalKopecks: bid.offeredPriceKopecks,
        },
        transaction,
      );
      const moved = await transaction.trip.updateMany({
        where: {
          id: trip.id,
          status: trip.status,
          selectedDriverId: null,
          version: trip.version,
        },
        data: {
          status: TripStatus.DRIVER_SELECTED,
          selectedDriverId: bid.driverId,
          selectedVehicleId: bid.vehicleId,
          finalPriceKopecks: fare.totalKopecks,
          commissionBasisPoints: fare.commissionBasisPoints,
          commissionKopecks: fare.commissionKopecks,
          driverPayoutKopecks: fare.driverPayoutKopecks,
          version: { increment: 1 },
        },
      });
      if (moved.count !== 1) throw this.tripVersionConflict();

      const accepted = await transaction.driverBid.updateMany({
        where: {
          id: bid.id,
          status: DriverBidStatus.ACTIVE,
          version: bid.version,
        },
        data: {
          status: DriverBidStatus.ACCEPTED,
          version: { increment: 1 },
        },
      });
      if (accepted.count !== 1) throw this.bidVersionConflict();

      await transaction.driverBid.updateMany({
        where: {
          tripId: trip.id,
          id: { not: bid.id },
          status: DriverBidStatus.ACTIVE,
        },
        data: {
          status: DriverBidStatus.REJECTED,
          version: { increment: 1 },
        },
      });
      await transaction.tripStatusHistory.create({
        data: {
          tripId: trip.id,
          previousStatus: trip.status,
          newStatus: TripStatus.DRIVER_SELECTED,
          actorType: TripStatusActorType.PASSENGER,
          actorId: passenger.id,
          reason: 'Passenger selected a driver bid',
        },
      });
      await this.realtimeOutbox.enqueueTripEvent(
        transaction,
        trip.id,
        RealtimeEventType.BID_ACCEPTED,
        {
          bidId: bid.id,
          tripId: trip.id,
          driverId: bid.driverId,
          vehicleId: bid.vehicleId,
          offeredPriceKopecks: bid.offeredPriceKopecks,
          status: DriverBidStatus.ACCEPTED,
          version: bid.version + 1,
        },
      );

      return {
        tripId: trip.id,
        bidId: bid.id,
        status: TripStatus.DRIVER_SELECTED,
        finalPriceKopecks: fare.totalKopecks,
        commissionKopecks: fare.commissionKopecks,
        driverPayoutKopecks: fare.driverPayoutKopecks,
        version: trip.version + 1,
      };
    });
  }

  private async lockTrip(
    transaction: Prisma.TransactionClient,
    tripId: string,
  ): Promise<LockedTrip> {
    const trips = await transaction.$queryRawUnsafe<LockedTrip[]>(
      `SELECT "id", "passengerId", "passengerPriceKopecks", "status", "version", "selectedDriverId", "cityCode"
       FROM "trips"
       WHERE "id" = $1
       FOR UPDATE`,
      tripId,
    );
    if (!trips[0]) throw this.tripNotFound();
    return trips[0];
  }

  private async assertEligibleDriver(
    transaction: Prisma.TransactionClient,
    driverId: string,
    vehicleId: string,
  ): Promise<void> {
    const profile = await transaction.driverProfile.findUnique({
      where: { userId: driverId },
      select: {
        status: true,
        verificationStatus: true,
      },
    });
    if (
      !profile ||
      profile.status !== DriverStatus.ONLINE ||
      profile.verificationStatus !== DriverVerificationStatus.APPROVED
    ) {
      throw new ForbiddenException({
        code: 'DRIVER_NOT_AVAILABLE',
        message: 'Only an approved ONLINE driver can create a bid',
      });
    }

    const vehicle = await transaction.vehicle.findFirst({
      where: {
        id: vehicleId,
        driverId,
        status: VehicleStatus.APPROVED,
      },
      select: { id: true },
    });
    if (!vehicle) {
      throw new ForbiddenException({
        code: 'APPROVED_VEHICLE_REQUIRED',
        message: 'Bid requires an approved vehicle owned by the driver',
      });
    }
  }

  private async assertDriverWasDispatched(
    transaction: Prisma.TransactionClient,
    tripId: string,
    driverId: string,
  ): Promise<void> {
    const candidate = await transaction.dispatchAttemptLog.findFirst({
      where: { driverId, attempt: { tripId } },
      select: { id: true },
    });
    if (!candidate) {
      throw new ForbiddenException({
        code: 'TRIP_NOT_AVAILABLE_TO_DRIVER',
        message: 'The trip has not been offered to this driver',
      });
    }
  }

  private async calculatePickupMetrics(
    transaction: Prisma.TransactionClient,
    tripId: string,
    driverId: string,
  ): Promise<PickupMetrics> {
    const locationMaxAgeSeconds = this.configService.getOrThrow<number>(
      'dispatch.locationMaxAgeSeconds',
    );
    const averageSpeedMetersPerSecond = this.configService.getOrThrow<number>(
      'dispatch.averageSpeedMetersPerSecond',
    );
    const rows = await transaction.$queryRawUnsafe<PickupMetrics[]>(
      `WITH "latestLocation" AS (
          SELECT "location"
          FROM "driver_locations"
          WHERE "driverId" = $1
            AND "stale" = false
            AND "recordedAt" >= NOW() - ($3 * INTERVAL '1 second')
          ORDER BY "recordedAt" DESC
          LIMIT 1
        )
       SELECT
          ROUND(ST_Distance("latestLocation"."location", "trips"."pickupLocation"))::integer AS "distanceToPickupMeters",
          CEIL(ST_Distance("latestLocation"."location", "trips"."pickupLocation") / $4)::integer AS "estimatedPickupSeconds"
       FROM "latestLocation"
       CROSS JOIN "trips"
       WHERE "trips"."id" = $2`,
      driverId,
      tripId,
      locationMaxAgeSeconds,
      averageSpeedMetersPerSecond,
    );
    if (!rows[0]) {
      throw new ConflictException({
        code: 'FRESH_DRIVER_LOCATION_REQUIRED',
        message: 'A fresh driver location is required to create a bid',
      });
    }

    return rows[0];
  }

  private async expireActiveBids(
    transaction: Prisma.TransactionClient | PrismaService,
    tripId?: string,
    driverId?: string,
  ): Promise<void> {
    const expiring = await transaction.driverBid.findMany({
      where: {
        ...(tripId ? { tripId } : {}),
        ...(driverId ? { driverId } : {}),
        status: DriverBidStatus.ACTIVE,
        expiresAt: { lte: new Date() },
      },
      select: {
        id: true,
        tripId: true,
        driverId: true,
        vehicleId: true,
        offeredPriceKopecks: true,
        expiresAt: true,
        version: true,
      },
    });
    if (!expiring.length) return;

    await transaction.driverBid.updateMany({
      where: { id: { in: expiring.map((bid) => bid.id) } },
      data: {
        status: DriverBidStatus.EXPIRED,
        version: { increment: 1 },
      },
    });
    for (const bid of expiring) {
      await this.realtimeOutbox.enqueueTripEvent(
        transaction,
        bid.tripId,
        RealtimeEventType.BID_EXPIRED,
        {
          bidId: bid.id,
          tripId: bid.tripId,
          driverId: bid.driverId,
          vehicleId: bid.vehicleId,
          offeredPriceKopecks: bid.offeredPriceKopecks,
          expiresAt: bid.expiresAt.toISOString(),
          status: DriverBidStatus.EXPIRED,
          version: bid.version + 1,
        },
      );
    }
  }

  private assertTripAcceptsBids(trip: LockedTrip): void {
    if (trip.selectedDriverId) {
      throw new ConflictException({
        code: 'DRIVER_ALREADY_SELECTED',
        message: 'A driver has already been selected for this trip',
      });
    }
    if (
      trip.status !== TripStatus.SEARCHING &&
      trip.status !== TripStatus.OFFERS_RECEIVED
    ) {
      throw new ConflictException({
        code: 'TRIP_NOT_ACCEPTING_BIDS',
        message: 'Trip is not accepting driver bids',
      });
    }
  }

  private assertOfferedPrice(priceKopecks: number): void {
    const minimum = this.configService.getOrThrow<number>(
      'trips.minPassengerPriceKopecks',
    );
    if (!Number.isSafeInteger(priceKopecks) || priceKopecks < minimum) {
      throw new BadRequestException({
        code: 'BID_PRICE_BELOW_MINIMUM',
        message: `Bid price must be an integer of at least ${minimum} kopecks`,
      });
    }
  }

  private assertDriver(user: AuthenticatedUser): void {
    if (user.role !== 'DRIVER') {
      throw new ForbiddenException({
        code: 'DRIVER_ROLE_REQUIRED',
        message: 'Driver role is required',
      });
    }
  }

  private assertPassenger(user: AuthenticatedUser): void {
    if (user.role !== 'PASSENGER') {
      throw new ForbiddenException({
        code: 'PASSENGER_ROLE_REQUIRED',
        message: 'Passenger role is required',
      });
    }
  }

  private tripNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'TRIP_NOT_FOUND',
      message: 'Trip was not found',
    });
  }

  private bidNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'BID_NOT_FOUND',
      message: 'Bid was not found',
    });
  }

  private tripVersionConflict(): ConflictException {
    return new ConflictException({
      code: 'TRIP_VERSION_CONFLICT',
      message: 'Trip has been changed by another operation',
    });
  }

  private bidVersionConflict(): ConflictException {
    return new ConflictException({
      code: 'BID_VERSION_CONFLICT',
      message: 'Bid has been changed by another operation',
    });
  }

  private isActiveBidUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes('driver_bids_one_active_per_trip_driver_idx')
    );
  }

  private bidEventPayload(
    bid: DriverBidResponse,
    driverId: string,
  ): Record<string, unknown> {
    return {
      bidId: bid.id,
      tripId: bid.tripId,
      driverId,
      vehicleId: bid.vehicleId,
      offeredPriceKopecks: bid.offeredPriceKopecks,
      expiresAt: bid.expiresAt.toISOString(),
      status: bid.status,
      version: bid.version,
    };
  }
}
