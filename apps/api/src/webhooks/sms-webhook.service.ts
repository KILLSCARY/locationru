import { timingSafeEqual } from 'node:crypto';

import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import {
  SMS_PROVIDER,
  type SmsProvider,
} from '../auth/providers/sms-provider.interface.js';

export interface SmsRuWebhookInput {
  /** Shared secret from the callback URL's ?token= query param — the primary authenticity guard, since SMS.RU does not sign its status callbacks. */
  token: string | undefined;
  /** Never the sole guard — only enforced when SMS_RU_WEBHOOK_IP_ALLOWLIST is non-empty. */
  ip: string;
  rawBody: string;
  headers: Record<string, string>;
}

/**
 * Receives SMS.RU delivery-status callbacks. No JWT — a webhook has no user
 * session to present a bearer token for; authenticity instead comes from a
 * shared secret embedded in the callback URL registered in the SMS.RU
 * cabinet. Idempotent via the unique SmsWebhookEvent.rawEventHash, so a
 * retried delivery from SMS.RU is a no-op rather than double-processing.
 * See docs/auth/sms-ru-webhook.md.
 */
@Injectable()
export class SmsWebhookService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async handleSmsRuWebhook(
    input: SmsRuWebhookInput,
  ): Promise<{ status: 'ok' }> {
    this.assertAuthentic(input.token, input.ip);

    const event = await this.smsProvider.handleStatusWebhook(
      input.rawBody,
      input.headers,
    );

    const existing = await this.prisma.smsWebhookEvent.findUnique({
      where: { rawEventHash: event.rawEventHash },
    });
    if (existing) {
      this.metrics?.increment(
        'auth_sms_webhook_events_total',
        'SMS.RU webhook deliveries by status and duplicate flag',
        { status: event.status, duplicate: 'true' },
      );
      return { status: 'ok' };
    }

    await this.prisma.smsWebhookEvent.create({
      data: {
        provider: 'sms-ru',
        rawEventHash: event.rawEventHash,
        ...(event.providerMessageId
          ? { providerMessageId: event.providerMessageId }
          : {}),
        status: event.status,
        processedAt: new Date(),
      },
    });
    this.metrics?.increment(
      'auth_sms_webhook_events_total',
      'SMS.RU webhook deliveries by status and duplicate flag',
      { status: event.status, duplicate: 'false' },
    );

    if (event.providerMessageId) {
      await this.prisma.otpRequest.updateMany({
        where: { providerMessageId: event.providerMessageId },
        data: { providerStatus: event.status },
      });
    }

    return { status: 'ok' };
  }

  private assertAuthentic(token: string | undefined, ip: string): void {
    const expectedSecret = this.configService.get<string>(
      'sms.smsRu.webhookSecret',
    );
    if (
      !expectedSecret ||
      !this.timingSafeEqualString(token ?? '', expectedSecret)
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_WEBHOOK_TOKEN',
        message: 'Invalid webhook token',
      });
    }

    const allowlist = this.configService.get<string[]>(
      'sms.smsRu.webhookIpAllowlist',
    );
    if (allowlist && allowlist.length > 0 && !allowlist.includes(ip)) {
      throw new ForbiddenException({
        code: 'WEBHOOK_IP_NOT_ALLOWED',
        message: 'Source IP is not on the webhook allowlist',
      });
    }
  }

  private timingSafeEqualString(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }
}
