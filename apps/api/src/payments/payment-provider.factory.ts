import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import { RedisService } from '../redis/redis.service.js';
import { DevelopmentPaymentProvider } from './development-payment.provider.js';
import { HttpPaymentProvider } from './http-payment.provider.js';
import type { PaymentProvider } from './payment-provider.js';
import { StagingPaymentProvider } from './staging-payment.provider.js';

/**
 * Selects the payment provider implementation from configuration. The
 * development simulator is refused in staging/production; env validation
 * enforces the same rule, this is the defence in depth at the composition root.
 */
export function createPaymentProvider(
  config: ConfigService,
  redis: RedisService,
): PaymentProvider {
  const provider = config.getOrThrow<'development' | 'staging' | 'http'>(
    'payments.provider',
  );
  const environment = config.getOrThrow<AppEnvironment>('app.appEnvironment');

  if (provider === 'development') {
    if (
      environment === AppEnvironment.STAGING ||
      environment === AppEnvironment.PRODUCTION
    ) {
      throw new Error(
        'DevelopmentPaymentProvider must not run in staging or production; set PAYMENTS_PROVIDER=staging or http',
      );
    }
    return new DevelopmentPaymentProvider(config);
  }

  if (provider === 'staging') {
    if (environment === AppEnvironment.PRODUCTION) {
      throw new Error(
        'StagingPaymentProvider must not run in production; set PAYMENTS_PROVIDER=http',
      );
    }
    return new StagingPaymentProvider(config, redis);
  }

  return new HttpPaymentProvider(config);
}
