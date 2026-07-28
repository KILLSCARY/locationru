import { ConfigService } from '@nestjs/config';

import { DevelopmentSmsProvider } from './development-sms.provider.js';
import { HttpSmsProvider } from './http-sms.provider.js';
import { createSmsProvider } from './sms-provider.factory.js';

const config = (values: Record<string, unknown>): ConfigService =>
  new ConfigService(values);

describe('createSmsProvider', () => {
  it('returns the development provider outside production', () => {
    const provider = createSmsProvider(
      config({
        app: { environment: 'development' },
        sms: { provider: 'development' },
      }),
    );

    expect(provider).toBeInstanceOf(DevelopmentSmsProvider);
  });

  it('returns the http provider when configured', () => {
    const provider = createSmsProvider(
      config({
        app: { environment: 'production' },
        sms: {
          provider: 'http',
          apiBaseUrl: 'https://gateway.example/v1/',
          apiKey: 'key',
          sender: 'ResilientTaxi',
          requestTimeoutMs: 10_000,
        },
      }),
    );

    expect(provider).toBeInstanceOf(HttpSmsProvider);
  });

  it('refuses the development provider in production', () => {
    expect(() =>
      createSmsProvider(
        config({
          app: { environment: 'production' },
          sms: { provider: 'development' },
        }),
      ),
    ).toThrow('must not be used in production');
  });
});
