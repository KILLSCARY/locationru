import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import { RedisService } from '../../redis/redis.service.js';
import { DevelopmentSmsProvider } from './development-sms.provider.js';
import { HttpSmsProvider } from './http-sms.provider.js';
import { StagingSmsProvider } from './staging-sms.provider.js';
import type { SmsProvider } from './sms-provider.interface.js';

/**
 * Selects the SMS provider implementation from configuration. The development
 * provider only logs OTP codes and is refused in staging/production; env
 * validation enforces the same rule, this is the defence in depth at the
 * composition root.
 */
export function createSmsProvider(
  config: ConfigService,
  redis: RedisService,
): SmsProvider {
  const provider = config.getOrThrow<'development' | 'staging' | 'http'>(
    'sms.provider',
  );
  const environment = config.getOrThrow<AppEnvironment>('app.appEnvironment');

  if (provider === 'development') {
    if (
      environment === AppEnvironment.STAGING ||
      environment === AppEnvironment.PRODUCTION
    ) {
      throw new Error(
        'DevelopmentSmsProvider must not be used in staging or production; set SMS_PROVIDER=staging or http',
      );
    }
    return new DevelopmentSmsProvider(config);
  }

  if (provider === 'staging') {
    if (environment === AppEnvironment.PRODUCTION) {
      throw new Error(
        'StagingSmsProvider must not be used in production; set SMS_PROVIDER=http',
      );
    }
    return new StagingSmsProvider(config, redis);
  }

  return new HttpSmsProvider(config);
}
