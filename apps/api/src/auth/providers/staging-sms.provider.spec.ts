import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { VerificationChannel } from './sms-provider.interface.js';
import {
  StagingSmsProvider,
  stagingOtpLookupKey,
} from './staging-sms.provider.js';

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

describe('StagingSmsProvider', () => {
  it('refuses to run in production', () => {
    const config = new ConfigService({ app: { appEnvironment: 'production' } });
    expect(() => new StagingSmsProvider(config, {} as never)).toThrow(
      'must not be used in production',
    );
  });

  it('stores the plaintext code under the staging lookup key, never returning it itself', async () => {
    const config = new ConfigService({
      app: { appEnvironment: 'staging' },
      otp: { ttlSeconds: 300 },
    });
    const redis = new FakeRedis();
    const provider = new StagingSmsProvider(config, redis as never);

    const result = await provider.sendVerificationCode({
      phone: '+79995551234',
      code: '123456',
      message: 'Код входа в Resilient Taxi: 123456. Никому его не сообщайте.',
      channel: VerificationChannel.STAGING,
      requestId: 'request-1',
    });

    expect(result.status).toBe('DELIVERED');
    expect(redis.writes).toEqual([
      {
        key: stagingOtpLookupKey('+79995551234'),
        value: '123456',
        ttl: 300,
      },
    ]);
  });

  it('never logs the code or message', async () => {
    const config = new ConfigService({
      app: { appEnvironment: 'staging' },
      otp: { ttlSeconds: 300 },
    });
    const redis = new FakeRedis();
    const provider = new StagingSmsProvider(config, redis as never);
    const logSpy = jest.spyOn(
      (provider as unknown as { logger: { log: (...args: unknown[]) => void } })
        .logger,
      'log',
    );

    await provider.sendVerificationCode({
      phone: '+79995551234',
      code: 'super-secret-code',
      message: 'super-secret-message',
      channel: VerificationChannel.STAGING,
      requestId: 'request-1',
    });

    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('super-secret-code');
      expect(JSON.stringify(call)).not.toContain('super-secret-message');
    }
  });

  it('healthCheck delegates to the Redis connection check', async () => {
    const config = new ConfigService({ app: { appEnvironment: 'staging' } });
    const redis = new FakeRedis();
    const provider = new StagingSmsProvider(config, redis as never);

    await expect(provider.healthCheck()).resolves.toEqual({ healthy: true });
  });
});
