import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../redis/redis.service.js';
import { createSmsProvider } from '../auth/providers/sms-provider.factory.js';
import { SMS_PROVIDER } from '../auth/providers/sms-provider.interface.js';
import { SmsWebhookController } from './sms-webhook.controller.js';
import { SmsWebhookService } from './sms-webhook.service.js';

/**
 * A second SMS_PROVIDER binding, independent of AuthModule's. Nest DI tokens
 * are module-scoped unless exported, and importing AuthModule here would
 * pull in its controllers/guards for no reason — createSmsProvider is a
 * pure factory, so binding it again is cheap and keeps this module
 * self-contained.
 */
@Module({
  controllers: [SmsWebhookController],
  providers: [
    SmsWebhookService,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) =>
        createSmsProvider(config, redis),
    },
  ],
})
export class SmsWebhookModule {}
