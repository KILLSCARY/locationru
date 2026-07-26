import { Module } from '@nestjs/common';

import { DevelopmentPaymentProvider } from './development-payment.provider.js';
import { PAYMENT_PROVIDER } from './payment-provider.js';
import { PaymentService } from './payment.service.js';

@Module({
  providers: [
    DevelopmentPaymentProvider,
    { provide: PAYMENT_PROVIDER, useExisting: DevelopmentPaymentProvider },
    PaymentService,
  ],
  exports: [PAYMENT_PROVIDER, PaymentService],
})
export class PaymentsModule {}
