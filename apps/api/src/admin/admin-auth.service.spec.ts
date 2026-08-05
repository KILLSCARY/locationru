import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { OtpService } from '../auth/otp.service.js';
import { PhoneNormalizer } from '../auth/phone-normalizer.service.js';
import type { SmsProvider } from '../auth/providers/sms-provider.interface.js';
import { SmsTemplateService } from '../auth/sms-template.service.js';
import { AdminAuthService } from './admin-auth.service.js';

interface FakeBlockRow {
  id: string;
  phoneHash?: string;
  deviceId?: string;
  reason: string;
  createdByAdminId?: string;
  blockedAt: Date;
  expiresAt: Date | null;
  unblockedAt: Date | null;
  unblockedByAdminId?: string;
}

class FakePrisma {
  readonly blocks = new Map<string, FakeBlockRow>();
  readonly securityEvents: Array<Record<string, unknown>> = [];
  readonly auditLogs: Array<Record<string, unknown>> = [];

  readonly authBlock = {
    create: async ({ data }: { data: Partial<FakeBlockRow> }) => {
      const row: FakeBlockRow = {
        id: randomUUID(),
        reason: data.reason!,
        blockedAt: new Date(),
        expiresAt: data.expiresAt ?? null,
        unblockedAt: null,
        ...data,
      };
      this.blocks.set(row.id, row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeBlockRow>;
    }) => {
      const row = this.blocks.get(where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.blocks.get(where.id) ?? null,
    findMany: async () => [...this.blocks.values()],
    count: async () => this.blocks.size,
  };

  readonly securityEvent = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.securityEvents.push(data);
      return data;
    },
    findMany: async () => this.securityEvents,
    count: async () => this.securityEvents.length,
  };

  readonly adminAuditLog = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.auditLogs.push(data);
      return data;
    },
  };

  async $transaction<T>(fn: (tx: this) => Promise<T> | T[] | Promise<T[]>) {
    if (typeof fn === 'function') return fn(this);
    return fn;
  }
}

class FakeRedis {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async setWithTtl(key: string, value: string) {
    this.values.set(key, value);
  }
  async setPersistent(key: string, value: string) {
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
  async checkConnection() {}
}

function buildService(smsProvider?: Partial<SmsProvider> & { name: string }) {
  const config = new ConfigService({
    auth: {
      otpHashSecret: 'test-otp-hash-secret-that-is-at-least-32-characters',
    },
    otp: {
      smsCodeLength: 6,
      ttlSeconds: 300,
      maxAttempts: 5,
      resendInitialSeconds: 60,
      blockSeconds: 900,
    },
  });
  const prisma = new FakePrisma();
  const redis = new FakeRedis();
  const otpService = new OtpService(
    config,
    prisma as never,
    redis as never,
    new SmsTemplateService(),
    (smsProvider ?? { name: 'fake' }) as SmsProvider,
  );
  const service = new AdminAuthService(
    prisma as never,
    otpService,
    new PhoneNormalizer(),
    (smsProvider ?? { name: 'fake' }) as SmsProvider,
  );
  return { service, prisma, redis };
}

describe('AdminAuthService', () => {
  it('creates a phone block, records a security event and audit log, and sets the Redis enforcement key', async () => {
    const { service, prisma, redis } = buildService();

    const block = await service.createBlock('admin-1', {
      phone: '+79995551234',
      reason: 'manual review',
      expiresInSeconds: 3600,
    });

    expect(block.phoneHash).toBeTruthy();
    expect(prisma.securityEvents).toHaveLength(1);
    expect(prisma.securityEvents[0]).toMatchObject({ type: 'PHONE_BLOCKED' });
    expect(prisma.auditLogs).toHaveLength(1);
    expect(prisma.auditLogs[0]).toMatchObject({ action: 'AUTH_BLOCK_CREATED' });
    expect(redis.values.get(`otp:block:LOGIN:${block.phoneHash}`)).toBe(
      'ADMIN_BLOCK',
    );
  });

  it('creates a device block without touching Redis (no live device-block cache today)', async () => {
    const { service, prisma, redis } = buildService();

    const block = await service.createBlock('admin-1', {
      deviceId: 'device-xyz',
      reason: 'suspicious activity',
    });

    expect(block.deviceId).toBe('device-xyz');
    expect(prisma.securityEvents[0]).toMatchObject({ type: 'DEVICE_BLOCKED' });
    expect(redis.values.size).toBe(0);
  });

  it('unblock lifts a block, is idempotent-safe (rejects a second unblock), and clears the Redis key', async () => {
    const { service, redis } = buildService();
    const block = await service.createBlock('admin-1', {
      phone: '+79995551234',
      reason: 'manual review',
    });

    const result = await service.unblock('admin-2', block.id);
    expect(result.unblockedAt).toBeInstanceOf(Date);
    expect(redis.values.has(`otp:block:LOGIN:${block.phoneHash}`)).toBe(false);

    await expect(service.unblock('admin-2', block.id)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('unblock 404s for an unknown block id', async () => {
    const { service } = buildService();
    await expect(
      service.unblock('admin-1', randomUUID()),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('getSmsBalance succeeds when the active provider supports it', async () => {
    const { service } = buildService({
      name: 'sms-ru',
      getBalance: async () => ({ balanceRub: 42 }),
    } as never);

    await expect(service.getSmsBalance()).resolves.toEqual({ balanceRub: 42 });
  });

  it('getSmsBalance is unavailable when the active provider does not support it', async () => {
    const { service } = buildService({ name: 'development' } as never);

    await expect(service.getSmsBalance()).rejects.toMatchObject({
      status: 503,
      response: { code: 'BALANCE_CHECK_UNAVAILABLE' },
    });
  });
});
