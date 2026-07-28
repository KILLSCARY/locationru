import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createPaymentProvider } from './payment-provider.factory.js';
import { PAYMENT_PROVIDER } from './payment-provider.js';
import { PaymentService } from './payment.service.js';

@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createPaymentProvider(config),
    },
    PaymentService,
  ],
  exports: [PAYMENT_PROVIDER, PaymentService],
})
export class PaymentsModule {}
