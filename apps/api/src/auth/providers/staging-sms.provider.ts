import { createHash, randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import { RedisService } from '../../redis/redis.service.js';
import type {
  DeliveryStatusResult,
  NormalizedWebhookEvent,
  SendMessageResult,
  SendTransactionalMessageInput,
  SendVerificationCodeInput,
  SmsHealthCheckResult,
  SmsProvider,
} from './sms-provider.interface.js';

/** Redis key holding the plaintext OTP for the staging admin viewer tool. */
export function stagingOtpLookupKey(phone: string): string {
  return `staging:otp-lookup:${phone}`;
}

/**
 * Never sends a real SMS and never logs the OTP anywhere. Instead it stores
 * the plaintext code in a short-lived, admin-only Redis key so a
 * SUPER_ADMIN can retrieve it through
 * `GET /api/v1/admin/staging/otp/:phone` (StagingToolsController) — a fixed
 * bypass code is never used, and this key is separate from OtpService's own
 * hashed active-code state; this one exists solely for the staging viewing
 * tool and shares the OTP's own TTL.
 */
@Injectable()
export class StagingSmsProvider implements SmsProvider {
  readonly name = 'staging';
  private readonly logger = new Logger(StagingSmsProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    const environment =
      this.config.getOrThrow<AppEnvironment>('app.appEnvironment');
    if (environment === AppEnvironment.PRODUCTION) {
      throw new Error('StagingSmsProvider must not be used in production');
    }
  }

  async sendVerificationCode(
    input: SendVerificationCodeInput,
  ): Promise<SendMessageResult> {
    const ttlSeconds = this.config.getOrThrow<number>('otp.ttlSeconds');
    await this.redis.setWithTtl(
      stagingOtpLookupKey(input.phone),
      input.code,
      ttlSeconds,
    );
    this.logger.log({
      event: 'auth.staging_otp_stored',
      phone: input.phone,
      // Deliberately no `code`/`message` field — see the class doc comment.
    });

    return { providerMessageId: randomUUID(), status: 'DELIVERED' };
  }

  async sendTransactionalMessage(
    input: SendTransactionalMessageInput,
  ): Promise<SendMessageResult> {
    this.logger.log({
      event: 'auth.staging_transactional_sms',
      phone: input.phone,
    });
    return { providerMessageId: randomUUID(), status: 'DELIVERED' };
  }

  async getDeliveryStatus(
    providerMessageId: string,
  ): Promise<DeliveryStatusResult> {
    await Promise.resolve();
    return { providerMessageId, status: 'DELIVERED', updatedAt: new Date() };
  }

  async handleStatusWebhook(rawBody: string): Promise<NormalizedWebhookEvent> {
    await Promise.resolve();
    return {
      providerMessageId: null,
      status: 'DELIVERED',
      rawEventHash: createHash('sha256').update(rawBody).digest('hex'),
      occurredAt: new Date(),
    };
  }

  async healthCheck(): Promise<SmsHealthCheckResult> {
    await this.redis.checkConnection();
    return { healthy: true };
  }
}
