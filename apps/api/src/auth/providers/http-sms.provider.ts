import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { SmsProvider } from './sms-provider.interface.js';

/**
 * Production-facing SMS provider scaffold.
 *
 * The transport (base URL, API key, sender, timeout) is wired here.
 * {@link HttpSmsProvider.sendCode} intentionally throws
 * {@link NotImplementedException} until a concrete SMS gateway is plugged into
 * {@link HttpSmsProvider.request}. This keeps production from silently dropping
 * one-time codes before the integration exists.
 */
@Injectable()
export class HttpSmsProvider implements SmsProvider {
  private readonly logger = new Logger(HttpSmsProvider.name);
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly sender: string;
  private readonly requestTimeoutMs: number;

  constructor(config: ConfigService) {
    this.apiBaseUrl = config.getOrThrow<string>('sms.apiBaseUrl');
    this.apiKey = config.getOrThrow<string>('sms.apiKey');
    this.sender = config.getOrThrow<string>('sms.sender');
    this.requestTimeoutMs = config.getOrThrow<number>('sms.requestTimeoutMs');
  }

  async sendCode(phone: string, code: string): Promise<void> {
    void phone;
    void code;
    throw new NotImplementedException({
      code: 'SMS_PROVIDER_NOT_IMPLEMENTED',
      message: 'HttpSmsProvider.sendCode is not wired to a gateway yet',
    });
  }

  /**
   * Authenticated JSON request against the SMS gateway. A concrete `sendCode`
   * implementation builds on this helper once the gateway is chosen.
   */
  protected async request<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(new URL(path, this.apiBaseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text();
        this.logger.error(
          `SMS gateway POST ${path} failed: ${response.status} ${detail}`,
        );
        throw new Error(`SMS gateway responded with ${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  protected get from(): string {
    return this.sender;
  }
}
