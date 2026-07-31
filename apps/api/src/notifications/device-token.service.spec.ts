import { randomBytes } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { DeviceTokenService } from './device-token.service.js';
import { PushTokenCryptoService } from './infrastructure/push-token-crypto.service.js';
import { DevicePushTokenRepository } from './repositories/device-push-token.repository.js';

interface FakeRow {
  id: string;
  userId: string;
  deviceSessionId: string;
  deviceId: string;
  application: string;
  platform: string;
  provider: string;
  environment: string;
  encryptedToken: string;
  tokenHash: string;
  status: string;
  appVersion: string | null;
  osVersion: string | null;
  locale: string | null;
  notificationsPermission: boolean;
  lastRegisteredAt: Date;
  lastUsedAt: Date | null;
  invalidatedAt: Date | null;
  invalidationReason: string | null;
}

class FakePrisma {
  readonly rows = new Map<string, FakeRow>();
  private nextId = 1;

  readonly devicePushToken = {
    findUnique: async ({ where }: { where: { tokenHash: string } }) => {
      for (const row of this.rows.values()) {
        if (row.tokenHash === where.tokenHash) return row;
      }
      return null;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      for (const row of this.rows.values()) {
        if (
          Object.entries(where).every(
            ([key, value]) => (row as Record<string, unknown>)[key] === value,
          )
        ) {
          return row;
        }
      }
      return null;
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      return [...this.rows.values()].filter((row) =>
        Object.entries(where).every(
          ([key, value]) => (row as Record<string, unknown>)[key] === value,
        ),
      );
    },
    create: async ({ data }: { data: Omit<FakeRow, 'id'> }) => {
      const row = { id: `row-${this.nextId++}`, ...data } as FakeRow;
      this.rows.set(row.id, row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeRow>;
    }) => {
      const row = this.rows.get(where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<FakeRow>;
    }) => {
      let count = 0;
      for (const row of this.rows.values()) {
        if (
          Object.entries(where).every(
            ([key, value]) => (row as Record<string, unknown>)[key] === value,
          )
        ) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };

  async $transaction<T>(callback: (transaction: this) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

function buildService(overrides?: {
  appEnvironment?: string;
  pushProvider?: string;
}) {
  const config = new ConfigService({
    app: { appEnvironment: overrides?.appEnvironment ?? 'test' },
    push: {
      tokenEncryptionKey: randomBytes(32).toString('base64'),
      tokenHashSecret: 'test-hash-secret',
      provider: overrides?.pushProvider ?? 'staging',
    },
  });
  const crypto = new PushTokenCryptoService(config);
  const prisma = new FakePrisma();
  const repository = new DevicePushTokenRepository(prisma as never, crypto);
  const service = new DeviceTokenService(config, repository);
  return { service, repository, prisma };
}

const validToken = 'a'.repeat(64);

describe('DeviceTokenService', () => {
  it('registers a device and returns a DTO with no raw token, encrypted token, or hash', async () => {
    const { service } = buildService();

    const result = await service.registerDevice({
      userId: 'user-1',
      deviceSessionId: 'session-1',
      deviceId: 'device-1',
      application: 'PASSENGER' as never,
      platform: 'ANDROID' as never,
      rawToken: validToken,
      notificationsPermission: true,
    });

    expect(result.id).toBeTruthy();
    expect(result.application).toBe('PASSENGER');
    expect(result.status).toBe('ACTIVE');
    expect(JSON.stringify(result)).not.toContain(validToken);
    expect(Object.keys(result)).not.toContain('encryptedToken');
    expect(Object.keys(result)).not.toContain('tokenHash');
  });

  it('derives environment server-side rather than trusting any client input', async () => {
    const { service, prisma } = buildService({ appEnvironment: 'staging' });

    const result = await service.registerDevice({
      userId: 'user-1',
      deviceSessionId: 'session-1',
      deviceId: 'device-1',
      application: 'DRIVER' as never,
      platform: 'ANDROID' as never,
      rawToken: validToken,
      notificationsPermission: true,
    });

    const stored = prisma.rows.get(result.id)!;
    expect(stored.environment).toBe('STAGING');
    expect(stored.provider).toBe('STAGING');
  });

  it('rejects a token that is too short', async () => {
    const { service } = buildService();

    await expect(
      service.registerDevice({
        userId: 'user-1',
        deviceSessionId: 'session-1',
        deviceId: 'device-1',
        application: 'PASSENGER' as never,
        platform: 'ANDROID' as never,
        rawToken: 'too-short',
        notificationsPermission: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_PUSH_TOKEN_FORMAT' },
    });
  });

  it('rejects a token containing whitespace', async () => {
    const { service } = buildService();

    await expect(
      service.registerDevice({
        userId: 'user-1',
        deviceSessionId: 'session-1',
        deviceId: 'device-1',
        application: 'PASSENGER' as never,
        platform: 'ANDROID' as never,
        rawToken: `${validToken} with spaces`,
        notificationsPermission: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_PUSH_TOKEN_FORMAT' },
    });
  });

  it('refreshDevice replaces the prior token for the same device (not a duplicate row)', async () => {
    const { service, prisma } = buildService();
    const first = await service.registerDevice({
      userId: 'user-1',
      deviceSessionId: 'session-1',
      deviceId: 'device-1',
      application: 'PASSENGER' as never,
      platform: 'ANDROID' as never,
      rawToken: validToken,
      notificationsPermission: true,
    });

    const second = await service.refreshDevice({
      userId: 'user-1',
      deviceSessionId: 'session-1',
      deviceId: 'device-1',
      application: 'PASSENGER' as never,
      platform: 'ANDROID' as never,
      rawToken: 'b'.repeat(64),
      notificationsPermission: true,
    });

    expect(second.id).not.toBe(first.id);
    expect(prisma.rows.get(first.id)!.status).toBe('REVOKED');
    expect(prisma.rows.size).toBe(2);
  });

  it('revokeDevice revokes only when the token belongs to the requesting user', async () => {
    const { service } = buildService();
    const registered = await service.registerDevice({
      userId: 'user-1',
      deviceSessionId: 'session-1',
      deviceId: 'device-1',
      application: 'PASSENGER' as never,
      platform: 'ANDROID' as never,
      rawToken: validToken,
      notificationsPermission: true,
    });

    await expect(
      service.revokeDevice('someone-else', registered.id),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_TOKEN_NOT_FOUND' } });

    await expect(
      service.revokeDevice('user-1', registered.id),
    ).resolves.toBeUndefined();

    expect(await service.listDevices('user-1')).toHaveLength(0);
  });

  it('listDevices returns only active devices for that user, with no sensitive fields', async () => {
    const { service } = buildService();
    await service.registerDevice({
      userId: 'user-1',
      deviceSessionId: 'session-1',
      deviceId: 'device-1',
      application: 'PASSENGER' as never,
      platform: 'ANDROID' as never,
      rawToken: validToken,
      notificationsPermission: true,
    });

    const devices = await service.listDevices('user-1');

    expect(devices).toHaveLength(1);
    expect(JSON.stringify(devices)).not.toContain(validToken);
  });

  it('production always uses a real, platform-routed provider regardless of PUSH_PROVIDER', async () => {
    const { service, prisma } = buildService({
      appEnvironment: 'production',
      pushProvider: 'staging',
    });

    const result = await service.registerDevice({
      userId: 'user-1',
      deviceSessionId: 'session-1',
      deviceId: 'device-1',
      application: 'PASSENGER' as never,
      platform: 'IOS' as never,
      rawToken: validToken,
      notificationsPermission: true,
    });

    expect(prisma.rows.get(result.id)!.provider).toBe('APNS');
    expect(prisma.rows.get(result.id)!.environment).toBe('PRODUCTION');
  });
});
