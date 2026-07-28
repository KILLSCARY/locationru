import { ConfigService } from '@nestjs/config';

import { DevelopmentPaymentProvider } from './development-payment.provider.js';
import { HttpPaymentProvider } from './http-payment.provider.js';
import { createPaymentProvider } from './payment-provider.factory.js';

const config = (values: Record<string, unknown>): ConfigService =>
  new ConfigService(values);

describe('createPaymentProvider', () => {
  it('returns the development simulator outside production', () => {
    const provider = createPaymentProvider(
      config({
        app: { environment: 'development' },
        payments: { provider: 'development' },
      }),
    );

    expect(provider).toBeInstanceOf(DevelopmentPaymentProvider);
  });

  it('returns the http provider when configured', () => {
    const provider = createPaymentProvider(
      config({
        app: { environment: 'production' },
        payments: {
          provider: 'http',
          apiBaseUrl: 'https://gateway.example/v1/',
          apiKey: 'key',
          webhookSecret: 'a-sufficiently-long-secret',
          requestTimeoutMs: 10_000,
        },
      }),
    );

    expect(provider).toBeInstanceOf(HttpPaymentProvider);
  });

  it('refuses the development simulator in production', () => {
    expect(() =>
      createPaymentProvider(
        config({
          app: { environment: 'production' },
          payments: { provider: 'development' },
        }),
      ),
    ).toThrow('must not run in production');
  });
});
