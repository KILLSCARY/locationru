import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../src/database/prisma.service.js';
import { DispatchService } from '../src/dispatch/dispatch.service.js';
import { StraightLineRouteEstimator } from '../src/dispatch/routing/straight-line-route-estimator.js';

const describePostgis =
  process.env.RUN_POSTGIS_INTEGRATION === 'true' ? describe : describe.skip;

describePostgis('DispatchService PostGIS integration', () => {
  let prisma: PrismaService;
  let dispatch: DispatchService;
  let passengerId: string;
  let tripId: string;
  let driverIds: string[];

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: process.env.DATABASE_URL } }),
    );
    dispatch = new DispatchService(
      new ConfigService({
        dispatch: {
          averageSpeedMetersPerSecond: 8.33,
          initialRadiusMeters: 1_000,
          locationMaxAgeSeconds: 120,
          maxCandidates: 10,
          maxRadiusMeters: 3_000,
          radiusMultiplier: 2,
        },
      }),
      prisma,
      new StraightLineRouteEstimator(),
    );
  });

  beforeEach(async () => {
    passengerId = randomUUID();
    tripId = randomUUID();
    driverIds = [];
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
    await prisma.$executeRawUnsafe(
      `INSERT INTO "trips" (
          "id", "passengerId", "status", "passengerPriceKopecks",
          "pickupLocation", "destinationLocation", "pickupAddress", "destinationAddress",
          "estimatedDistanceMeters", "estimatedDurationSeconds", "createdAt", "updatedAt"
       ) VALUES (
          $1, $2, 'SEARCHING', 10000,
          ST_SetSRID(ST_MakePoint(37.6173, 55.7558), 4326)::geography,
          ST_SetSRID(ST_MakePoint(37.6273, 55.7558), 4326)::geography,
          'Pickup', 'Destination', 0, 0, NOW(), NOW()
       )`,
      tripId,
      passengerId,
    );

    driverIds.push(
      await addDriver(prisma, {
        latitude: 55.7693,
        longitude: 37.6173,
        rating: 4.8,
        status: 'ONLINE',
      }),
    );
    driverIds.push(
      await addDriver(prisma, {
        latitude: 55.7568,
        longitude: 37.6173,
        rating: 5,
        status: 'BUSY',
      }),
    );
    driverIds.push(
      await addDriver(prisma, {
        latitude: 55.7568,
        longitude: 37.6173,
        rating: 5,
        recordedAt: new Date(Date.now() - 121_000),
        status: 'ONLINE',
      }),
    );
  });

  afterEach(async () => {
    await prisma.dispatchAttempt.deleteMany({ where: { tripId } });
    await prisma.trip.deleteMany({ where: { id: tripId } });
    await prisma.user.deleteMany({ where: { id: passengerId } });
    await prisma.user.deleteMany({ where: { id: { in: driverIds } } });
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  it('expands the radius and returns only fresh ONLINE drivers once', async () => {
    const first = await dispatch.findCandidates({ tripId });

    expect(first.radiusMeters).toBe(2_000);
    expect(first.candidates).toHaveLength(1);
    expect(first.candidates[0]).toMatchObject({ rating: 4.8, rank: 1 });

    const second = await dispatch.findCandidates({ tripId });

    expect(second.candidates).toEqual([]);
    expect(await prisma.dispatchAttemptLog.count()).toBeGreaterThanOrEqual(1);
  });
});

async function addDriver(
  prisma: PrismaService,
  input: {
    latitude: number;
    longitude: number;
    rating: number;
    recordedAt?: Date;
    status: 'BUSY' | 'ONLINE';
  },
): Promise<string> {
  const driverId = randomUUID();
  await prisma.user.create({
    data: {
      id: driverId,
      phone: `+7998${randomDigits(7)}`,
      role: 'DRIVER',
      status: 'ACTIVE',
      driverProfile: {
        create: {
          firstName: 'Test',
          lastName: 'Driver',
          rating: input.rating,
          status: input.status,
          verificationStatus: 'APPROVED',
        },
      },
    },
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO "driver_locations" (
        "id", "driverId", "deviceId", "recordedAt", "location", "accuracyMeters",
        "provider", "confidence", "suspectedSpoofing", "stale"
     ) VALUES (
        $1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, 10,
        'test', 'HIGH', false, false
     )`,
    randomUUID(),
    driverId,
    `test-device-${driverId}`,
    input.recordedAt ?? new Date(),
    input.longitude,
    input.latitude,
  );

  return driverId;
}

function randomDigits(length: number): string {
  return Math.floor(Math.random() * 10 ** length)
    .toString()
    .padStart(length, '0');
}
