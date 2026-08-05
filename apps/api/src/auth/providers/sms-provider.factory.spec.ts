import { ConfigService } from '@nestjs/config';

import type { RedisService } from '../../redis/redis.service.js';
import { DevelopmentSmsProvider } from './development-sms.provider.js';
import { createSmsProvider } from './sms-provider.factory.js';
import { SmsRuProvider } from './sms-ru.provider.js';
import { StagingSmsProvider } from './staging-sms.provider.js';

const config = (values: Record<string, unknown>): ConfigService =>
  new ConfigService(values);

// The staging/development branches never call a Redis method during
// construction, so a real client is unnecessary here.
const fakeRedis = {} as RedisService;

describe('createSmsProvider', () => {
  it('returns the development provider outside production', () => {
    const provider = createSmsProvider(
      config({
        app: { environment: 'development', appEnvironment: 'development' },
        sms: { provider: 'development' },
      }),
      fakeRedis,
    );

    expect(provider).toBeInstanceOf(DevelopmentSmsProvider);
  });

  it('returns the staging provider when configured for staging', () => {
    const provider = createSmsProvider(
      config({
        app: { environment: 'production', appEnvironment: 'staging' },
        sms: { provider: 'staging' },
        otp: { ttlSeconds: 300 },
      }),
      fakeRedis,
    );

    expect(provider).toBeInstanceOf(StagingSmsProvider);
  });

  it('returns the SMS.RU provider when configured', () => {
    const provider = createSmsProvider(
      config({
        app: { environment: 'production', appEnvironment: 'production' },
        sms: {
          provider: 'sms-ru',
          senderId: 'ResilientTaxi',
          smsRu: {
            apiId: 'test-api-id',
            apiBaseUrl: 'https://sms.ru',
            timeoutMs: 10_000,
            maxRetries: 2,
            circuitFailureThreshold: 5,
            circuitOpenMs: 30_000,
          },
        },
      }),
      fakeRedis,
    );

    expect(provider).toBeInstanceOf(SmsRuProvider);
  });

  it('refuses the development provider in staging', () => {
    expect(() =>
      createSmsProvider(
        config({
          app: { environment: 'production', appEnvironment: 'staging' },
          sms: { provider: 'development' },
        }),
        fakeRedis,
      ),
    ).toThrow('must not be used in staging or production');
  });

  it('refuses the development provider in production', () => {
    expect(() =>
      createSmsProvider(
        config({
          app: { environment: 'production', appEnvironment: 'production' },
          sms: { provider: 'development' },
        }),
        fakeRedis,
      ),
    ).toThrow('must not be used in staging or production');
  });

  it('refuses the staging provider in production', () => {
    expect(() =>
      createSmsProvider(
        config({
          app: { environment: 'production', appEnvironment: 'production' },
          sms: { provider: 'staging' },
        }),
        fakeRedis,
      ),
    ).toThrow('StagingSmsProvider must not be used in production');
  });
});
