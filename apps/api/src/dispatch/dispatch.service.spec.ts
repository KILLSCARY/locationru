import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { TripStatus } from '../generated/prisma/client.js';
import { DispatchService, rankDispatchCandidates } from './dispatch.service.js';
import { StraightLineRouteEstimator } from './routing/straight-line-route-estimator.js';

const coordinates = {
  driverLongitude: 37.61,
  driverLatitude: 55.75,
  pickupLongitude: 37.62,
  pickupLatitude: 55.75,
};

class InMemoryDispatchPrisma {
  candidateRows: Array<{
    distanceMeters: number;
    driverId: string;
    estimatedPickupSeconds: number;
    rating: number;
    driverLongitude: number;
    driverLatitude: number;
    pickupLongitude: number;
    pickupLatitude: number;
  }> = [];
  readonly queryCalls: Array<{ parameters: unknown[]; query: string }> = [];
  readonly attempts: Array<Record<string, unknown>> = [];
  readonly logs: Array<Record<string, unknown>> = [];
  tripStatus = TripStatus.SEARCHING;

  readonly dispatchAttempt = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.attempts.push(data);
      return { id: data.id as string };
    },
  };

  readonly dispatchAttemptLog = {
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      this.logs.push(...data);
      return { count: data.length };
    },
  };

  async $transaction<T>(
    callback: (transaction: this) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }

  async $queryRawUnsafe<T>(
    query: string,
    ...parameters: unknown[]
  ): Promise<T> {
    this.queryCalls.push({ query, parameters });
    if (query.includes('FOR UPDATE')) {
      return [{ id: 'trip-1', status: this.tripStatus }] as T;
    }

    const radius = parameters[2] as number;
    return (radius < 2_000 ? [] : this.candidateRows) as T;
  }
}

describe('DispatchService', () => {
  it('ranks candidates by ETA, direct distance, rating and driver id', () => {
    expect(
      rankDispatchCandidates([
        {
          driverId: 'driver-c',
          estimatedPickupSeconds: 120,
          distanceMeters: 600,
          rating: 4.9,
        },
        {
          driverId: 'driver-b',
          estimatedPickupSeconds: 120,
          distanceMeters: 600,
          rating: 4.9,
        },
        {
          driverId: 'driver-a',
          estimatedPickupSeconds: 120,
          distanceMeters: 600,
          rating: 5,
        },
        {
          driverId: 'driver-d',
          estimatedPickupSeconds: 120,
          distanceMeters: 500,
          rating: 1,
        },
        {
          driverId: 'driver-e',
          estimatedPickupSeconds: 90,
          distanceMeters: 900,
          rating: 1,
        },
      ]),
    ).toEqual([
      expect.objectContaining({ driverId: 'driver-e', rank: 1 }),
      expect.objectContaining({ driverId: 'driver-d', rank: 2 }),
      expect.objectContaining({ driverId: 'driver-a', rank: 3 }),
      expect.objectContaining({ driverId: 'driver-b', rank: 4 }),
      expect.objectContaining({ driverId: 'driver-c', rank: 5 }),
    ]);
  });

  it('expands the radius, records candidates and excludes prior dispatches by default', async () => {
    const prisma = new InMemoryDispatchPrisma();
    prisma.candidateRows = [
      {
        driverId: 'driver-low-rating',
        estimatedPickupSeconds: 240,
        distanceMeters: 1_500,
        rating: 4.5,
        ...coordinates,
      },
      {
        driverId: 'driver-high-rating',
        estimatedPickupSeconds: 240,
        distanceMeters: 1_500,
        rating: 4.9,
        ...coordinates,
      },
    ];
    const service = new DispatchService(
      dispatchConfig(),
      prisma as unknown as PrismaService,
      new StraightLineRouteEstimator(),
    );

    const result = await service.findCandidates({ tripId: 'trip-1' });

    expect(result.radiusMeters).toBe(2_000);
    expect(result.candidates.map((candidate) => candidate.driverId)).toEqual([
      'driver-high-rating',
      'driver-low-rating',
    ]);
    expect(prisma.attempts).toHaveLength(1);
    expect(prisma.attempts[0]).toMatchObject({
      tripId: 'trip-1',
      radiusMeters: 2_000,
      candidateCount: 2,
      redispatchReason: null,
    });
    expect(prisma.logs).toHaveLength(2);

    const candidateQuery = prisma.queryCalls.at(-1);
    expect(candidateQuery?.query).toContain('NOT EXISTS');
    expect(prisma.queryCalls.map((call) => call.parameters[2])).toEqual([
      undefined,
      1_000,
      2_000,
    ]);
  });

  it('allows a prior candidate only when a redispatch reason is supplied', async () => {
    const prisma = new InMemoryDispatchPrisma();
    prisma.candidateRows = [
      {
        driverId: 'driver-1',
        estimatedPickupSeconds: 120,
        distanceMeters: 900,
        rating: 5,
        ...coordinates,
      },
    ];
    const service = new DispatchService(
      dispatchConfig(),
      prisma as unknown as PrismaService,
      new StraightLineRouteEstimator(),
    );

    await service.findCandidates({
      tripId: 'trip-1',
      redispatchReason: 'Previous offer expired',
    });

    expect(prisma.queryCalls.at(-1)?.query).not.toContain('NOT EXISTS');
    expect(prisma.attempts[0]).toMatchObject({
      redispatchReason: 'Previous offer expired',
    });
  });
});

function dispatchConfig(): ConfigService {
  return new ConfigService({
    dispatch: {
      averageSpeedMetersPerSecond: 8.33,
      initialRadiusMeters: 1_000,
      locationMaxAgeSeconds: 120,
      maxCandidates: 10,
      maxRadiusMeters: 5_000,
      radiusMultiplier: 2,
    },
  });
}
