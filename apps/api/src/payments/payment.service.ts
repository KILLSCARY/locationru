import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import {
  DriverPayoutStatus,
  PaymentIntentStatus,
  PaymentTransactionStatus,
  PaymentTransactionType,
} from '../generated/prisma/client.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly prisma: PrismaService,
  ) {}

  async createPayment(input: {
    amountKopecks: number;
    idempotencyKey: string;
    tripId: string;
  }) {
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
    const created = await this.provider.createPayment({
      amountKopecks: input.amountKopecks,
      idempotencyKey: input.idempotencyKey,
      metadata: { tripId: input.tripId },
    });
    return this.prisma.paymentIntent.create({
      data: {
        tripId: input.tripId,
        provider: this.provider.name,
        providerPaymentId: created.id,
        idempotencyKey: input.idempotencyKey,
        amountKopecks: input.amountKopecks,
        status: this.intentStatus(created.status),
      },
    });
  }

  async getPaymentStatus(intentId: string) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: intentId },
    });
    if (!intent)
      throw new NotFoundException({
        code: 'PAYMENT_INTENT_NOT_FOUND',
        message: 'Payment intent was not found',
      });
    return this.provider.getPaymentStatus(intent.providerPaymentId);
  }

  async capturePayment(intentId: string, idempotencyKey: string) {
    const existing = await this.prisma.paymentTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;
    const intent = await this.intent(intentId);
    const captured = await this.provider.capturePayment(
      intent.providerPaymentId,
      intent.amountKopecks,
      idempotencyKey,
    );
    return this.appendTransaction(
      intent,
      PaymentTransactionType.CAPTURE,
      captured.status === 'CAPTURED',
      idempotencyKey,
      captured.id,
      PaymentIntentStatus.CAPTURED,
    );
  }

  async cancelPayment(intentId: string, idempotencyKey: string) {
    const existing = await this.prisma.paymentTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;
    const intent = await this.intent(intentId);
    const canceled = await this.provider.cancelPayment(
      intent.providerPaymentId,
      idempotencyKey,
    );
    return this.appendTransaction(
      intent,
      PaymentTransactionType.CANCELLATION,
      canceled.status === 'CANCELED',
      idempotencyKey,
      canceled.id,
      PaymentIntentStatus.CANCELED,
    );
  }

  async refundPayment(intentId: string, idempotencyKey: string) {
    const existing = await this.prisma.paymentTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;
    const intent = await this.intent(intentId);
    const refunded = await this.provider.refundPayment(
      intent.providerPaymentId,
      intent.amountKopecks,
      idempotencyKey,
    );
    return this.appendTransaction(
      intent,
      PaymentTransactionType.REFUND,
      refunded.status === 'REFUNDED',
      idempotencyKey,
      refunded.id,
      PaymentIntentStatus.REFUNDED,
    );
  }

  async createDriverPayout(input: {
    amountKopecks: number;
    driverId: string;
    idempotencyKey: string;
    tripId: string;
  }) {
    const existing = await this.prisma.driverPayout.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return existing;
    const payout = await this.provider.createDriverPayout(input);
    return this.prisma.driverPayout.create({
      data: {
        tripId: input.tripId,
        driverId: input.driverId,
        provider: this.provider.name,
        providerPayoutId: payout.id,
        idempotencyKey: input.idempotencyKey,
        amountKopecks: input.amountKopecks,
        status:
          payout.status === 'PAID'
            ? DriverPayoutStatus.PAID
            : DriverPayoutStatus.FAILED,
      },
    });
  }

  async recordCommission(input: {
    commissionBasisPoints: number;
    commissionKopecks: number;
    driverId: string;
    driverPayoutKopecks: number;
    totalKopecks: number;
    tripId: string;
  }) {
    const existing = await this.prisma.commissionRecord.findUnique({
      where: { tripId: input.tripId },
    });
    if (existing) return existing;
    return this.prisma.commissionRecord.create({ data: input });
  }

  async processWebhook(input: { payload: string; signature: string }) {
    const event = this.provider.verifyWebhook(input);
    const existing = await this.prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: this.provider.name,
          providerEventId: event.eventId,
        },
      },
    });
    if (existing) return { duplicate: true };
    await this.prisma.paymentWebhookEvent.create({
      data: {
        provider: this.provider.name,
        providerEventId: event.eventId,
        signature: input.signature,
        payload: event,
      },
    });
    return { duplicate: false };
  }

  private async intent(id: string) {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id },
    });
    if (!intent)
      throw new NotFoundException({
        code: 'PAYMENT_INTENT_NOT_FOUND',
        message: 'Payment intent was not found',
      });
    if (intent.status === PaymentIntentStatus.REFUNDED)
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_REFUNDED',
        message: 'Payment has already been refunded',
      });
    return intent;
  }

  private async appendTransaction(
    intent: Awaited<ReturnType<PaymentService['intent']>>,
    type: PaymentTransactionType,
    succeeded: boolean,
    idempotencyKey: string,
    providerReference: string,
    intentStatus: PaymentIntentStatus,
  ) {
    const transaction = await this.prisma.paymentTransaction.create({
      data: {
        paymentIntentId: intent.id,
        type,
        status: succeeded
          ? PaymentTransactionStatus.SUCCEEDED
          : PaymentTransactionStatus.FAILED,
        amountKopecks: intent.amountKopecks,
        providerReference: `${providerReference}:${type}:${idempotencyKey}`,
        idempotencyKey,
      },
    });
    if (succeeded)
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: intentStatus },
      });
    return transaction;
  }

  private intentStatus(status: string): PaymentIntentStatus {
    return status === 'AUTHORIZED'
      ? PaymentIntentStatus.AUTHORIZED
      : PaymentIntentStatus.FAILED;
  }
}
