import { ConfigService } from '@nestjs/config';

import { StagingPaymentProvider } from './staging-payment.provider.js';

class FakeRedis {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setWithTtl(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeProvider(overrides: Record<string, unknown> = {}) {
  const config = new ConfigService({
    app: { appEnvironment: 'staging' },
    payments: {
      stagingDefaultScenario: 'SUCCESS',
      webhookSecret: 'a-sufficiently-long-staging-webhook-secret',
      ...overrides,
    },
  });
  const redis = new FakeRedis();
  return {
    provider: new StagingPaymentProvider(config, redis as never),
    redis,
  };
}

describe('StagingPaymentProvider', () => {
  it('refuses to run in production', () => {
    const config = new ConfigService({
      app: { appEnvironment: 'production' },
      payments: {
        stagingDefaultScenario: 'SUCCESS',
        webhookSecret: 'x'.repeat(20),
      },
    });
    expect(() => new StagingPaymentProvider(config, {} as never)).toThrow(
      'must not be used in production',
    );
  });

  it('authorizes a payment under the default SUCCESS scenario', async () => {
    const { provider } = makeProvider();
    const payment = await provider.createPayment({
      amountKopecks: 60_000,
      idempotencyKey: 'key-1',
      metadata: { tripId: 'trip-1' },
    });
    expect(payment.status).toBe('AUTHORIZED');
  });

  it('declines a payment when the trip has a DECLINED scenario override', async () => {
    const { provider } = makeProvider();
    await provider.setScenarioOverride('trip-declined', 'DECLINED');
    const payment = await provider.createPayment({
      amountKopecks: 60_000,
      idempotencyKey: 'key-2',
      metadata: { tripId: 'trip-declined' },
    });
    expect(payment.status).toBe('FAILED');
  });

  it('rejects a driver payout under the PAYOUT_FAILED scenario', async () => {
    const { provider } = makeProvider();
    await provider.setScenarioOverride('driver-1', 'PAYOUT_FAILED');
    const payout = await provider.createDriverPayout({
      amountKopecks: 50_000,
      idempotencyKey: 'payout-1',
      driverId: 'driver-1',
    });
    expect(payout.status).toBe('FAILED');
  });

  it('throws to simulate a gateway timeout', async () => {
    const { provider } = makeProvider();
    await provider.setScenarioOverride('trip-timeout', 'TIMEOUT');
    await expect(
      provider.createPayment({
        amountKopecks: 60_000,
        idempotencyKey: 'key-3',
        metadata: { tripId: 'trip-timeout' },
      }),
    ).rejects.toThrow('simulated gateway timeout');
  });

  it('clearing a scenario override reverts to the default', async () => {
    const { provider } = makeProvider();
    await provider.setScenarioOverride('trip-4', 'DECLINED');
    await provider.setScenarioOverride('trip-4', null);
    const payment = await provider.createPayment({
      amountKopecks: 60_000,
      idempotencyKey: 'key-4',
      metadata: { tripId: 'trip-4' },
    });
    expect(payment.status).toBe('AUTHORIZED');
  });

  it('builds a webhook that verifies against its own signature', () => {
    const { provider } = makeProvider();
    const { payload, signature } = provider.buildWebhook({
      paymentId: 'staging-payment-1',
      type: 'payment.authorized',
    });
    const event = provider.verifyWebhook({ payload, signature });
    expect(event.paymentId).toBe('staging-payment-1');
    expect(event.type).toBe('payment.authorized');
  });

  it('rejects a webhook whose payload was tampered with', () => {
    const { provider } = makeProvider();
    const { payload, signature } = provider.buildWebhook({
      paymentId: 'staging-payment-2',
      type: 'payment.captured',
    });
    const tampered = payload.replace('payment.captured', 'payment.refunded');
    expect(() =>
      provider.verifyWebhook({ payload: tampered, signature }),
    ).toThrow('Invalid staging webhook signature');
  });

  it('rejects a webhook signed with a different secret', () => {
    const { provider: senderProvider } = makeProvider({
      webhookSecret: 'a-different-staging-secret-entirely',
    });
    const { provider: verifierProvider } = makeProvider();
    const { payload, signature } = senderProvider.buildWebhook({
      paymentId: 'staging-payment-3',
      type: 'payment.failed',
    });
    expect(() =>
      verifierProvider.verifyWebhook({ payload, signature }),
    ).toThrow('Invalid staging webhook signature');
  });

  it('reuses a caller-supplied eventId, so resending it tests idempotency downstream', () => {
    const { provider } = makeProvider();
    const first = provider.buildWebhook({
      paymentId: 'staging-payment-4',
      type: 'payment.refunded',
      eventId: 'fixed-event-id',
    });
    const second = provider.buildWebhook({
      paymentId: 'staging-payment-4',
      type: 'payment.refunded',
      eventId: 'fixed-event-id',
    });
    expect(JSON.parse(first.payload).eventId).toBe('fixed-event-id');
    expect(first.payload).toBe(second.payload);
    expect(first.signature).toBe(second.signature);
  });
});
