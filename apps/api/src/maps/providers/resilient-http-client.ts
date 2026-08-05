import { Logger } from '@nestjs/common';

import { CircuitBreaker } from './circuit-breaker.js';
import { MapsProviderError } from './maps-provider.errors.js';

export interface ResilientHttpOptions {
  provider: string;
  timeoutMs: number;
  maxRetries: number;
  userAgent: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable no-op-able backoff sleeper for tests. */
  sleep?: (ms: number) => Promise<void>;
  circuit?: CircuitBreaker;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * HTTP helper with timeout, bounded retries with backoff, rate-limit and
 * circuit-breaker handling, and normalized errors. Retries are only ever
 * applied to idempotent GET requests, so a non-idempotent write is never
 * silently duplicated.
 */
export class ResilientHttpClient {
  private readonly logger = new Logger(ResilientHttpClient.name);
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly circuit: CircuitBreaker;

  constructor(private readonly options: ResilientHttpOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? DEFAULT_SLEEP;
    this.circuit =
      options.circuit ??
      new CircuitBreaker({ failureThreshold: 5, openMs: 30_000 });
  }

  async getJson<T>(url: string): Promise<T> {
    return this.requestJson<T>(url, { method: 'GET' }, this.options.maxRetries);
  }

  async postJson<T>(url: string, body: unknown): Promise<T> {
    // Writes are not retried to avoid duplicating a non-idempotent operation.
    return this.requestJson<T>(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      0,
    );
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit,
    retries: number,
  ): Promise<T> {
    if (!this.circuit.canRequest()) {
      throw MapsProviderError.circuitOpen(this.options.provider);
    }

    let attempt = 0;
    // Total tries = retries + 1.
    for (;;) {
      try {
        const result = await this.attempt<T>(url, init);
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
        // Exponential backoff: 100ms, 200ms, 400ms, …
        await this.sleep(100 * 2 ** (attempt - 1));
      }
    }
  }

  private async attempt<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': this.options.userAgent,
          ...(init.headers ?? {}),
        },
      });

      if (response.status === 429 || response.status === 503) {
        throw MapsProviderError.rateLimited(this.options.provider);
      }
      if (response.status >= 500) {
        throw MapsProviderError.unavailable(
          this.options.provider,
          `HTTP ${response.status}`,
        );
      }
      if (!response.ok) {
        // 4xx (other than 429): a client/config error, not retryable.
        throw MapsProviderError.invalidResponse(this.options.provider);
      }

      try {
        return (await response.json()) as T;
      } catch {
        throw MapsProviderError.invalidResponse(this.options.provider);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private normalize(error: unknown): MapsProviderError {
    if (error instanceof MapsProviderError) {
      return error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return MapsProviderError.timeout(this.options.provider);
    }
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.warn({
      event: 'maps.http_error',
      provider: this.options.provider,
      detail,
    });
    return MapsProviderError.unavailable(this.options.provider, detail);
  }
}
