import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { MapsCacheService } from '../src/maps/cache/maps-cache.service.js';
import { MapsService } from '../src/maps/maps.service.js';
import { DevelopmentMapsProvider } from '../src/maps/providers/development-maps.provider.js';
import { TripService } from '../src/trips/trip.service.js';
import { TripStateMachine } from '../src/trips/trip-state-machine.service.js';
import {
  asRedisService,
  InMemoryRedisService,
} from './support/in-memory-redis.js';

const describePostgis =
  process.env.RUN_POSTGIS_INTEGRATION === 'true' ? describe : describe.skip;

describePostgis('Trip route persistence PostGIS integration', () => {
  let prisma: PrismaService;
  let tripService: TripService;
  let passengerId: string;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: process.env.DATABASE_URL } }),
    );
    const mapsConfig = new ConfigService({
      maps: {
        suggestionsTtlSeconds: 300,
        geocodingTtlSeconds: 86_400,
        routeTtlSeconds: 1_800,
      },
    });
    const mapsService = new MapsService(
      new DevelopmentMapsProvider(),
      new MapsCacheService(asRedisService(new InMemoryRedisService())),
      mapsConfig,
    );
    const tripConfig = new ConfigService({
      trips: { minPassengerPriceKopecks: 10_000 },
    });
    // TripService.create() never calls the state machine's transition (only
    // startSearch/cancel do), so a stub realtime outbox is enough here.
    const stateMachine = new TripStateMachine(
      prisma,
      {} as unknown as ConstructorParameters<typeof TripStateMachine>[1],
    );
    tripService = new TripService(
      tripConfig,
      prisma,
      stateMachine,
      mapsService,
    );
  });

  beforeEach(async () => {
    passengerId = randomUUID();
    await prisma.user.create({
      data: {
        id: passengerId,
        phone: `+7999${randomDigits(7)}`,
        role: 'PASSENGER',
        status: 'ACTIVE',
        passengerProfile: {
          create: { firstName: 'Test', lastName: 'Passenger' },
        },
      },
    });
  });

  afterEach(async () => {
    await prisma.trip.deleteMany({ where: { passengerId } });
    await prisma.user.deleteMany({ where: { id: passengerId } });
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  it('persists server-computed distance, duration, geometry, bounds and provider', async () => {
    const passenger: AuthenticatedUser = {
      id: passengerId,
      phone: '+79990000000',
      role: 'PASSENGER',
      sessionId: randomUUID(),
    };

    const created = await tripService.create(
      passenger,
      {
        pickup: { latitude: 59.9326, longitude: 30.3506 },
        destination: { latitude: 59.8003, longitude: 30.2625 },
        pickupAddress: 'Санкт-Петербург, Невский проспект, 45',
        destinationAddress: 'Санкт-Петербург, аэропорт Пулково',
        // The client-sent price must not influence the persisted route.
        passengerPriceKopecks: 50_000,
      },
      `trip-route-${randomUUID()}`,
    );

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        estimatedDistanceMeters: number;
        estimatedDurationSeconds: number;
        routeProvider: string | null;
        routeBounds: unknown;
        pointCount: number;
      }>
    >(
      `SELECT
          "estimatedDistanceMeters", "estimatedDurationSeconds", "routeProvider", "routeBounds",
          ST_NumPoints("route"::geometry) AS "pointCount"
       FROM "trips"
       WHERE "id" = $1`,
      created.id,
    );

    expect(rows).toHaveLength(1);
    const trip = rows[0]!;
    expect(trip.estimatedDistanceMeters).toBeGreaterThan(0);
    expect(trip.estimatedDurationSeconds).toBeGreaterThan(0);
    expect(trip.routeProvider).toBe('development');
    expect(trip.pointCount).toBeGreaterThanOrEqual(2);
    expect(trip.routeBounds).toMatchObject({
      minLatitude: expect.any(Number),
      maxLatitude: expect.any(Number),
    });
  });
});

function randomDigits(length: number): string {
  let digits = '';
  for (let index = 0; index < length; index += 1) {
    digits += Math.floor(Math.random() * 10).toString();
  }
  return digits;
}
