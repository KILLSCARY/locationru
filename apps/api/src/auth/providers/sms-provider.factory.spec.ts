import { ConfigService } from '@nestjs/config';

import type { RedisService } from '../../redis/redis.service.js';
import { DevelopmentSmsProvider } from './development-sms.provider.js';
import { HttpSmsProvider } from './http-sms.provider.js';
import { createSmsProvider } from './sms-provider.factory.js';
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
        auth: { otpTtlSeconds: 300 },
      }),
      fakeRedis,
    );

    expect(provider).toBeInstanceOf(StagingSmsProvider);
  });

  it('returns the http provider when configured', () => {
    const provider = createSmsProvider(
      config({
        app: { environment: 'production', appEnvironment: 'production' },
        sms: {
          provider: 'http',
          apiBaseUrl: 'https://gateway.example/v1/',
          apiKey: 'key',
          sender: 'ResilientTaxi',
          requestTimeoutMs: 10_000,
        },
      }),
      fakeRedis,
    );

    expect(provider).toBeInstanceOf(HttpSmsProvider);
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
