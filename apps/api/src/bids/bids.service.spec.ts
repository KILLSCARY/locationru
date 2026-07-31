import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { FareCalculator } from '../finance/fare-calculator.service.js';
import type { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import { DriverBidStatus, TripStatus } from '../generated/prisma/client.js';
import { BidsService } from './bids.service.js';

const passenger: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000001',
  phone: '+79990000000',
  role: 'PASSENGER',
  sessionId: '00000000-0000-4000-8000-000000000002',
};

class ConcurrentBidPrisma {
  private lock = Promise.resolve();
  readonly history: Array<Record<string, unknown>> = [];
  readonly tripState = {
    id: 'trip-1',
    passengerId: passenger.id,
    passengerPriceKopecks: 10_000,
    selectedDriverId: null as string | null,
    status: TripStatus.OFFERS_RECEIVED,
    version: 0,
  };
  readonly bids = new Map([
    [
      'bid-1',
      {
        id: 'bid-1',
        driverId: 'driver-1',
        vehicleId: 'vehicle-1',
        offeredPriceKopecks: 12_000,
        status: DriverBidStatus.ACTIVE,
        version: 0,
      },
    ],
    [
      'bid-2',
      {
        id: 'bid-2',
        driverId: 'driver-2',
        vehicleId: 'vehicle-2',
        offeredPriceKopecks: 13_000,
        status: DriverBidStatus.ACTIVE,
        version: 0,
      },
    ],
  ]);

  readonly driverBid = {
    findMany: async (args: {
      where: {
        id?: { not: string };
        status: DriverBidStatus;
        expiresAt?: { lte: Date };
      };
    }) => {
      // expireActiveBids() looks for bids past their TTL — this fake never
      // simulates real expiry, so it always finds none.
      if (args.where.expiresAt) return [];

      return [...this.bids.values()]
        .filter(
          (bid) =>
            bid.id !== args.where.id?.not && bid.status === args.where.status,
        )
        .map((bid) => ({ id: bid.id, driverId: bid.driverId }));
    },
    findFirst: async (args: {
      where: { id: string; status: DriverBidStatus };
    }) => {
      const bid = this.bids.get(args.where.id);
      if (!bid || bid.status !== args.where.status) return null;

      return {
        ...bid,
        driver: { commissionBasisPoints: 1_000 },
        vehicle: { driverId: bid.driverId, status: 'APPROVED' },
      };
    },
    updateMany: async (args: {
      data: { status: DriverBidStatus; version: { increment: number } };
      where: {
        expiresAt?: { lte: Date };
        id?: string | { not: string };
        status: DriverBidStatus;
        version?: number;
      };
    }) => {
      if (args.where.expiresAt) return { count: 0 };

      if (typeof args.where.id === 'string') {
        const bid = this.bids.get(args.where.id);
        if (
          !bid ||
          bid.status !== args.where.status ||
          bid.version !== args.where.version
        ) {
          return { count: 0 };
        }
        bid.status = args.data.status;
        bid.version += args.data.version.increment;
        return { count: 1 };
      }

      let count = 0;
      for (const bid of this.bids.values()) {
        if (bid.id !== args.where.id?.not && bid.status === args.where.status) {
          bid.status = args.data.status;
          bid.version += args.data.version.increment;
          count += 1;
        }
      }
      return { count };
    },
  };

  readonly tripStatusHistory = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.history.push(data);
      return data;
    },
  };

  async $transaction<T>(
    callback: (transaction: this) => Promise<T>,
  ): Promise<T> {
    let release: (() => void) | undefined;
    const previous = this.lock;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      return await callback(this);
    } finally {
      release?.();
    }
  }

  async $queryRawUnsafe<T>(query: string): Promise<T> {
    if (query.includes('FOR UPDATE')) return [{ ...this.tripState }] as T;
    return [] as T;
  }

  readonly trip = {
    updateMany: async (args: {
      data: {
        selectedDriverId: string;
        status: TripStatus;
        version: { increment: number };
      };
      where: {
        selectedDriverId: null;
        status: TripStatus;
        version: number;
      };
    }) => {
      if (
        this.tripState.selectedDriverId ||
        this.tripState.status !== args.where.status ||
        this.tripState.version !== args.where.version
      ) {
        return { count: 0 };
      }
      this.tripState.selectedDriverId = args.data.selectedDriverId;
      this.tripState.status = args.data.status;
      this.tripState.version += args.data.version.increment;
      return { count: 1 };
    },
  };
}

describe('BidsService concurrent selection', () => {
  it('accepts exactly one bid when two passenger selections race', async () => {
    const prisma = new ConcurrentBidPrisma();
    const service = new BidsService(
      new ConfigService({
        bids: { ttlSeconds: 120 },
        dispatch: {
          averageSpeedMetersPerSecond: 8.33,
          locationMaxAgeSeconds: 120,
        },
        trips: { minPassengerPriceKopecks: 10_000 },
      }),
      prisma as unknown as PrismaService,
      {
        calculateForDriver: async ({
          totalKopecks,
        }: {
          totalKopecks: number;
        }) => ({
          totalKopecks,
          commissionBasisPoints: 1_000,
          commissionKopecks: Math.floor(totalKopecks / 10),
          driverPayoutKopecks: totalKopecks - Math.floor(totalKopecks / 10),
        }),
      } as unknown as FareCalculator,
      {
        enqueueTripEvent: async () => undefined,
      } as unknown as RealtimeOutboxService,
      {
        createDraft: (input: unknown) => input,
      } as unknown as NotificationService,
      {
        enqueue: async () => undefined,
        cancelPendingForEntity: async () => undefined,
      } as unknown as NotificationOutboxService,
    );

    const results = await Promise.allSettled([
      service.select(passenger, 'trip-1', 'bid-1'),
      service.select(passenger, 'trip-1', 'bid-2'),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected?.reason).toBeInstanceOf(HttpException);
    expect((rejected?.reason as HttpException).getResponse()).toMatchObject({
      code: 'DRIVER_ALREADY_SELECTED',
    });
    expect(
      [...prisma.bids.values()].filter(
        (bid) => bid.status === DriverBidStatus.ACCEPTED,
      ),
    ).toHaveLength(1);
    expect(
      [...prisma.bids.values()].filter(
        (bid) => bid.status === DriverBidStatus.REJECTED,
      ),
    ).toHaveLength(1);
    expect(prisma.tripState.status).toBe(TripStatus.DRIVER_SELECTED);
    expect(prisma.history).toHaveLength(1);
  });
});

describe('BidsService selection notifications', () => {
  it('notifies the accepted driver, the passenger, and every rejected driver, then cancels other candidates’ new-order pushes', async () => {
    const prisma = new ConcurrentBidPrisma();
    const enqueuedDrafts: Array<{ userId: string; type: string }> = [];
    const cancelCalls: Array<{
      type: string;
      entityId: string;
      options: unknown;
    }> = [];
    const service = new BidsService(
      new ConfigService({
        bids: { ttlSeconds: 120 },
        dispatch: {
          averageSpeedMetersPerSecond: 8.33,
          locationMaxAgeSeconds: 120,
        },
        trips: { minPassengerPriceKopecks: 10_000 },
      }),
      prisma as unknown as PrismaService,
      {
        calculateForDriver: async ({
          totalKopecks,
        }: {
          totalKopecks: number;
        }) => ({
          totalKopecks,
          commissionBasisPoints: 1_000,
          commissionKopecks: Math.floor(totalKopecks / 10),
          driverPayoutKopecks: totalKopecks - Math.floor(totalKopecks / 10),
        }),
      } as unknown as FareCalculator,
      {
        enqueueTripEvent: async () => undefined,
      } as unknown as RealtimeOutboxService,
      {
        createDraft: (input: { userId: string; type: string }) => input,
      } as unknown as NotificationService,
      {
        enqueue: async (
          _client: unknown,
          draft: { userId: string; type: string },
        ) => {
          enqueuedDrafts.push(draft);
        },
        cancelPendingForEntity: async (
          _client: unknown,
          type: string,
          entityId: string,
          options: unknown,
        ) => {
          cancelCalls.push({ type, entityId, options });
        },
      } as unknown as NotificationOutboxService,
    );

    await service.select(passenger, 'trip-1', 'bid-1');

    expect(
      enqueuedDrafts.some(
        (d) => d.userId === 'driver-1' && d.type === 'DRIVER_BID_ACCEPTED',
      ),
    ).toBe(true);
    expect(
      enqueuedDrafts.some(
        (d) =>
          d.userId === passenger.id && d.type === 'PASSENGER_DRIVER_SELECTED',
      ),
    ).toBe(true);
    expect(
      enqueuedDrafts.some(
        (d) => d.userId === 'driver-2' && d.type === 'DRIVER_BID_REJECTED',
      ),
    ).toBe(true);
    expect(cancelCalls).toEqual([
      {
        type: 'DRIVER_NEW_TRIP_AVAILABLE',
        entityId: 'trip-1',
        options: { exceptUserId: 'driver-1' },
      },
    ]);
  });
});
