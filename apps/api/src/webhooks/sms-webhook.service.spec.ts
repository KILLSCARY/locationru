import { ConfigService } from '@nestjs/config';

import { SmsWebhookService } from './sms-webhook.service.js';
import type { SmsProvider } from '../auth/providers/sms-provider.interface.js';

class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  nextEvent: {
    providerMessageId: string | null;
    status: 'DELIVERED' | 'UNKNOWN';
    rawEventHash: string;
    occurredAt: Date;
  } = {
    providerMessageId: 'msg-1',
    status: 'DELIVERED',
    rawEventHash: 'hash-1',
    occurredAt: new Date(),
  };

  async sendVerificationCode() {
    return { status: 'SENT' as const };
  }
  async sendTransactionalMessage() {
    return { status: 'SENT' as const };
  }
  async getDeliveryStatus() {
    return {
      providerMessageId: 'msg-1',
      status: 'SENT' as const,
      updatedAt: new Date(),
    };
  }
  async handleStatusWebhook() {
    return this.nextEvent;
  }
  async healthCheck() {
    return { healthy: true };
  }
}

class FakePrisma {
  readonly webhookEvents = new Map<string, Record<string, unknown>>();
  readonly otpRequests = new Map<string, Record<string, unknown>>();

  readonly smsWebhookEvent = {
    findUnique: async ({ where }: { where: { rawEventHash: string } }) =>
      this.webhookEvents.get(where.rawEventHash) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.webhookEvents.set(data.rawEventHash as string, data);
      return data;
    },
  };

  readonly otpRequest = {
    updateMany: async ({
      where,
      data,
    }: {
      where: { providerMessageId: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.otpRequests.get(where.providerMessageId);
      if (row) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    },
  };
}

function buildService(overrides?: {
  webhookSecret?: string;
  ipAllowlist?: string[];
}) {
  const config = new ConfigService({
    sms: {
      smsRu: {
        webhookSecret:
          overrides?.webhookSecret ?? 'test-webhook-secret-16chars',
        webhookIpAllowlist: overrides?.ipAllowlist ?? [],
      },
    },
  });
  const prisma = new FakePrisma();
  const smsProvider = new FakeSmsProvider();
  const service = new SmsWebhookService(config, prisma as never, smsProvider);
  return { service, prisma, smsProvider };
}

describe('SmsWebhookService', () => {
  it('processes a valid webhook and records it for idempotency', async () => {
    const { service, prisma } = buildService();
    prisma.otpRequests.set('msg-1', {
      providerMessageId: 'msg-1',
      providerStatus: 'SENT',
    });

    const result = await service.handleSmsRuWebhook({
      token: 'test-webhook-secret-16chars',
      ip: '1.2.3.4',
      rawBody: 'sms_id=msg-1&status_code=102',
      headers: {},
    });

    expect(result).toEqual({ status: 'ok' });
    expect(prisma.webhookEvents.get('hash-1')).toMatchObject({
      provider: 'sms-ru',
      providerMessageId: 'msg-1',
      status: 'DELIVERED',
    });
    expect(prisma.otpRequests.get('msg-1')).toMatchObject({
      providerStatus: 'DELIVERED',
    });
  });

  it('is idempotent — a duplicate delivery is a no-op the second time', async () => {
    const { service, prisma } = buildService();

    await service.handleSmsRuWebhook({
      token: 'test-webhook-secret-16chars',
      ip: '1.2.3.4',
      rawBody: 'sms_id=msg-1&status_code=102',
      headers: {},
    });
    const countAfterFirst = prisma.webhookEvents.size;

    await service.handleSmsRuWebhook({
      token: 'test-webhook-secret-16chars',
      ip: '1.2.3.4',
      rawBody: 'sms_id=msg-1&status_code=102',
      headers: {},
    });

    expect(prisma.webhookEvents.size).toBe(countAfterFirst);
  });

  it('rejects a request with a wrong or missing token', async () => {
    const { service } = buildService();

    await expect(
      service.handleSmsRuWebhook({
        token: 'wrong-token',
        ip: '1.2.3.4',
        rawBody: 'x',
        headers: {},
      }),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_WEBHOOK_TOKEN' },
    });

    await expect(
      service.handleSmsRuWebhook({
        token: undefined,
        ip: '1.2.3.4',
        rawBody: 'x',
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects when no webhook secret is configured at all', async () => {
    const { service } = buildService({ webhookSecret: '' });

    await expect(
      service.handleSmsRuWebhook({
        token: '',
        ip: '1.2.3.4',
        rawBody: 'x',
        headers: {},
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('enforces the IP allowlist only when one is configured', async () => {
    const { service } = buildService({ ipAllowlist: ['9.9.9.9'] });

    await expect(
      service.handleSmsRuWebhook({
        token: 'test-webhook-secret-16chars',
        ip: '1.2.3.4',
        rawBody: 'x',
        headers: {},
      }),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'WEBHOOK_IP_NOT_ALLOWED' },
    });

    await expect(
      service.handleSmsRuWebhook({
        token: 'test-webhook-secret-16chars',
        ip: '9.9.9.9',
        rawBody: 'x',
        headers: {},
      }),
    ).resolves.toEqual({ status: 'ok' });
  });
});
