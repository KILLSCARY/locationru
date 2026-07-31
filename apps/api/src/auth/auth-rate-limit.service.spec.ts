import { ConfigService } from '@nestjs/config';

import { AuthRateLimitService } from './auth-rate-limit.service.js';

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

function buildService(redis = new FakeRedis()) {
  const config = new ConfigService({
    auth: { otpHashSecret: 'test-secret' },
    otp: { maxSendsPerPhoneHour: 2, maxSendsPerIpHour: 3 },
    authRateLimit: {
      requestCodeMaxPerDevicePerHour: 4,
      requestCodeGlobalMaxPerMinute: 100,
      verifyCodeMaxPerMinute: 2,
    },
  });
  return { service: new AuthRateLimitService(config, redis as never), redis };
}

describe('AuthRateLimitService', () => {
  it('allows requests under every axis limit', async () => {
    const { service } = buildService();
    await expect(
      service.checkRequestCode({
        phoneHash: 'phone-1',
        ip: '1.2.3.4',
        deviceId: 'device-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks once the per-phone limit is exceeded', async () => {
    const { service } = buildService();
    const input = { phoneHash: 'phone-1', ip: '1.2.3.4', deviceId: 'device-1' };
    await service.checkRequestCode(input);
    await service.checkRequestCode(input);
    await expect(service.checkRequestCode(input)).rejects.toMatchObject({
      status: 429,
      response: { code: 'AUTH_RATE_LIMITED' },
    });
  });

  it('blocks once the per-IP limit is exceeded across different phones', async () => {
    const { service } = buildService();
    await service.checkRequestCode({
      phoneHash: 'phone-1',
      ip: '1.2.3.4',
      deviceId: 'device-1',
    });
    await service.checkRequestCode({
      phoneHash: 'phone-2',
      ip: '1.2.3.4',
      deviceId: 'device-2',
    });
    await service.checkRequestCode({
      phoneHash: 'phone-3',
      ip: '1.2.3.4',
      deviceId: 'device-3',
    });
    await expect(
      service.checkRequestCode({
        phoneHash: 'phone-4',
        ip: '1.2.3.4',
        deviceId: 'device-4',
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('blocks verify-code polling once the per-request limit is exceeded', async () => {
    const { service } = buildService();
    await service.checkVerifyCode({ requestId: 'req-1' });
    await service.checkVerifyCode({ requestId: 'req-1' });
    await expect(
      service.checkVerifyCode({ requestId: 'req-1' }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('fails closed with 503 when Redis is unavailable', async () => {
    const redis = new FakeRedis();
    redis.connected = false;
    const { service } = buildService(redis);

    await expect(
      service.checkRequestCode({
        phoneHash: 'phone-1',
        ip: '1.2.3.4',
        deviceId: 'device-1',
      }),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'RATE_LIMIT_STORE_UNAVAILABLE' },
    });
  });
});
