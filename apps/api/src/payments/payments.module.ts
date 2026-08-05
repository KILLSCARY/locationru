import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { RedisService } from '../redis/redis.service.js';
import { createPaymentProvider } from './payment-provider.factory.js';
import { PAYMENT_PROVIDER } from './payment-provider.js';
import { PaymentService } from './payment.service.js';
import { PaymentsWebhookController } from './payments-webhook.controller.js';

@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsWebhookController],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) =>
        createPaymentProvider(config, redis),
    },
    PaymentService,
  ],
  exports: [PAYMENT_PROVIDER, PaymentService],
})
export class PaymentsModule {}
