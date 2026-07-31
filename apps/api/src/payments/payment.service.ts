import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import {
  DriverPayoutStatus,
  NotificationType,
  PaymentIntentStatus,
  PaymentTransactionStatus,
  PaymentTransactionType,
} from '../generated/prisma/client.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly notificationOutbox: NotificationOutboxService,
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
    this.assertActiveProvider(intent.provider);
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
    const succeeded = captured.status === 'CAPTURED';
    const transaction = await this.appendTransaction(
      intent,
      PaymentTransactionType.CAPTURE,
      succeeded,
      idempotencyKey,
      captured.id,
      PaymentIntentStatus.CAPTURED,
    );
    if (!succeeded) {
      await this.notifyTripPassenger(
        intent.tripId,
        intent.id,
        NotificationType.PASSENGER_PAYMENT_FAILED,
        `payment-capture-failed:${idempotencyKey}`,
      );
    }
    return transaction;
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
    const succeeded = refunded.status === 'REFUNDED';
    const transaction = await this.appendTransaction(
      intent,
      PaymentTransactionType.REFUND,
      succeeded,
      idempotencyKey,
      refunded.id,
      PaymentIntentStatus.REFUNDED,
    );
    if (succeeded) {
      await this.notifyTripPassenger(
        intent.tripId,
        intent.id,
        NotificationType.PASSENGER_REFUND_COMPLETED,
        `refund-completed:${idempotencyKey}`,
      );
    }
    return transaction;
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
    const succeeded = payout.status === 'PAID';
    const created = await this.prisma.driverPayout.create({
      data: {
        tripId: input.tripId,
        driverId: input.driverId,
        provider: this.provider.name,
        providerPayoutId: payout.id,
        idempotencyKey: input.idempotencyKey,
        amountKopecks: input.amountKopecks,
        status: succeeded ? DriverPayoutStatus.PAID : DriverPayoutStatus.FAILED,
      },
    });
    const draft = this.notifications.createDraft({
      userId: input.driverId,
      type: succeeded
        ? NotificationType.DRIVER_PAYOUT_COMPLETED
        : NotificationType.DRIVER_PAYOUT_FAILED,
      application: 'DRIVER' as never,
      entityType: 'TRIP',
      entityId: input.tripId,
      idempotencyKey: `driver-payout:${input.idempotencyKey}`,
      templateParams: { tripId: input.tripId },
    });
    await this.notificationOutbox.enqueue(this.prisma, draft);
    return created;
  }

  /**
   * Best-effort push after an already-committed payment write — see
   * TripLifecycleService.notifyLifecycleAction for the same reasoning.
   * entityType is PAYMENT (not TRIP) here to match the deep-link route
   * these two notification types render (`resilienttaxi://payments/{id}`).
   * Silently no-ops if the trip has no passenger on record (should never
   * happen in practice).
   */
  private async notifyTripPassenger(
    tripId: string,
    paymentId: string,
    type: NotificationType,
    idempotencyKey: string,
  ): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { passengerId: true },
    });
    if (!trip) return;

    const draft = this.notifications.createDraft({
      userId: trip.passengerId,
      type,
      application: 'PASSENGER' as never,
      entityType: 'PAYMENT',
      entityId: paymentId,
      idempotencyKey,
      templateParams: { paymentId },
    });
    await this.notificationOutbox.enqueue(this.prisma, draft);
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
    this.assertActiveProvider(intent.provider);
    if (intent.status === PaymentIntentStatus.REFUNDED)
      throw new ConflictException({
        code: 'PAYMENT_ALREADY_REFUNDED',
        message: 'Payment has already been refunded',
      });
    return intent;
  }

  /**
   * A payment intent stores the provider that created it. Operations that reuse
   * the stored `providerPaymentId` must run against that same provider, so a
   * change of `PAYMENTS_PROVIDER` while an intent is unsettled fails loudly
   * instead of sending the id to the wrong gateway.
   */
  private assertActiveProvider(intentProvider: string): void {
    if (intentProvider !== this.provider.name)
      throw new ConflictException({
        code: 'PAYMENT_PROVIDER_MISMATCH',
        message: `Payment intent was created with provider "${intentProvider}" but "${this.provider.name}" is active`,
      });
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
