import { createHash, randomUUID } from 'node:crypto';

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import type {
  PaymentProvider,
  ProviderPayment,
  ProviderWebhook,
} from './payment-provider.js';

/** Local deterministic simulator. It records no real payment instrument and never transfers money. */
@Injectable()
export class DevelopmentPaymentProvider
  implements PaymentProvider, OnModuleInit
{
  readonly name = 'development';

  private readonly payments = new Map<string, ProviderPayment>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const environment = this.config.getOrThrow<AppEnvironment>(
      'app.appEnvironment',
    );
    if (
      environment === AppEnvironment.STAGING ||
      environment === AppEnvironment.PRODUCTION
    ) {
      throw new Error(
        'DevelopmentPaymentProvider must not run in staging or production',
      );
    }
  }

  async createPayment(input: {
    amountKopecks: number;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<ProviderPayment> {
    const id = `dev-payment-${this.idFor(input.idempotencyKey)}`;
    const status = input.metadata.scenario === 'fail' ? 'FAILED' : 'AUTHORIZED';
    const payment = { id, status } as ProviderPayment;
    this.payments.set(id, payment);
    return payment;
  }

  async getPaymentStatus(paymentId: string): Promise<ProviderPayment> {
    return this.payments.get(paymentId) ?? { id: paymentId, status: 'FAILED' };
  }

  async capturePayment(
    paymentId: string,
    amountKopecks: number,
    idempotencyKey: string,
  ): Promise<ProviderPayment> {
    void amountKopecks;
    void idempotencyKey;
    const existing = await this.getPaymentStatus(paymentId);
    const payment = {
      id: paymentId,
      status: existing.status === 'FAILED' ? 'FAILED' : 'CAPTURED',
    } as ProviderPayment;
    this.payments.set(paymentId, payment);
    return payment;
  }

  async cancelPayment(
    paymentId: string,
    idempotencyKey: string,
  ): Promise<ProviderPayment> {
    void idempotencyKey;
    const payment = { id: paymentId, status: 'CANCELED' } as ProviderPayment;
    this.payments.set(paymentId, payment);
    return payment;
  }

  async refundPayment(
    paymentId: string,
    amountKopecks: number,
    idempotencyKey: string,
  ): Promise<ProviderPayment> {
    void amountKopecks;
    void idempotencyKey;
    const payment = { id: paymentId, status: 'REFUNDED' } as ProviderPayment;
    this.payments.set(paymentId, payment);
    return payment;
  }

  async createDriverPayout(input: {
    amountKopecks: number;
    idempotencyKey: string;
    driverId: string;
  }): Promise<{ id: string; status: 'PAID' | 'FAILED' }> {
    return {
      id: `dev-payout-${this.idFor(`${input.driverId}:${input.idempotencyKey}`)}`,
      status: input.amountKopecks > 0 ? 'PAID' : 'FAILED',
    };
  }

  verifyWebhook(input: {
    payload: string;
    signature: string;
  }): ProviderWebhook {
    const expected = createHash('sha256').update(input.payload).digest('hex');
    if (input.signature !== expected)
      throw new Error('Invalid development webhook signature');
    return JSON.parse(input.payload) as ProviderWebhook;
  }

  private idFor(key: string): string {
    return (
      createHash('sha256').update(key).digest('hex').slice(0, 20) ||
      randomUUID()
    );
  }
}
