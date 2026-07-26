import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  RealtimeEventType,
  TripStatus,
  TripStatusActorType,
} from '../generated/prisma/client.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import { PrismaService } from '../database/prisma.service.js';

export const TRIP_ALLOWED_TRANSITIONS: Readonly<
  Record<TripStatus, readonly TripStatus[]>
> = {
  [TripStatus.DRAFT]: [
    TripStatus.SEARCHING,
    TripStatus.CANCELLED_BY_PASSENGER,
    TripStatus.CANCELLED_BY_SYSTEM,
  ],
  [TripStatus.SEARCHING]: [
    TripStatus.OFFERS_RECEIVED,
    TripStatus.CANCELLED_BY_PASSENGER,
    TripStatus.CANCELLED_BY_SYSTEM,
  ],
  [TripStatus.OFFERS_RECEIVED]: [
    TripStatus.SEARCHING,
    TripStatus.DRIVER_SELECTED,
    TripStatus.CANCELLED_BY_PASSENGER,
    TripStatus.CANCELLED_BY_SYSTEM,
  ],
  [TripStatus.DRIVER_SELECTED]: [
    TripStatus.SEARCHING,
    TripStatus.PAYMENT_PENDING,
    TripStatus.CANCELLED_BY_PASSENGER,
    TripStatus.CANCELLED_BY_DRIVER,
    TripStatus.CANCELLED_BY_SYSTEM,
  ],
  [TripStatus.PAYMENT_PENDING]: [
    TripStatus.PAYMENT_RESERVED,
    TripStatus.PAYMENT_FAILED,
    TripStatus.CANCELLED_BY_PASSENGER,
    TripStatus.CANCELLED_BY_DRIVER,
    TripStatus.CANCELLED_BY_SYSTEM,
  ],
  [TripStatus.PAYMENT_RESERVED]: [
    TripStatus.DRIVER_EN_ROUTE,
    TripStatus.PAYMENT_FAILED,
    TripStatus.CANCELLED_BY_PASSENGER,
    TripStatus.CANCELLED_BY_DRIVER,
    TripStatus.CANCELLED_BY_SYSTEM,
  ],
  [TripStatus.DRIVER_EN_ROUTE]: [
    TripStatus.DRIVER_ARRIVED,
    TripStatus.CANCELLED_BY_PASSENGER,
    TripStatus.CANCELLED_BY_DRIVER,
    TripStatus.CANCELLED_BY_SYSTEM,
  ],
  [TripStatus.DRIVER_ARRIVED]: [
    TripStatus.IN_PROGRESS,
    TripStatus.CANCELLED_BY_PASSENGER,
    TripStatus.CANCELLED_BY_DRIVER,
    TripStatus.CANCELLED_BY_SYSTEM,
  ],
  [TripStatus.IN_PROGRESS]: [
    TripStatus.COMPLETED,
    TripStatus.CANCELLED_BY_PASSENGER,
    TripStatus.CANCELLED_BY_DRIVER,
    TripStatus.CANCELLED_BY_SYSTEM,
  ],
  [TripStatus.COMPLETED]: [TripStatus.SETTLED, TripStatus.DISPUTED],
  [TripStatus.SETTLED]: [TripStatus.DISPUTED, TripStatus.REFUNDED],
  [TripStatus.CANCELLED_BY_PASSENGER]: [TripStatus.REFUNDED],
  [TripStatus.CANCELLED_BY_DRIVER]: [TripStatus.REFUNDED],
  [TripStatus.CANCELLED_BY_SYSTEM]: [TripStatus.REFUNDED],
  [TripStatus.PAYMENT_FAILED]: [
    TripStatus.SEARCHING,
    TripStatus.PAYMENT_PENDING,
  ],
  [TripStatus.DISPUTED]: [TripStatus.SETTLED, TripStatus.REFUNDED],
  [TripStatus.REFUNDED]: [],
};

export interface TripTransitionInput {
  actorId?: string;
  actorType: TripStatusActorType;
  expectedVersion: number;
  newStatus: TripStatus;
  reason?: string;
  tripId: string;
}

export interface TripTransitionResult {
  id: string;
  status: TripStatus;
  version: number;
}

@Injectable()
export class TripStateMachine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeOutbox: RealtimeOutboxService,
  ) {}

  canTransition(from: TripStatus, to: TripStatus): boolean {
    return TRIP_ALLOWED_TRANSITIONS[from].includes(to);
  }

  async transition(input: TripTransitionInput): Promise<TripTransitionResult> {
    return this.prisma.$transaction(async (transaction) => {
      const trip = await transaction.trip.findUnique({
        where: { id: input.tripId },
        select: {
          id: true,
          status: true,
          version: true,
          startedAt: true,
          completedAt: true,
          cancelledAt: true,
        },
      });

      if (!trip) {
        throw new NotFoundException({
          code: 'TRIP_NOT_FOUND',
          message: 'Trip was not found',
        });
      }

      if (trip.version !== input.expectedVersion) {
        throw new ConflictException({
          code: 'TRIP_VERSION_CONFLICT',
          message: 'Trip has been changed by another operation',
        });
      }

      if (!this.canTransition(trip.status, input.newStatus)) {
        throw new ConflictException({
          code: 'INVALID_TRIP_TRANSITION',
          message: `Transition from ${trip.status} to ${input.newStatus} is not allowed`,
        });
      }

      const now = new Date();
      const updated = await transaction.trip.updateMany({
        where: {
          id: trip.id,
          status: trip.status,
          version: input.expectedVersion,
        },
        data: {
          status: input.newStatus,
          version: { increment: 1 },
          ...(input.newStatus === TripStatus.IN_PROGRESS && !trip.startedAt
            ? { startedAt: now }
            : {}),
          ...(input.newStatus === TripStatus.COMPLETED && !trip.completedAt
            ? { completedAt: now }
            : {}),
          ...(this.isCancellation(input.newStatus) && !trip.cancelledAt
            ? { cancelledAt: now }
            : {}),
        },
      });

      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'TRIP_VERSION_CONFLICT',
          message: 'Trip has been changed by another operation',
        });
      }

      await transaction.tripStatusHistory.create({
        data: {
          tripId: trip.id,
          previousStatus: trip.status,
          newStatus: input.newStatus,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          reason: input.reason ?? null,
        },
      });
      await this.realtimeOutbox.enqueueTripEvent(
        transaction,
        trip.id,
        this.realtimeEventType(input.newStatus),
        {
          tripId: trip.id,
          previousStatus: trip.status,
          status: input.newStatus,
          version: input.expectedVersion + 1,
        },
      );

      return {
        id: trip.id,
        status: input.newStatus,
        version: input.expectedVersion + 1,
      };
    });
  }

  private isCancellation(status: TripStatus): boolean {
    const cancellationStatuses: TripStatus[] = [
      TripStatus.CANCELLED_BY_PASSENGER,
      TripStatus.CANCELLED_BY_DRIVER,
      TripStatus.CANCELLED_BY_SYSTEM,
    ];

    return cancellationStatuses.includes(status);
  }

  private realtimeEventType(status: TripStatus): RealtimeEventType {
    if (status === TripStatus.SEARCHING)
      return RealtimeEventType.TRIP_SEARCHING;
    if (this.isCancellation(status)) return RealtimeEventType.TRIP_CANCELLED;
    if (status === TripStatus.DRIVER_ARRIVED) {
      return RealtimeEventType.DRIVER_ARRIVED;
    }
    if (status === TripStatus.IN_PROGRESS)
      return RealtimeEventType.TRIP_STARTED;
    if (status === TripStatus.COMPLETED)
      return RealtimeEventType.TRIP_COMPLETED;
    return RealtimeEventType.TRIP_UPDATED;
  }
}
