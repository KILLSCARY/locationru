import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import {
  StagingPushProvider,
  stagingPushLookupKey,
} from './staging-push.provider.js';

class FakeRedis {
  public readonly writes: Array<{ key: string; value: string; ttl: number }> =
    [];

  async setWithTtl(key: string, value: string, ttl: number): Promise<void> {
    this.writes.push({ key, value, ttl });
  }

  async checkConnection(): Promise<void> {
    await Promise.resolve();
  }
}

describe('StagingPushProvider', () => {
  it('refuses to run in production', () => {
    const config = new ConfigService({ app: { appEnvironment: 'production' } });
    expect(() => new StagingPushProvider(config, {} as never)).toThrow(
      'must not be used in production',
    );
  });

  it('stores the payload under the staging lookup key, never the raw token', async () => {
    const config = new ConfigService({ app: { appEnvironment: 'staging' } });
    const redis = new FakeRedis();
    const provider = new StagingPushProvider(config, redis as never);

    const result = await provider.sendToDevices({
      targets: [
        {
          devicePushTokenId: 'device-1',
          rawToken: 'super-secret-token',
          platform: 'ANDROID' as never,
        },
      ],
      title: 'Новый заказ рядом',
      body: 'Пассажир предложил 350 ₽',
      data: { tripId: 'trip-1' },
      priority: 'HIGH',
      ttlSeconds: 30,
      category: 'TRIP_OFFERS' as never,
    });

    expect(result.results[0]!.status).toBe('ACCEPTED');
    expect(redis.writes).toHaveLength(1);
    expect(redis.writes[0]!.key).toBe(stagingPushLookupKey('device-1'));
    expect(redis.writes[0]!.value).toContain('Пассажир предложил 350');
    expect(redis.writes[0]!.value).not.toContain('super-secret-token');
  });

  it('never logs the body or data payload', async () => {
    const config = new ConfigService({ app: { appEnvironment: 'staging' } });
    const redis = new FakeRedis();
    const provider = new StagingPushProvider(config, redis as never);
    const logSpy = jest.spyOn(
      (provider as unknown as { logger: { log: (...args: unknown[]) => void } })
        .logger,
      'log',
    );

    await provider.sendToDevice({
      rawToken: 'super-secret-token',
      platform: 'ANDROID' as never,
      title: 'title',
      body: 'super-secret-body',
      data: { secret: 'leak' },
      priority: 'NORMAL',
      ttlSeconds: 30,
      category: 'TRIP_OFFERS' as never,
    });

    for (const call of logSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain('super-secret-body');
      expect(serialized).not.toContain('leak');
    }
  });

  it('healthCheck delegates to the Redis connection check', async () => {
    const config = new ConfigService({ app: { appEnvironment: 'staging' } });
    const redis = new FakeRedis();
    const provider = new StagingPushProvider(config, redis as never);

    await expect(provider.healthCheck()).resolves.toEqual({ healthy: true });
  });
});
