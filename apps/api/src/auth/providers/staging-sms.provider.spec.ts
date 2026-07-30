import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

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
      auth: { otpTtlSeconds: 300 },
    });
    const redis = new FakeRedis();
    const provider = new StagingSmsProvider(config, redis as never);

    const result = await provider.sendCode('+79995551234', '123456');

    expect(result).toBeUndefined();
    expect(redis.writes).toEqual([
      {
        key: stagingOtpLookupKey('+79995551234'),
        value: '123456',
        ttl: 300,
      },
    ]);
  });

  it('never logs the code itself', async () => {
    const config = new ConfigService({
      app: { appEnvironment: 'staging' },
      auth: { otpTtlSeconds: 300 },
    });
    const redis = new FakeRedis();
    const provider = new StagingSmsProvider(config, redis as never);
    const logSpy = jest.spyOn(
      (provider as unknown as { logger: { log: (...args: unknown[]) => void } })
        .logger,
      'log',
    );

    await provider.sendCode('+79995551234', 'super-secret-code');

    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('super-secret-code');
    }
  });
});
