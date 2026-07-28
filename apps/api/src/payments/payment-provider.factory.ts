import { ConfigService } from '@nestjs/config';

import { DevelopmentPaymentProvider } from './development-payment.provider.js';
import { HttpPaymentProvider } from './http-payment.provider.js';
import type { PaymentProvider } from './payment-provider.js';

/**
 * Selects the payment provider implementation from configuration. The
 * development simulator is refused in production; env validation enforces the
 * same rule, this is the defence in depth at the composition root.
 */
export function createPaymentProvider(config: ConfigService): PaymentProvider {
  const provider = config.getOrThrow<'development' | 'http'>(
    'payments.provider',
  );
  const environment = config.getOrThrow<string>('app.environment');

  if (provider === 'development') {
    if (environment === 'production') {
      throw new Error(
        'DevelopmentPaymentProvider must not run in production; set PAYMENTS_PROVIDER=http',
      );
    }
    return new DevelopmentPaymentProvider(config);
  }

  return new HttpPaymentProvider(config);
}
