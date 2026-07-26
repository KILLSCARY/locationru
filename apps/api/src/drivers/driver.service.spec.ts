import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  DriverLocationConfidence,
  DriverStatus,
  DriverVerificationStatus,
} from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import { DriverService } from './driver.service.js';
import type { DriverLocationDto } from './dto/driver-location.dto.js';

const driver: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000010',
  phone: '+79990000010',
  role: 'DRIVER',
  sessionId: '00000000-0000-4000-8000-000000000011',
};

class InMemoryPrisma {
  approved = true;
  approvedVehicle = true;
  inserted = true;
  profileStatus = DriverStatus.OFFLINE;
  rawCalls: Array<{ parameters: unknown[]; query: string }> = [];

  readonly deviceSession = {
    findUnique: async () => ({
      deviceId: 'android-device-1',
      userId: driver.id,
    }),
  };

  readonly driverProfile = {
    findUnique: async () => ({
      status: this.profileStatus,
      verificationStatus: this.approved
        ? DriverVerificationStatus.APPROVED
        : DriverVerificationStatus.PENDING,
      vehicles: this.approvedVehicle ? [{ id: 'vehicle-1' }] : [],
    }),
    update: async ({ data }: { data: { status: DriverStatus } }) => {
      this.profileStatus = data.status;
      return { status: this.profileStatus };
    },
  };

  async $queryRawUnsafe<T>(
    query: string,
    ...parameters: unknown[]
  ): Promise<T> {
    this.rawCalls.push({ query, parameters });
    return (this.inserted ? [{ id: 'location-1' }] : []) as T;
  }
}

class InMemoryRedis {
  values = new Map<string, string>();
  increments = new Map<string, number>();

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async incrementBy(key: string, amount: number): Promise<number> {
    const next = (this.increments.get(key) ?? 0) + amount;
    this.increments.set(key, next);
    return next;
  }

  async setExpiry(): Promise<void> {}

  async setWithTtl(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

describe('DriverService', () => {
  let prisma: InMemoryPrisma;
  let redis: InMemoryRedis;
  let service: DriverService;

  beforeEach(() => {
    prisma = new InMemoryPrisma();
    redis = new InMemoryRedis();
    service = new DriverService(
      new ConfigService({
        driverLocations: {
          batchMaxSize: 3,
          futureToleranceSeconds: 300,
          latestPositionTtlSeconds: 300,
          maxPlausibleSpeedMetersPerSecond: 70,
          rateLimitPerMinute: 10,
          staleAfterSeconds: 120,
        },
      }),
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      {
        enqueueDriverLocationUpdate: async () => undefined,
      } as unknown as RealtimeOutboxService,
    );
  });

  it('requires an approved driver before accepting a position', async () => {
    prisma.approved = false;

    const error = await captureError(
      service.submitLocation(driver, location()),
    );

    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({
      code: 'DRIVER_APPROVAL_REQUIRED',
    });
  });

  it('requires an approved vehicle before going online', async () => {
    prisma.approvedVehicle = false;

    const error = await captureError(service.goOnline(driver));

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: 'APPROVED_VEHICLE_REQUIRED',
    });
  });

  it('persists history and computes server confidence instead of trusting the client', async () => {
    const result = await service.submitLocation(
      driver,
      location({ confidence: DriverLocationConfidence.LOW }),
    );

    expect(result).toEqual({ accepted: 1, deduplicated: 0, stale: 0 });
    expect(prisma.rawCalls).toHaveLength(1);
    expect(prisma.rawCalls[0]?.parameters[11]).toBe(
      DriverLocationConfidence.LOW,
    );
    expect(prisma.rawCalls[0]?.parameters[12]).toBe(
      DriverLocationConfidence.HIGH,
    );
    expect(redis.values.get(`driver:location:latest:${driver.id}`)).toContain(
      'HIGH',
    );
  });

  it('marks old positions stale and does not make them the live Redis position', async () => {
    const result = await service.submitLocation(
      driver,
      location({ recordedAt: new Date(Date.now() - 121_000) }),
    );

    expect(result).toEqual({ accepted: 1, deduplicated: 0, stale: 1 });
    expect(prisma.rawCalls[0]?.parameters[14]).toBe(true);
    expect(redis.values.size).toBe(0);
  });

  it('deduplicates positions by device id and recordedAt', async () => {
    prisma.inserted = false;

    await expect(service.submitLocation(driver, location())).resolves.toEqual({
      accepted: 0,
      deduplicated: 1,
      stale: 0,
    });
  });

  it('limits the number of accepted location points per minute', async () => {
    service = new DriverService(
      new ConfigService({
        driverLocations: {
          batchMaxSize: 3,
          futureToleranceSeconds: 300,
          latestPositionTtlSeconds: 300,
          maxPlausibleSpeedMetersPerSecond: 70,
          rateLimitPerMinute: 1,
          staleAfterSeconds: 120,
        },
      }),
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      {
        enqueueDriverLocationUpdate: async () => undefined,
      } as unknown as RealtimeOutboxService,
    );

    const error = await captureError(
      service.submitLocationBatch(driver, {
        locations: [location(), location()],
      }),
    );

    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({
      code: 'LOCATION_RATE_LIMITED',
    });
  });

  it('rejects locations too far in the future', async () => {
    const error = await captureError(
      service.submitLocation(
        driver,
        location({ recordedAt: new Date(Date.now() + 301_000) }),
      ),
    );

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({ code: 'LOCATION_IN_FUTURE' });
  });

  it('rejects a position that implies an impossible speed', async () => {
    redis.values.set(
      `driver:location:latest:${driver.id}`,
      JSON.stringify({
        latitude: 55.7558,
        longitude: 37.6173,
        accuracyMeters: 10,
        confidence: DriverLocationConfidence.HIGH,
        suspectedSpoofing: false,
        recordedAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );

    const error = await captureError(
      service.submitLocation(
        driver,
        location({ latitude: 59.9343, longitude: 30.3351 }),
      ),
    );

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({
      code: 'IMPOSSIBLE_LOCATION_SPEED',
    });
  });
});

function location(
  overrides: Partial<DriverLocationDto> = {},
): DriverLocationDto {
  return {
    recordedAt: new Date(),
    latitude: 55.7558,
    longitude: 37.6173,
    accuracyMeters: 10,
    provider: 'fused',
    confidence: DriverLocationConfidence.HIGH,
    suspectedSpoofing: false,
    ...overrides,
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
