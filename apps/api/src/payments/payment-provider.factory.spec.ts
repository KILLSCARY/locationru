import { ConfigService } from '@nestjs/config';

import type { RedisService } from '../redis/redis.service.js';
import { DevelopmentPaymentProvider } from './development-payment.provider.js';
import { HttpPaymentProvider } from './http-payment.provider.js';
import { createPaymentProvider } from './payment-provider.factory.js';
import { StagingPaymentProvider } from './staging-payment.provider.js';

const config = (values: Record<string, unknown>): ConfigService =>
  new ConfigService(values);

// The staging/development branches never call a Redis method during
// construction, so a real client is unnecessary here.
const fakeRedis = {} as RedisService;

describe('createPaymentProvider', () => {
  it('returns the development simulator outside production', () => {
    const provider = createPaymentProvider(
      config({
        app: { environment: 'development', appEnvironment: 'development' },
        payments: { provider: 'development' },
      }),
      fakeRedis,
    );

    expect(provider).toBeInstanceOf(DevelopmentPaymentProvider);
  });

  it('returns the staging provider when configured for staging', () => {
    const provider = createPaymentProvider(
      config({
        app: { environment: 'production', appEnvironment: 'staging' },
        payments: {
          provider: 'staging',
          webhookSecret: 'a-sufficiently-long-staging-secret',
          stagingDefaultScenario: 'SUCCESS',
        },
      }),
      fakeRedis,
    );

    expect(provider).toBeInstanceOf(StagingPaymentProvider);
  });

  it('returns the http provider when configured', () => {
    const provider = createPaymentProvider(
      config({
        app: { environment: 'production', appEnvironment: 'production' },
        payments: {
          provider: 'http',
          apiBaseUrl: 'https://gateway.example/v1/',
          apiKey: 'key',
          webhookSecret: 'a-sufficiently-long-secret',
          requestTimeoutMs: 10_000,
        },
      }),
      fakeRedis,
    );

    expect(provider).toBeInstanceOf(HttpPaymentProvider);
  });

  it('refuses the development simulator in staging', () => {
    expect(() =>
      createPaymentProvider(
        config({
          app: { environment: 'production', appEnvironment: 'staging' },
          payments: { provider: 'development' },
        }),
        fakeRedis,
      ),
    ).toThrow('must not run in staging or production');
  });

  it('refuses the development simulator in production', () => {
    expect(() =>
      createPaymentProvider(
        config({
          app: { environment: 'production', appEnvironment: 'production' },
          payments: { provider: 'development' },
        }),
        fakeRedis,
      ),
    ).toThrow('must not run in staging or production');
  });

  it('refuses the staging provider in production', () => {
    expect(() =>
      createPaymentProvider(
        config({
          app: { environment: 'production', appEnvironment: 'production' },
          payments: { provider: 'staging' },
        }),
        fakeRedis,
      ),
    ).toThrow('StagingPaymentProvider must not run in production');
  });
});
