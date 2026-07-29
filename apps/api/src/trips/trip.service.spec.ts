import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { TripStatus, TripStatusActorType } from '../generated/prisma/client.js';
import { MapsService } from '../maps/maps.service.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import { TripService } from './trip.service.js';
import {
  TripStateMachine,
  type TripTransitionResult,
} from './trip-state-machine.service.js';

const passenger: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000001',
  phone: '+79990000000',
  role: 'PASSENGER',
  sessionId: '00000000-0000-4000-8000-000000000002',
};

class InMemoryTripPrisma {
  activeTrip = false;
  insertCount = 0;
  readonly idempotency = new Map<
    string,
    { requestHash: string; tripId: string }
  >();
  readonly trip = {
    findFirst: async () => ({
      id: 'trip-1',
      status: TripStatus.DRAFT,
      version: 0,
    }),
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
    if (query.includes('FROM "trip_idempotency_keys"')) {
      const key = parameters[1] as string;
      const value = this.idempotency.get(key);
      return (value ? [value] : []) as T;
    }

    if (query.includes('FROM "trips"') && query.includes('FOR UPDATE')) {
      return (this.activeTrip ? [{ id: 'active-trip' }] : []) as T;
    }

    if (query.includes('INSERT INTO "trips"')) {
      this.insertCount += 1;
      return [
        {
          id: parameters[0] as string,
          status: TripStatus.DRAFT,
          version: 0,
        },
      ] as T;
    }

    if (query.includes('INSERT INTO "trip_idempotency_keys"')) {
      this.idempotency.set(parameters[2] as string, {
        requestHash: parameters[3] as string,
        tripId: parameters[4] as string,
      });
      return [] as T;
    }

    if (query.includes('FROM "trips"')) {
      const id = parameters[0] as string;
      return [
        {
          id,
          status: TripStatus.DRAFT,
          version: 0,
        },
      ] as T;
    }

    return [] as T;
  }
}

describe('TripService', () => {
  let prisma: InMemoryTripPrisma;
  let stateMachine: {
    transition: (input: unknown) => Promise<TripTransitionResult>;
  };
  let tripService: TripService;

  beforeEach(() => {
    prisma = new InMemoryTripPrisma();
    stateMachine = {
      transition: async () => ({
        id: 'trip-1',
        status: TripStatus.SEARCHING,
        version: 1,
      }),
    };
    const mapsService = {
      buildRoute: async () => ({
        distanceMeters: 4_200,
        durationSeconds: 540,
        geometry: [
          { latitude: 55.7558, longitude: 37.6173 },
          { latitude: 55.7517, longitude: 37.6178 },
        ],
        encodedPolyline: null,
        bounds: {
          minLatitude: 55.7517,
          minLongitude: 37.6173,
          maxLatitude: 55.7558,
          maxLongitude: 37.6178,
        },
        provider: 'development',
        providerRouteId: null,
        warnings: [],
        snappedWaypoints: [],
      }),
    };
    tripService = new TripService(
      new ConfigService({ trips: { minPassengerPriceKopecks: 10_000 } }),
      prisma as unknown as PrismaService,
      stateMachine as unknown as TripStateMachine,
      mapsService as unknown as MapsService,
    );
  });

  it('creates a draft with a persisted idempotency key', async () => {
    const created = await tripService.create(
      passenger,
      validTripInput(),
      'create-1',
    );

    expect(created).toMatchObject({ status: TripStatus.DRAFT, version: 0 });
    expect(prisma.insertCount).toBe(1);
    expect(prisma.idempotency.get('create-1')).toMatchObject({
      tripId: created.id,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('replays the original draft for the same idempotency key and payload', async () => {
    const first = await tripService.create(
      passenger,
      validTripInput(),
      'create-1',
    );
    const replay = await tripService.create(
      passenger,
      validTripInput(),
      'create-1',
    );

    expect(replay).toEqual(first);
    expect(prisma.insertCount).toBe(1);
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    await tripService.create(passenger, validTripInput(), 'create-1');

    const error = await captureError(
      tripService.create(
        passenger,
        { ...validTripInput(), passengerPriceKopecks: 20_000 },
        'create-1',
      ),
    );

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('rejects a passenger with an active trip', async () => {
    prisma.activeTrip = true;

    const error = await captureError(
      tripService.create(passenger, validTripInput(), 'create-1'),
    );

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({ code: 'ACTIVE_TRIP_EXISTS' });
  });

  it('rejects a price below the configured minimum', async () => {
    const error = await captureError(
      tripService.create(
        passenger,
        { ...validTripInput(), passengerPriceKopecks: 9_999 },
        'create-1',
      ),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'PRICE_BELOW_MINIMUM' });
  });

  it('rejects a non-integer price even when called outside HTTP validation', async () => {
    const error = await captureError(
      tripService.create(
        passenger,
        { ...validTripInput(), passengerPriceKopecks: 10_000.5 },
        'create-1',
      ),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'INVALID_PRICE' });
  });

  it('starts search only from DRAFT and records the passenger actor', async () => {
    const calls: unknown[] = [];
    stateMachine.transition = async (input: unknown) => {
      calls.push(input);
      return { id: 'trip-1', status: TripStatus.SEARCHING, version: 1 };
    };

    await expect(tripService.startSearch(passenger, 'trip-1')).resolves.toEqual(
      {
        id: 'trip-1',
        status: TripStatus.SEARCHING,
        version: 1,
      },
    );
    expect(calls).toEqual([
      {
        tripId: 'trip-1',
        expectedVersion: 0,
        newStatus: TripStatus.SEARCHING,
        actorType: TripStatusActorType.PASSENGER,
        actorId: passenger.id,
      },
    ]);
  });

  it('returns an already cancelled trip without attempting a second transition', async () => {
    prisma.trip.findFirst = async () => ({
      id: 'trip-1',
      status: TripStatus.CANCELLED_BY_PASSENGER,
      version: 3,
    });
    let transitions = 0;
    stateMachine.transition = async () => {
      transitions += 1;
      return {
        id: 'trip-1',
        status: TripStatus.CANCELLED_BY_PASSENGER,
        version: 4,
      };
    };

    await expect(tripService.cancel(passenger, 'trip-1')).resolves.toEqual({
      id: 'trip-1',
      status: TripStatus.CANCELLED_BY_PASSENGER,
      version: 3,
    });
    expect(transitions).toBe(0);
  });
});

function validTripInput(): CreateTripDto {
  return {
    pickup: { latitude: 55.7558, longitude: 37.6173 },
    destination: { latitude: 55.7517, longitude: 37.6178 },
    pickupAddress: 'Красная площадь, 1',
    destinationAddress: 'Тверская улица, 1',
    passengerPriceKopecks: 10_000,
    stops: [
      {
        location: { latitude: 55.753, longitude: 37.62 },
        address: 'Манежная площадь, 1',
      },
    ],
    options: { childSeat: true, pet: false, luggage: true },
    comment: 'Позвонить по прибытии',
  };
}

async function captureError(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }

  throw new Error('Expected promise to reject');
}
