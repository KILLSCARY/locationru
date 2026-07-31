import { ConfigService } from '@nestjs/config';

import { DeviceTokenRateLimitService } from './device-token-rate-limit.service.js';

class FakeRedis {
  readonly counters = new Map<string, number>();
  connected = true;

  async increment(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async setExpiry(): Promise<void> {}

  async checkConnection(): Promise<void> {
    if (!this.connected) throw new Error('redis down');
  }
}

class FakePrisma {
  readonly securityEvents: Array<{ type: string; userId?: string }> = [];

  readonly securityEvent = {
    create: async ({ data }: { data: { type: string; userId?: string } }) => {
      this.securityEvents.push(data);
      return data;
    },
  };
}

function buildService(overrides?: {
  redis?: FakeRedis;
  maxPerUserPerHour?: number;
}) {
  const config = new ConfigService({
    push: {
      rateLimit: {
        registerMaxPerUserPerHour: overrides?.maxPerUserPerHour ?? 2,
      },
    },
  });
  const redis = overrides?.redis ?? new FakeRedis();
  const prisma = new FakePrisma();
  const service = new DeviceTokenRateLimitService(
    config,
    redis as never,
    prisma as never,
  );
  return { service, redis, prisma };
}

describe('DeviceTokenRateLimitService', () => {
  it('allows registrations under the limit', async () => {
    const { service } = buildService();
    await expect(
      service.checkRegisterDevice('user-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.checkRegisterDevice('user-1'),
    ).resolves.toBeUndefined();
  });

  it('blocks once the per-user limit is exceeded and does not block a different user', async () => {
    const { service } = buildService();
    await service.checkRegisterDevice('user-1');
    await service.checkRegisterDevice('user-1');

    await expect(service.checkRegisterDevice('user-1')).rejects.toMatchObject({
      status: 429,
      response: { code: 'DEVICE_TOKEN_RATE_LIMITED' },
    });
    await expect(
      service.checkRegisterDevice('user-2'),
    ).resolves.toBeUndefined();
  });

  it('writes exactly one PUSH_TOKEN_MASS_REGISTRATION_SUSPECTED security event at the moment the limit is first crossed', async () => {
    const { service, prisma } = buildService();
    await service.checkRegisterDevice('user-1');
    await service.checkRegisterDevice('user-1');
    await expect(service.checkRegisterDevice('user-1')).rejects.toMatchObject({
      status: 429,
    });
    await expect(service.checkRegisterDevice('user-1')).rejects.toMatchObject({
      status: 429,
    });

    expect(prisma.securityEvents).toHaveLength(1);
    expect(prisma.securityEvents[0]).toMatchObject({
      type: 'PUSH_TOKEN_MASS_REGISTRATION_SUSPECTED',
      userId: 'user-1',
    });
  });

  it('fails closed with 503 when Redis is unavailable', async () => {
    const redis = new FakeRedis();
    redis.connected = false;
    const { service } = buildService({ redis });

    await expect(service.checkRegisterDevice('user-1')).rejects.toMatchObject({
      status: 503,
      response: { code: 'RATE_LIMIT_STORE_UNAVAILABLE' },
    });
  });
});
