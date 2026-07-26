import { ConflictException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import {
  TripStateMachine,
  type TripTransitionInput,
} from './trip-state-machine.service.js';
import { TripStatus, TripStatusActorType } from '../generated/prisma/client.js';

const EXPECTED_TRANSITIONS: Readonly<
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

interface InMemoryTrip {
  cancelledAt: Date | null;
  completedAt: Date | null;
  id: string;
  startedAt: Date | null;
  status: TripStatus;
  version: number;
}

class InMemoryTripTransaction {
  readonly history: Array<Record<string, unknown>> = [];

  constructor(readonly tripRecord: InMemoryTrip) {}

  readonly trip = {
    findUnique: async () => ({ ...this.tripRecord }),
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status: TripStatus; version: number };
      data: {
        cancelledAt?: Date;
        completedAt?: Date;
        startedAt?: Date;
        status: TripStatus;
        version: { increment: number };
      };
    }) => {
      if (
        where.id !== this.tripRecord.id ||
        where.status !== this.tripRecord.status ||
        where.version !== this.tripRecord.version
      ) {
        return { count: 0 };
      }

      this.tripRecord.status = data.status;
      this.tripRecord.version += data.version.increment;
      this.tripRecord.startedAt = data.startedAt ?? this.tripRecord.startedAt;
      this.tripRecord.completedAt =
        data.completedAt ?? this.tripRecord.completedAt;
      this.tripRecord.cancelledAt =
        data.cancelledAt ?? this.tripRecord.cancelledAt;

      return { count: 1 };
    },
  };

  readonly tripStatusHistory = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.history.push(data);
      return data;
    },
  };
}

class InMemoryPrisma {
  constructor(private readonly transaction: InMemoryTripTransaction) {}

  async $transaction<T>(
    callback: (transaction: InMemoryTripTransaction) => Promise<T>,
  ): Promise<T> {
    return callback(this.transaction);
  }
}

describe('TripStateMachine', () => {
  it('accepts every centrally specified transition and rejects every other status pair', () => {
    const machine = createMachine(TripStatus.DRAFT).machine;
    const statuses = Object.values(TripStatus);

    for (const from of statuses) {
      for (const to of statuses) {
        expect(machine.canTransition(from, to)).toBe(
          EXPECTED_TRANSITIONS[from].includes(to),
        );
      }
    }
  });

  it('updates a trip, increments its version and records history in one transaction', async () => {
    const { machine, transaction } = createMachine(TripStatus.DRIVER_ARRIVED);

    await expect(
      machine.transition(transitionInput(TripStatus.IN_PROGRESS)),
    ).resolves.toEqual({
      id: 'trip-1',
      status: TripStatus.IN_PROGRESS,
      version: 1,
    });

    expect(transaction.tripRecord).toMatchObject({
      status: TripStatus.IN_PROGRESS,
      version: 1,
    });
    expect(transaction.tripRecord.startedAt).toBeInstanceOf(Date);
    expect(transaction.history).toEqual([
      expect.objectContaining({
        tripId: 'trip-1',
        previousStatus: TripStatus.DRIVER_ARRIVED,
        newStatus: TripStatus.IN_PROGRESS,
        actorType: TripStatusActorType.DRIVER,
      }),
    ]);
  });

  it('does not mutate a trip or write history for a prohibited transition', async () => {
    const { machine, transaction } = createMachine(TripStatus.DRAFT);

    await expect(
      machine.transition(transitionInput(TripStatus.SETTLED)),
    ).rejects.toMatchObject<Partial<ConflictException>>({
      response: expect.objectContaining({ code: 'INVALID_TRIP_TRANSITION' }),
    });

    expect(transaction.tripRecord).toMatchObject({
      status: TripStatus.DRAFT,
      version: 0,
    });
    expect(transaction.history).toHaveLength(0);
  });

  it('rejects a transition made against a stale version', async () => {
    const { machine, transaction } = createMachine(TripStatus.DRAFT);

    await expect(
      machine.transition({
        ...transitionInput(TripStatus.SEARCHING),
        expectedVersion: 9,
      }),
    ).rejects.toMatchObject<Partial<ConflictException>>({
      response: expect.objectContaining({ code: 'TRIP_VERSION_CONFLICT' }),
    });

    expect(transaction.history).toHaveLength(0);
  });
});

function createMachine(status: TripStatus): {
  machine: TripStateMachine;
  transaction: InMemoryTripTransaction;
} {
  const transaction = new InMemoryTripTransaction({
    id: 'trip-1',
    status,
    version: 0,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
  });

  return {
    machine: new TripStateMachine(
      new InMemoryPrisma(transaction) as unknown as PrismaService,
      {
        enqueueTripEvent: async () => undefined,
      } as unknown as RealtimeOutboxService,
    ),
    transaction,
  };
}

function transitionInput(newStatus: TripStatus): TripTransitionInput {
  return {
    tripId: 'trip-1',
    expectedVersion: 0,
    newStatus,
    actorType: TripStatusActorType.DRIVER,
    actorId: '00000000-0000-4000-8000-000000000001',
  };
}
