import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CircuitBreaker } from '../../maps/providers/circuit-breaker.js';
import type {
  DeliveryStatusResult,
  NormalizedWebhookEvent,
  SendMessageResult,
  SendTransactionalMessageInput,
  SendVerificationCodeInput,
  SmsHealthCheckResult,
  SmsProvider,
} from './sms-provider.interface.js';
import { SmsRuProviderError } from './sms-ru.errors.js';
import { normalizeSmsRuStatusCode } from './sms-ru.status.js';

interface SmsRuSendResponse {
  status: 'OK' | 'ERROR';
  status_code: number;
  status_text?: string;
  sms?: Record<
    string,
    { status: 'OK' | 'ERROR'; status_code: number; sms_id?: string }
  >;
}

interface SmsRuStatusResponse {
  status: 'OK' | 'ERROR';
  status_code: number;
  status_text?: string;
  sms?: Record<string, { status: 'OK' | 'ERROR'; status_code: number }>;
}

interface SmsRuBalanceResponse {
  status: 'OK' | 'ERROR';
  status_code: number;
  status_text?: string;
  balance?: number;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The only place SMS.RU's HTTP protocol is spoken. AuthService/OtpService
 * never import this class directly — they depend on SmsProvider and the
 * SMS_PROVIDER token; see sms-provider.factory.ts. The API key
 * (`sms.smsRu.apiId`) is embedded only in the query string of a request this
 * class builds and sends itself; it is never included in a thrown error, a
 * log line, or anything returned to a caller.
 */
@Injectable()
export class SmsRuProvider implements SmsProvider {
  readonly name = 'sms-ru';

  private readonly logger = new Logger(SmsRuProvider.name);
  private readonly circuit: CircuitBreaker;
  private readonly apiId: string;
  private readonly apiBaseUrl: string;
  private readonly senderId: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    config: ConfigService,
    overrides?: {
      fetchImpl?: typeof fetch;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.apiId = config.getOrThrow<string>('sms.smsRu.apiId');
    this.apiBaseUrl = config.getOrThrow<string>('sms.smsRu.apiBaseUrl');
    this.senderId = config.get<string>('sms.senderId') ?? '';
    this.timeoutMs = config.getOrThrow<number>('sms.smsRu.timeoutMs');
    this.maxRetries = config.getOrThrow<number>('sms.smsRu.maxRetries');
    this.circuit = new CircuitBreaker({
      failureThreshold: config.getOrThrow<number>(
        'sms.smsRu.circuitFailureThreshold',
      ),
      openMs: config.getOrThrow<number>('sms.smsRu.circuitOpenMs'),
    });
    this.fetchImpl = overrides?.fetchImpl ?? fetch;
    this.sleep = overrides?.sleep ?? DEFAULT_SLEEP;
  }

  async sendVerificationCode(
    input: SendVerificationCodeInput,
  ): Promise<SendMessageResult> {
    return this.send(input.phone, input.message);
  }

  async sendTransactionalMessage(
    input: SendTransactionalMessageInput,
  ): Promise<SendMessageResult> {
    return this.send(input.phone, input.message);
  }

  async getDeliveryStatus(
    providerMessageId: string,
  ): Promise<DeliveryStatusResult> {
    const params: Record<string, string> = {
      api_id: this.apiId,
      id: providerMessageId,
      json: '1',
    };
    const body = await this.requestJson<SmsRuStatusResponse>(
      '/sms/status',
      params,
      { retryable: true },
    );

    if (body.status === 'ERROR') {
      throw SmsRuProviderError.rejected(
        body.status_code,
        body.status_text ?? 'unknown error',
      );
    }

    const entry = body.sms?.[providerMessageId];
    return {
      providerMessageId,
      status: normalizeSmsRuStatusCode(entry?.status_code),
      updatedAt: new Date(),
    };
  }

  async handleStatusWebhook(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<NormalizedWebhookEvent> {
    const rawEventHash = createHash('sha256').update(rawBody).digest('hex');
    const fields = this.parseWebhookBody(rawBody, headers);
    const providerMessageId =
      fields.get('sms_id') ??
      fields.get('id') ??
      fields.get('phone_id') ??
      null;
    const statusCodeRaw = fields.get('status_code');
    const statusCode = statusCodeRaw ? Number(statusCodeRaw) : undefined;

    return {
      providerMessageId,
      status: normalizeSmsRuStatusCode(
        Number.isFinite(statusCode) ? statusCode : undefined,
      ),
      rawEventHash,
      occurredAt: new Date(),
    };
  }

  async healthCheck(): Promise<SmsHealthCheckResult> {
    try {
      await this.requestBalance();
      return { healthy: true };
    } catch (error) {
      return {
        healthy: false,
        detail: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }

  /** Admin-only: the account balance in rubles. Never exposed through healthCheck or any passenger/driver-facing endpoint. */
  async getBalance(): Promise<{ balanceRub: number }> {
    return this.requestBalance();
  }

  private async send(
    phone: string,
    message: string,
  ): Promise<SendMessageResult> {
    const params: Record<string, string> = {
      api_id: this.apiId,
      to: phone,
      msg: message,
      json: '1',
    };
    if (this.senderId) params.from = this.senderId;

    // Sends are never retried: retrying a possibly-already-delivered SMS
    // would risk sending the code twice.
    const body = await this.requestJson<SmsRuSendResponse>(
      '/sms/send',
      params,
      { retryable: false },
    );

    if (body.status === 'ERROR') {
      throw SmsRuProviderError.rejected(
        body.status_code,
        body.status_text ?? 'unknown error',
      );
    }

    const entry = body.sms?.[phone];
    if (!entry || entry.status === 'ERROR') {
      throw SmsRuProviderError.rejected(
        entry?.status_code ?? body.status_code,
        'per-recipient send failed',
      );
    }

    return {
      ...(entry.sms_id ? { providerMessageId: entry.sms_id } : {}),
      status: normalizeSmsRuStatusCode(entry.status_code),
    };
  }

  private async requestBalance(): Promise<{ balanceRub: number }> {
    const params: Record<string, string> = { api_id: this.apiId, json: '1' };
    const body = await this.requestJson<SmsRuBalanceResponse>(
      '/my/balance',
      params,
      { retryable: true },
    );

    if (body.status === 'ERROR' || typeof body.balance !== 'number') {
      throw SmsRuProviderError.rejected(
        body.status_code,
        body.status_text ?? 'balance unavailable',
      );
    }

    return { balanceRub: body.balance };
  }

  private parseWebhookBody(
    rawBody: string,
    headers: Record<string, string>,
  ): Map<string, string> {
    const contentType = (headers['content-type'] ?? '').toLowerCase();
    const fields = new Map<string, string>();

    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(rawBody) as Record<string, unknown>;
        for (const [key, value] of Object.entries(parsed)) {
          fields.set(key, String(value));
        }
        return fields;
      } catch {
        // fall through to form parsing
      }
    }

    for (const [key, value] of new URLSearchParams(rawBody)) {
      fields.set(key, value);
    }
    return fields;
  }

  private async requestJson<T>(
    path: string,
    params: Record<string, string>,
    options: { retryable: boolean },
  ): Promise<T> {
    if (!this.circuit.canRequest()) {
      throw SmsRuProviderError.circuitOpen();
    }

    const retries = options.retryable ? this.maxRetries : 0;
    let attempt = 0;
    for (;;) {
      try {
        const result = await this.attempt<T>(path, params);
        this.circuit.recordSuccess();
        return result;
      } catch (error) {
        const normalized = this.normalize(error);
        const canRetry = normalized.retryable && attempt < retries;
        if (!canRetry) {
          this.circuit.recordFailure();
          throw normalized;
        }
        attempt += 1;
        await this.sleep(100 * 2 ** (attempt - 1));
      }
    }
  }

  private async attempt<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(path, this.apiBaseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });

      if (response.status === 429 || response.status === 503) {
        throw SmsRuProviderError.rateLimited();
      }
      if (response.status >= 500) {
        throw SmsRuProviderError.unavailable(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw SmsRuProviderError.invalidResponse();
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw SmsRuProviderError.invalidResponse();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private normalize(error: unknown): SmsRuProviderError {
    if (error instanceof SmsRuProviderError) return error;
    if (error instanceof Error && error.name === 'AbortError') {
      return SmsRuProviderError.timeout();
    }
    // Deliberately not logging `error` itself: a thrown TypeError from the
    // fetch layer could echo back the request URL, which carries api_id.
    this.logger.warn({ event: 'sms_ru.request_failed', kind: 'network_error' });
    return SmsRuProviderError.unavailable('network error');
  }
}
