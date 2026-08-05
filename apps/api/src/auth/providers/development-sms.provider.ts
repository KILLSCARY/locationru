import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import type {
  DeliveryStatusResult,
  NormalizedWebhookEvent,
  SendMessageResult,
  SendTransactionalMessageInput,
  SendVerificationCodeInput,
  SmsHealthCheckResult,
  SmsProvider,
} from './sms-provider.interface.js';

@Injectable()
export class DevelopmentSmsProvider implements SmsProvider {
  readonly name = 'development';
  private readonly environment: AppEnvironment;
  private readonly logger = new Logger(DevelopmentSmsProvider.name);

  constructor(configService: ConfigService) {
    this.environment =
      configService.getOrThrow<AppEnvironment>('app.appEnvironment');

    if (
      this.environment === AppEnvironment.STAGING ||
      this.environment === AppEnvironment.PRODUCTION
    ) {
      throw new Error(
        'DevelopmentSmsProvider must not be used in staging or production',
      );
    }
  }

  async sendVerificationCode(
    input: SendVerificationCodeInput,
  ): Promise<SendMessageResult> {
    if (this.environment === AppEnvironment.DEVELOPMENT) {
      this.logger.log({
        event: 'auth.development_otp',
        phone: input.phone,
        message: input.message,
        channel: input.channel,
      });
    }

    await Promise.resolve();
    return { status: 'DELIVERED' };
  }

  async sendTransactionalMessage(
    input: SendTransactionalMessageInput,
  ): Promise<SendMessageResult> {
    if (this.environment === AppEnvironment.DEVELOPMENT) {
      this.logger.log({
        event: 'auth.development_transactional_sms',
        phone: input.phone,
        message: input.message,
      });
    }

    await Promise.resolve();
    return { status: 'DELIVERED' };
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
    await Promise.resolve();
    return { healthy: true };
  }
}
