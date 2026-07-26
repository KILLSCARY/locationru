import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

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
  type Prisma,
  TripPaymentStatus,
  TripStatus,
  TripStatusActorType,
} from '../generated/prisma/client.js';
import {
  TripStateMachine,
  type TripTransitionResult,
} from '../trips/trip-state-machine.service.js';
import { TestPaymentProvider } from './test-payment.provider.js';

type LifecycleAction =
  | 'CONFIRM_DEPARTURE'
  | 'AUTHORIZE_PAYMENT'
  | 'START_EN_ROUTE'
  | 'ARRIVE'
  | 'START_TRIP'
  | 'COMPLETE_TRIP';

@Injectable()
export class TripLifecycleService {
  constructor(
    private readonly config: ConfigService,
    private readonly paymentProvider: TestPaymentProvider,
    private readonly prisma: PrismaService,
    private readonly stateMachine: TripStateMachine,
  ) {}

  async confirmDeparture(
    driver: AuthenticatedUser,
    tripId: string,
    key: string,
  ): Promise<TripTransitionResult> {
    const trip = await this.driverTrip(driver, tripId);
    return this.execute(driver, tripId, key, 'CONFIRM_DEPARTURE', async () => {
      this.assertStatus(trip.status, TripStatus.DRIVER_SELECTED);
      return this.stateMachine.transition({
        tripId,
        expectedVersion: trip.version,
        newStatus: TripStatus.PAYMENT_PENDING,
        actorId: driver.id,
        actorType: TripStatusActorType.DRIVER,
        reason: 'Driver confirmed departure',
      });
    });
  }

  async authorizePayment(
    passenger: AuthenticatedUser,
    tripId: string,
    key: string,
  ): Promise<TripTransitionResult> {
    const trip = await this.passengerTrip(passenger, tripId);
    return this.execute(
      passenger,
      tripId,
      key,
      'AUTHORIZE_PAYMENT',
      async () => {
        this.assertStatus(trip.status, TripStatus.PAYMENT_PENDING);
        const reservation = await this.paymentProvider.reserve(
          trip.finalPriceKopecks ?? trip.passengerPriceKopecks,
        );
        await this.prisma.tripPayment.upsert({
          where: { tripId },
          create: {
            tripId,
            providerReference: reservation.reference,
            reservedAmountKopecks:
              trip.finalPriceKopecks ?? trip.passengerPriceKopecks,
            status: TripPaymentStatus.RESERVED,
          },
          update: {},
        });
        return this.stateMachine.transition({
          tripId,
          expectedVersion: trip.version,
          newStatus: TripStatus.PAYMENT_RESERVED,
          actorId: passenger.id,
          actorType: TripStatusActorType.PAYMENT,
          reason: 'Test payment reservation confirmed',
        });
      },
    );
  }

  async startEnRoute(
    driver: AuthenticatedUser,
    tripId: string,
    key: string,
  ): Promise<TripTransitionResult> {
    const trip = await this.driverTrip(driver, tripId);
    return this.execute(driver, tripId, key, 'START_EN_ROUTE', async () => {
      this.assertStatus(trip.status, TripStatus.PAYMENT_RESERVED);
      const payment = await this.prisma.tripPayment.findUnique({
        where: { tripId },
      });
      if (payment?.status !== TripPaymentStatus.RESERVED)
        throw new ConflictException({
          code: 'PAYMENT_NOT_RESERVED',
          message: 'Payment must be reserved before departure',
        });
      return this.stateMachine.transition({
        tripId,
        expectedVersion: trip.version,
        newStatus: TripStatus.DRIVER_EN_ROUTE,
        actorId: driver.id,
        actorType: TripStatusActorType.DRIVER,
        reason: 'Driver started route to pickup',
      });
    });
  }

  async arrive(
    driver: AuthenticatedUser,
    tripId: string,
    key: string,
  ): Promise<TripTransitionResult> {
    const trip = await this.driverTrip(driver, tripId);
    return this.execute(driver, tripId, key, 'ARRIVE', async () => {
      this.assertStatus(trip.status, TripStatus.DRIVER_EN_ROUTE);
      return this.stateMachine.transition({
        tripId,
        expectedVersion: trip.version,
        newStatus: TripStatus.DRIVER_ARRIVED,
        actorId: driver.id,
        actorType: TripStatusActorType.DRIVER,
        reason: 'Driver arrived at pickup',
      });
    });
  }

  async issueBoardingCode(
    passenger: AuthenticatedUser,
    tripId: string,
  ): Promise<{ code: string; expiresAt: Date }> {
    const trip = await this.passengerTrip(passenger, tripId);
    this.assertStatus(trip.status, TripStatus.DRIVER_ARRIVED);
    const existing = await this.prisma.tripBoardingCode.findUnique({
      where: { tripId },
    });
    if (existing)
      throw new ConflictException({
        code: 'BOARDING_CODE_ALREADY_ISSUED',
        message: 'Boarding code has already been issued',
      });
    const code = String(randomInt(1000, 10_000));
    const expiresAt = new Date(
      Date.now() +
        this.config.getOrThrow<number>('trips.boardingCodeTtlSeconds') * 1_000,
    );
    await this.prisma.tripBoardingCode.create({
      data: { tripId, codeHash: this.hashCode(code), expiresAt },
    });
    return { code, expiresAt };
  }

  async startTrip(
    driver: AuthenticatedUser,
    tripId: string,
    code: string,
    key: string,
  ): Promise<TripTransitionResult> {
    const trip = await this.driverTrip(driver, tripId);
    return this.execute(driver, tripId, key, 'START_TRIP', async () => {
      this.assertStatus(trip.status, TripStatus.DRIVER_ARRIVED);
      const boarding = await this.prisma.tripBoardingCode.findUnique({
        where: { tripId },
      });
      if (!boarding || boarding.usedAt || boarding.expiresAt <= new Date())
        throw new ConflictException({
          code: 'BOARDING_CODE_UNAVAILABLE',
          message: 'Boarding code is unavailable or expired',
        });
      if (
        boarding.attempts >=
        this.config.getOrThrow<number>('trips.boardingCodeMaxAttempts')
      )
        throw new ConflictException({
          code: 'BOARDING_CODE_ATTEMPTS_EXCEEDED',
          message: 'Boarding code attempt limit exceeded',
        });
      if (!this.matchesCode(code, boarding.codeHash)) {
        await this.prisma.tripBoardingCode.update({
          where: { tripId },
          data: { attempts: { increment: 1 } },
        });
        throw new BadRequestException({
          code: 'INVALID_BOARDING_CODE',
          message: 'Boarding code is invalid',
        });
      }
      await this.prisma.tripBoardingCode.update({
        where: { tripId },
        data: { usedAt: new Date() },
      });
      return this.stateMachine.transition({
        tripId,
        expectedVersion: trip.version,
        newStatus: TripStatus.IN_PROGRESS,
        actorId: driver.id,
        actorType: TripStatusActorType.DRIVER,
        reason: 'Boarding code verified',
      });
    });
  }

  async completeTrip(
    driver: AuthenticatedUser,
    tripId: string,
    key: string,
  ): Promise<TripTransitionResult> {
    const trip = await this.driverTrip(driver, tripId);
    return this.execute(driver, tripId, key, 'COMPLETE_TRIP', async () => {
      this.assertStatus(trip.status, TripStatus.IN_PROGRESS);
      const completed = await this.stateMachine.transition({
        tripId,
        expectedVersion: trip.version,
        newStatus: TripStatus.COMPLETED,
        actorId: driver.id,
        actorType: TripStatusActorType.DRIVER,
        reason: 'Driver completed trip',
      });
      const payment = await this.prisma.tripPayment.findUnique({
        where: { tripId },
      });
      if (!payment)
        throw new ConflictException({
          code: 'PAYMENT_NOT_FOUND',
          message: 'Payment reservation was not found',
        });
      await this.paymentProvider.capture(payment.providerReference);
      await this.prisma.tripPayment.update({
        where: { tripId },
        data: { status: TripPaymentStatus.SETTLED, settledAt: new Date() },
      });
      return this.stateMachine.transition({
        tripId,
        expectedVersion: completed.version,
        newStatus: TripStatus.SETTLED,
        actorType: TripStatusActorType.PAYMENT,
        reason: 'Test payment settlement confirmed',
      });
    });
  }

  private async execute(
    user: AuthenticatedUser,
    tripId: string,
    key: string,
    action: LifecycleAction,
    run: () => Promise<TripTransitionResult>,
  ): Promise<TripTransitionResult> {
    const idempotencyKey = key.trim();
    if (!idempotencyKey || idempotencyKey.length > 255)
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key header is required',
      });
    const existing = await this.prisma.tripLifecycleAction.findFirst({
      where: { tripId, action, actorId: user.id, idempotencyKey },
    });
    if (existing) return existing.result as unknown as TripTransitionResult;
    const result = await run();
    await this.prisma.tripLifecycleAction.create({
      data: {
        tripId,
        action,
        actorId: user.id,
        actorType:
          user.role === 'DRIVER'
            ? TripStatusActorType.DRIVER
            : TripStatusActorType.PASSENGER,
        idempotencyKey,
        result: result as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  private async passengerTrip(user: AuthenticatedUser, tripId: string) {
    if (user.role !== 'PASSENGER')
      throw new ForbiddenException({
        code: 'PASSENGER_ROLE_REQUIRED',
        message: 'Passenger role is required',
      });
    return this.findTrip(tripId, { passengerId: user.id });
  }

  private async driverTrip(user: AuthenticatedUser, tripId: string) {
    if (user.role !== 'DRIVER')
      throw new ForbiddenException({
        code: 'DRIVER_ROLE_REQUIRED',
        message: 'Driver role is required',
      });
    return this.findTrip(tripId, { selectedDriverId: user.id });
  }

  private async findTrip(
    tripId: string,
    where: { passengerId?: string; selectedDriverId?: string },
  ) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, ...where },
      select: {
        id: true,
        status: true,
        version: true,
        passengerPriceKopecks: true,
        finalPriceKopecks: true,
      },
    });
    if (!trip)
      throw new NotFoundException({
        code: 'TRIP_NOT_FOUND',
        message: 'Trip was not found',
      });
    return trip;
  }

  private assertStatus(actual: TripStatus, expected: TripStatus): void {
    if (actual !== expected)
      throw new ConflictException({
        code: 'INVALID_TRIP_STATUS',
        message: `Expected ${expected}, received ${actual}`,
      });
  }

  private hashCode(code: string): string {
    return createHash('sha256')
      .update(
        `${this.config.getOrThrow<string>('trips.boardingCodeHashSecret')}:${code}`,
      )
      .digest('hex');
  }

  private matchesCode(code: string, expectedHash: string): boolean {
    const actualHash = this.hashCode(code);
    return timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash));
  }
}
