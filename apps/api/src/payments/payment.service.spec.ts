import { createHash } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { DevelopmentPaymentProvider } from './development-payment.provider.js';
import { HttpPaymentProvider } from './http-payment.provider.js';
import { PaymentService } from './payment.service.js';

class PaymentPrismaFake {
  private nextId = 1;
  readonly intents = new Map<string, Record<string, unknown>>();
  readonly transactions = new Map<string, Record<string, unknown>>();
  readonly webhooks = new Map<string, Record<string, unknown>>();

  readonly paymentIntent = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const intent = { ...data, id: `intent-${this.nextId++}` };
      this.intents.set(intent.id as string, intent);
      return intent;
    },
    findUnique: async ({
      where,
    }: {
      where: { id?: string; idempotencyKey?: string };
    }) =>
      [...this.intents.values()].find((intent) =>
        where.id
          ? intent.id === where.id
          : intent.idempotencyKey === where.idempotencyKey,
      ) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const intent = this.intents.get(where.id)!;
      Object.assign(intent, data);
      return intent;
    },
  };

  readonly paymentTransaction = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const transaction = { ...data, id: `transaction-${this.nextId++}` };
      this.transactions.set(transaction.idempotencyKey as string, transaction);
      return transaction;
    },
    findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
      this.transactions.get(where.idempotencyKey) ?? null,
  };

  readonly paymentWebhookEvent = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.webhooks.set(`${data.provider}:${data.providerEventId}`, data);
      return data;
    },
    findUnique: async ({
      where,
    }: {
      where: {
        provider_providerEventId: { provider: string; providerEventId: string };
      };
    }) =>
      this.webhooks.get(
        `${where.provider_providerEventId.provider}:${where.provider_providerEventId.providerEventId}`,
      ) ?? null,
  };
}

describe('Payment architecture', () => {
  const provider = new DevelopmentPaymentProvider(
    new ConfigService({ app: { environment: 'test', appEnvironment: 'test' } }),
  );
  const prisma = new PaymentPrismaFake();
  const service = new PaymentService(provider, prisma as never);

  it('handles deterministic provider success and failure scenarios', async () => {
    await expect(
      provider.createPayment({
        amountKopecks: 100,
        idempotencyKey: 'success',
        metadata: {},
      }),
    ).resolves.toMatchObject({ status: 'AUTHORIZED' });
    await expect(
      provider.createPayment({
        amountKopecks: 100,
        idempotencyKey: 'failure',
        metadata: { scenario: 'fail' },
      }),
    ).resolves.toMatchObject({ status: 'FAILED' });
  });

  it('records a refund as an appended reverse transaction', async () => {
    const intent = await service.createPayment({
      tripId: 'trip-1',
      amountKopecks: 500,
      idempotencyKey: 'create-1',
    });
    await service.capturePayment(intent.id as string, 'capture-1');
    const refund = await service.refundPayment(intent.id as string, 'refund-1');

    expect(refund).toMatchObject({
      type: 'REFUND',
      amountKopecks: 500,
      status: 'SUCCEEDED',
    });
    expect(prisma.transactions.get('capture-1')).toBeDefined();
    expect(prisma.transactions.get('refund-1')).toBeDefined();
  });

  it('processes a webhook only once', async () => {
    const payload = JSON.stringify({
      eventId: 'event-1',
      paymentId: 'dev-payment-1',
      type: 'payment.captured',
    });
    const signature = createHash('sha256').update(payload).digest('hex');
    const first = await service.processWebhook({ payload, signature });
    const repeated = await service.processWebhook({ payload, signature });

    expect(first).toEqual({ duplicate: false });
    expect(repeated).toEqual({ duplicate: true });
  });

  it('refuses to operate on an intent created by another provider', async () => {
    const intent = await service.createPayment({
      tripId: 'trip-2',
      amountKopecks: 500,
      idempotencyKey: 'create-2',
    });

    // Same stored intents, but a provider with a different name is now active.
    const httpProvider = new HttpPaymentProvider(
      new ConfigService({
        payments: {
          apiBaseUrl: 'https://gateway.example/v1/',
          apiKey: 'k',
          webhookSecret: 'a-sufficiently-long-secret',
          requestTimeoutMs: 10_000,
        },
      }),
    );
    const switched = new PaymentService(httpProvider, prisma as never);

    await expect(
      switched.capturePayment(intent.id as string, 'capture-2'),
    ).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROVIDER_MISMATCH' },
    });
    await expect(
      switched.getPaymentStatus(intent.id as string),
    ).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROVIDER_MISMATCH' },
    });
  });
});
