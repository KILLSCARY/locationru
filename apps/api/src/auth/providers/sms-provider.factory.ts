import { ConfigService } from '@nestjs/config';

import { DevelopmentSmsProvider } from './development-sms.provider.js';
import { HttpSmsProvider } from './http-sms.provider.js';
import type { SmsProvider } from './sms-provider.interface.js';

/**
 * Selects the SMS provider implementation from configuration. The development
 * provider only logs OTP codes and is refused in production; env validation
 * enforces the same rule, this is the defence in depth at the composition root.
 */
export function createSmsProvider(config: ConfigService): SmsProvider {
  const provider = config.getOrThrow<'development' | 'http'>('sms.provider');
  const environment = config.getOrThrow<string>('app.environment');

  if (provider === 'development') {
    if (environment === 'production') {
      throw new Error(
        'DevelopmentSmsProvider must not be used in production; set SMS_PROVIDER=http',
      );
    }
    return new DevelopmentSmsProvider(config);
  }

  return new HttpSmsProvider(config);
}
