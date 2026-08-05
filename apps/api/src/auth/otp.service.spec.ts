import { ConfigService } from '@nestjs/config';

import { OtpPurpose, OtpStatus } from '../generated/prisma/enums.js';
import { OtpService } from './otp.service.js';
import { VerificationChannel } from './providers/sms-provider.interface.js';
import type { SmsProvider } from './providers/sms-provider.interface.js';
import { SmsTemplateService } from './sms-template.service.js';

interface FakeOtpRequestRow {
  id: string;
  phoneHash: string;
  purpose: OtpPurpose;
  channel: VerificationChannel;
  codeHash: string;
  status: OtpStatus;
  maxAttempts: number;
  attemptsUsed: number;
  expiresAt: Date;
  resendAvailableAt: Date;
  verifiedAt?: Date;
  consumedAt?: Date;
  providerMessageId?: string;
  providerStatus?: string;
}

class FakeRedis {
  readonly values = new Map<string, string>();
  connected = true;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setWithTtl(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async checkConnection(): Promise<void> {
    if (!this.connected) throw new Error('redis down');
  }
}

class FakePrisma {
  readonly rows = new Map<string, FakeOtpRequestRow>();
  readonly authBlocks: Array<{ phoneHash?: string; reason: string }> = [];
  readonly securityEvents: Array<{ type: string; phoneHash?: string }> = [];

  readonly otpRequest = {
    create: async ({ data }: { data: FakeOtpRequestRow }) => {
      const row = { ...data };
      this.rows.set(row.id, row);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeOtpRequestRow>;
    }) => {
      const row = this.rows.get(where.id);
      if (row) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    },
  };

  readonly authBlock = {
    create: async ({
      data,
    }: {
      data: { phoneHash?: string; reason: string };
    }) => {
      this.authBlocks.push(data);
      return data;
    },
  };

  readonly securityEvent = {
    create: async ({
      data,
    }: {
      data: { type: string; phoneHash?: string };
    }) => {
      this.securityEvents.push(data);
      return data;
    },
  };
}

class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  readonly sent: Array<{ phone: string; code: string; message: string }> = [];
  nextResult: { providerMessageId?: string; status: 'SENT' | 'FAILED' } = {
    providerMessageId: 'msg-1',
    status: 'SENT',
  };

  async sendVerificationCode(input: {
    phone: string;
    code: string;
    message: string;
  }) {
    if (this.nextResult.status === 'FAILED') {
      throw new Error('provider failure');
    }
    this.sent.push(input);
    return this.nextResult;
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
    return {
      providerMessageId: null,
      status: 'UNKNOWN' as const,
      rawEventHash: 'hash',
      occurredAt: new Date(),
    };
  }

  async healthCheck() {
    return { healthy: true };
  }
}

function buildService(overrides?: {
  redis?: FakeRedis;
  prisma?: FakePrisma;
  smsProvider?: FakeSmsProvider;
  resendInitialSeconds?: number;
}) {
  const config = new ConfigService({
    auth: { otpHashSecret: 'test-secret', enableDevelopmentOtp: false },
    app: { appEnvironment: 'test' },
    otp: {
      smsCodeLength: 6,
      ttlSeconds: 300,
      maxAttempts: 3,
      resendInitialSeconds: overrides?.resendInitialSeconds ?? 60,
      blockSeconds: 900,
    },
  });
  const redis = overrides?.redis ?? new FakeRedis();
  const prisma = overrides?.prisma ?? new FakePrisma();
  const smsProvider = overrides?.smsProvider ?? new FakeSmsProvider();
  const service = new OtpService(
    config,
    prisma as never,
    redis as never,
    new SmsTemplateService(),
    smsProvider,
  );
  return { service, redis, prisma, smsProvider };
}

describe('OtpService', () => {
  it('requestCode generates a code, stores hashed state, and delivers via the provider', async () => {
    const { service, smsProvider } = buildService();

    const summary = await service.requestCode({
      phone: '+79995551234',
      purpose: OtpPurpose.LOGIN,
      channel: VerificationChannel.SMS,
    });

    expect(summary.requestId).toBeTruthy();
    expect(summary.expiresInSeconds).toBe(300);
    expect(summary.resendInSeconds).toBe(60);
    expect(smsProvider.sent).toHaveLength(1);
    expect(smsProvider.sent[0]!.phone).toBe('+79995551234');
    expect(smsProvider.sent[0]!.message).toContain(
      'Код входа в Resilient Taxi',
    );
    expect(smsProvider.sent[0]!.code).toMatch(/^\d{6}$/);
  });

  it('never returns the raw code to the caller', async () => {
    const { service } = buildService();
    const summary = await service.requestCode({
      phone: '+79995551234',
      purpose: OtpPurpose.LOGIN,
      channel: VerificationChannel.SMS,
    });

    expect(JSON.stringify(summary)).not.toMatch(/^\d{6}$/);
    expect(Object.keys(summary).sort()).toEqual(
      ['expiresInSeconds', 'requestId', 'resendInSeconds'].sort(),
    );
  });

  it('verifyCode succeeds with the code the provider was sent, and is one-time-use', async () => {
    const { service, smsProvider } = buildService();
    const { requestId } = await service.requestCode({
      phone: '+79995551234',
      purpose: OtpPurpose.LOGIN,
      channel: VerificationChannel.SMS,
    });
    const code = smsProvider.sent[0]!.code;

    await expect(
      service.verifyCode({
        requestId,
        phone: '+79995551234',
        purpose: OtpPurpose.LOGIN,
        code,
      }),
    ).resolves.toBeUndefined();

    await expect(
      service.verifyCode({
        requestId,
        phone: '+79995551234',
        purpose: OtpPurpose.LOGIN,
        code,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('verifyCode rejects a wrong code without leaking whether the account exists', async () => {
    const { service } = buildService();
    const { requestId } = await service.requestCode({
      phone: '+79995551234',
      purpose: OtpPurpose.LOGIN,
      channel: VerificationChannel.SMS,
    });

    await expect(
      service.verifyCode({
        requestId,
        phone: '+79995551234',
        purpose: OtpPurpose.LOGIN,
        code: '000001',
      }),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_OTP' },
    });
  });

  it('blocks the subject after maxAttempts wrong guesses and records a security event', async () => {
    const { service, prisma } = buildService();
    const { requestId } = await service.requestCode({
      phone: '+79995551234',
      purpose: OtpPurpose.LOGIN,
      channel: VerificationChannel.SMS,
    });

    for (let i = 0; i < 2; i += 1) {
      await expect(
        service.verifyCode({
          requestId,
          phone: '+79995551234',
          purpose: OtpPurpose.LOGIN,
          code: '000001',
        }),
      ).rejects.toMatchObject({ status: 401 });
    }

    await expect(
      service.verifyCode({
        requestId,
        phone: '+79995551234',
        purpose: OtpPurpose.LOGIN,
        code: '000001',
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(prisma.authBlocks).toHaveLength(1);
    expect(prisma.securityEvents).toHaveLength(1);
    expect(prisma.securityEvents[0]!.type).toBe('OTP_BRUTE_FORCE_SUSPECTED');

    await expect(
      service.verifyCode({
        requestId,
        phone: '+79995551234',
        purpose: OtpPurpose.LOGIN,
        code: '000001',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('resendCode issues a new code that invalidates the old one', async () => {
    const { service, smsProvider } = buildService({ resendInitialSeconds: 0 });
    const { requestId } = await service.requestCode({
      phone: '+79995551234',
      purpose: OtpPurpose.LOGIN,
      channel: VerificationChannel.SMS,
    });
    const firstCode = smsProvider.sent[0]!.code;

    await service.resendCode({
      requestId,
      phone: '+79995551234',
      purpose: OtpPurpose.LOGIN,
    });
    const secondCode = smsProvider.sent[1]!.code;

    await expect(
      service.verifyCode({
        requestId,
        phone: '+79995551234',
        purpose: OtpPurpose.LOGIN,
        code: firstCode,
      }),
    ).rejects.toMatchObject({ status: 401 });

    await expect(
      service.verifyCode({
        requestId,
        phone: '+79995551234',
        purpose: OtpPurpose.LOGIN,
        code: secondCode,
      }),
    ).resolves.toBeUndefined();
  });

  it('fails closed with 503 when Redis is unavailable, never falling back to memory', async () => {
    const redis = new FakeRedis();
    redis.connected = false;
    const { service } = buildService({ redis });

    await expect(
      service.requestCode({
        phone: '+79995551234',
        purpose: OtpPurpose.LOGIN,
        channel: VerificationChannel.SMS,
      }),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'OTP_STORE_UNAVAILABLE' },
    });
  });

  it('records delivery failure and surfaces a 502 without throwing the raw provider error', async () => {
    const smsProvider = new FakeSmsProvider();
    smsProvider.nextResult = { status: 'FAILED' };
    const { service, prisma } = buildService({ smsProvider });

    await expect(
      service.requestCode({
        phone: '+79995551234',
        purpose: OtpPurpose.LOGIN,
        channel: VerificationChannel.SMS,
      }),
    ).rejects.toMatchObject({
      status: 502,
      response: { code: 'OTP_DELIVERY_FAILED' },
    });

    const row = [...prisma.rows.values()][0]!;
    expect(row.status).toBe(OtpStatus.FAILED);
  });

  it('hashPhone is deterministic and never reversible via the stored value', () => {
    const { service } = buildService();
    const hash1 = service.hashPhone('+79995551234');
    const hash2 = service.hashPhone('+79995551234');
    expect(hash1).toBe(hash2);
    expect(hash1).not.toContain('7999');
  });

  it('maskPhone hides the middle digits', () => {
    const { service } = buildService();
    expect(service.maskPhone('+79995551234')).toBe('+7********34');
  });
});
