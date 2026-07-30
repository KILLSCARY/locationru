import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import { RedisService } from '../redis/redis.service.js';
import type {
  PaymentProvider,
  ProviderPayment,
  ProviderWebhook,
} from './payment-provider.js';

export type StagingPaymentScenario =
  | 'SUCCESS'
  | 'DECLINED'
  | 'TIMEOUT'
  | 'DUPLICATE_WEBHOOK'
  | 'REFUND'
  | 'PAYOUT_FAILED';

const STAGING_SCENARIOS: readonly StagingPaymentScenario[] = [
  'SUCCESS',
  'DECLINED',
  'TIMEOUT',
  'DUPLICATE_WEBHOOK',
  'REFUND',
  'PAYOUT_FAILED',
];

interface StagingPaymentRecord {
  id: string;
  status: ProviderPayment['status'];
  scenario: StagingPaymentScenario;
}

function scenarioOverrideKey(tripId: string): string {
  return `staging:payment-scenario:${tripId}`;
}

function paymentRecordKey(paymentId: string): string {
  return `staging:payment:${paymentId}`;
}

// Long enough to outlive any staging trip's lifecycle, short enough that
// abandoned test data doesn't accumulate forever.
const RECORD_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Simulates a real payment gateway for staging: no real money ever moves,
 * but every call goes through the exact same shape a production adapter
 * would (authorize -> capture -> settle, or authorize -> cancel/refund),
 * and every operation is recorded exactly like a real provider would be —
 * via PaymentService's own Postgres ledger (PaymentIntent/PaymentTransaction/
 * DriverPayout/PaymentWebhookEvent), not a private copy inside this class.
 *
 * The one thing this class itself persists (in Redis, not Postgres) is which
 * synthetic *scenario* a given trip's payment should follow — set only
 * through the SUPER_ADMIN-guarded staging tool
 * (StagingToolsController.setPaymentScenario), never by the paying client:
 * PaymentService.createPayment only ever forwards `{ tripId }` as metadata,
 * so there is no client-controlled field this class reads a scenario from.
 */
@Injectable()
export class StagingPaymentProvider implements PaymentProvider {
  readonly name = 'staging';

  private readonly logger = new Logger(StagingPaymentProvider.name);
  private readonly defaultScenario: StagingPaymentScenario;
  private readonly webhookSecret: string;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    const environment = this.config.getOrThrow<AppEnvironment>(
      'app.appEnvironment',
    );
    if (environment === AppEnvironment.PRODUCTION) {
      throw new Error('StagingPaymentProvider must not be used in production');
    }
    this.defaultScenario = this.config.getOrThrow<StagingPaymentScenario>(
      'payments.stagingDefaultScenario',
    );
    this.webhookSecret = this.config.getOrThrow<string>(
      'payments.webhookSecret',
    );
  }

  /** Sets (or clears, passing null) the scenario override for one trip. */
  async setScenarioOverride(
    tripId: string,
    scenario: StagingPaymentScenario | null,
  ): Promise<void> {
    if (scenario === null) {
      await this.redis.delete(scenarioOverrideKey(tripId));
      return;
    }
    await this.redis.setWithTtl(
      scenarioOverrideKey(tripId),
      scenario,
      RECORD_TTL_SECONDS,
    );
  }

  async createPayment(input: {
    amountKopecks: number;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<ProviderPayment> {
    const tripId = input.metadata.tripId ?? '';
    const scenario = await this.resolveScenario(tripId);
    const id = `staging-payment-${randomUUID()}`;

    if (scenario === 'TIMEOUT') {
      await this.simulateTimeout();
    }

    const status: ProviderPayment['status'] =
      scenario === 'DECLINED' ? 'FAILED' : 'AUTHORIZED';
    const payment: ProviderPayment = { id, status };
    await this.saveRecord({ id, status, scenario });
    return payment;
  }

  async getPaymentStatus(paymentId: string): Promise<ProviderPayment> {
    const record = await this.loadRecord(paymentId);
    return record
      ? { id: record.id, status: record.status }
      : { id: paymentId, status: 'FAILED' };
  }

  async capturePayment(
    paymentId: string,
    amountKopecks: number,
    idempotencyKey: string,
  ): Promise<ProviderPayment> {
    void amountKopecks;
    void idempotencyKey;
    const record = await this.loadRecord(paymentId);
    const status: ProviderPayment['status'] =
      record?.status === 'FAILED' ? 'FAILED' : 'CAPTURED';
    const payment: ProviderPayment = { id: paymentId, status };
    await this.saveRecord({
      id: paymentId,
      status,
      scenario: record?.scenario ?? this.defaultScenario,
    });
    return payment;
  }

  async cancelPayment(
    paymentId: string,
    idempotencyKey: string,
  ): Promise<ProviderPayment> {
    void idempotencyKey;
    const record = await this.loadRecord(paymentId);
    const payment: ProviderPayment = { id: paymentId, status: 'CANCELED' };
    await this.saveRecord({
      id: paymentId,
      status: 'CANCELED',
      scenario: record?.scenario ?? this.defaultScenario,
    });
    return payment;
  }

  async refundPayment(
    paymentId: string,
    amountKopecks: number,
    idempotencyKey: string,
  ): Promise<ProviderPayment> {
    void amountKopecks;
    void idempotencyKey;
    const record = await this.loadRecord(paymentId);
    const payment: ProviderPayment = { id: paymentId, status: 'REFUNDED' };
    await this.saveRecord({
      id: paymentId,
      status: 'REFUNDED',
      scenario: record?.scenario ?? this.defaultScenario,
    });
    return payment;
  }

  async createDriverPayout(input: {
    amountKopecks: number;
    idempotencyKey: string;
    driverId: string;
  }): Promise<{ id: string; status: 'PAID' | 'FAILED' }> {
    const scenario = await this.resolveScenario(input.driverId);
    const id = `staging-payout-${randomUUID()}`;
    if (scenario === 'PAYOUT_FAILED' || input.amountKopecks <= 0) {
      return { id, status: 'FAILED' };
    }
    return { id, status: 'PAID' };
  }

  /** Builds and signs a synthetic webhook payload for the staging simulator tool. */
  buildWebhook(input: {
    paymentId: string;
    type: ProviderWebhook['type'];
    eventId?: string;
  }): { payload: string; signature: string } {
    const event: ProviderWebhook = {
      eventId: input.eventId ?? randomUUID(),
      paymentId: input.paymentId,
      type: input.type,
    };
    const payload = JSON.stringify(event);
    return { payload, signature: this.sign(payload) };
  }

  verifyWebhook(input: {
    payload: string;
    signature: string;
  }): ProviderWebhook {
    const expected = Buffer.from(this.sign(input.payload), 'hex');
    const actual = Buffer.from(input.signature, 'hex');
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new Error('Invalid staging webhook signature');
    }
    return JSON.parse(input.payload) as ProviderWebhook;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');
  }

  private async resolveScenario(
    overrideKeySubject: string,
  ): Promise<StagingPaymentScenario> {
    if (!overrideKeySubject) return this.defaultScenario;
    const stored = await this.redis.get(scenarioOverrideKey(overrideKeySubject));
    if (stored && (STAGING_SCENARIOS as readonly string[]).includes(stored)) {
      return stored as StagingPaymentScenario;
    }
    return this.defaultScenario;
  }

  private async simulateTimeout(): Promise<never> {
    // A brief real delay, so callers genuinely exercise a slow-provider code
    // path (loading states, timeouts) rather than failing instantly.
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.logger.warn({ event: 'payments.staging_timeout_simulated' });
    throw new Error('Staging payment provider: simulated gateway timeout');
  }

  private async saveRecord(record: StagingPaymentRecord): Promise<void> {
    await this.redis.setWithTtl(
      paymentRecordKey(record.id),
      JSON.stringify(record),
      RECORD_TTL_SECONDS,
    );
  }

  private async loadRecord(
    paymentId: string,
  ): Promise<StagingPaymentRecord | null> {
    const raw = await this.redis.get(paymentRecordKey(paymentId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StagingPaymentRecord;
    } catch {
      return null;
    }
  }
}
