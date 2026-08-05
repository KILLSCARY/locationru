import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  PaymentProvider,
  ProviderPayment,
  ProviderWebhook,
} from './payment-provider.js';

/**
 * Production-facing payment provider scaffold.
 *
 * The transport (base URL, API key, timeout) and webhook signature
 * verification are wired here. The money-moving operations intentionally throw
 * {@link NotImplementedException} until a concrete gateway (ЮKassa, T-Bank,
 * CloudPayments, ...) is plugged into {@link HttpPaymentProvider.request}. This
 * keeps production from silently faking payments before the integration exists.
 */
@Injectable()
export class HttpPaymentProvider implements PaymentProvider {
  readonly name = 'http';

  private readonly logger = new Logger(HttpPaymentProvider.name);
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly requestTimeoutMs: number;

  constructor(config: ConfigService) {
    this.apiBaseUrl = config.getOrThrow<string>('payments.apiBaseUrl');
    this.apiKey = config.getOrThrow<string>('payments.apiKey');
    this.webhookSecret = config.getOrThrow<string>('payments.webhookSecret');
    this.requestTimeoutMs = config.getOrThrow<number>(
      'payments.requestTimeoutMs',
    );
  }

  async createPayment(): Promise<ProviderPayment> {
    return this.notImplemented('createPayment');
  }

  async getPaymentStatus(): Promise<ProviderPayment> {
    return this.notImplemented('getPaymentStatus');
  }

  async capturePayment(): Promise<ProviderPayment> {
    return this.notImplemented('capturePayment');
  }

  async cancelPayment(): Promise<ProviderPayment> {
    return this.notImplemented('cancelPayment');
  }

  async refundPayment(): Promise<ProviderPayment> {
    return this.notImplemented('refundPayment');
  }

  async createDriverPayout(): Promise<{
    id: string;
    status: 'PAID' | 'FAILED';
  }> {
    return this.notImplemented('createDriverPayout');
  }

  /**
   * Verifies an HMAC-SHA256 signature over the raw payload. The default scheme
   * (hex digest of the body keyed with the webhook secret) covers the common
   * case; adjust the digest encoding or signed material to match the concrete
   * gateway when it is wired in.
   */
  verifyWebhook(input: {
    payload: string;
    signature: string;
  }): ProviderWebhook {
    const expected = createHmac('sha256', this.webhookSecret)
      .update(input.payload)
      .digest('hex');

    if (!this.signaturesEqual(input.signature, expected)) {
      throw new Error('Invalid payment webhook signature');
    }

    return JSON.parse(input.payload) as ProviderWebhook;
  }

  /**
   * Authenticated JSON request against the payment gateway. Concrete provider
   * methods build on this helper once the gateway is chosen.
   */
  protected async request<T>(
    path: string,
    init: { method: string; body?: unknown; idempotencyKey?: string },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(new URL(path, this.apiBaseUrl), {
        method: init.method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          ...(init.idempotencyKey
            ? { 'idempotence-key': init.idempotencyKey }
            : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text();
        this.logger.error(
          `Payment gateway ${init.method} ${path} failed: ${response.status} ${detail}`,
        );
        throw new Error(`Payment gateway responded with ${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private notImplemented(operation: string): never {
    throw new NotImplementedException({
      code: 'PAYMENT_PROVIDER_NOT_IMPLEMENTED',
      message: `HttpPaymentProvider.${operation} is not wired to a gateway yet`,
    });
  }

  private signaturesEqual(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);

    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }
}
