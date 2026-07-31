import { randomBytes, randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { PushTokenCryptoService } from '../infrastructure/push-token-crypto.service.js';
import {
  DevicePushTokenRepository,
  type RegisterDevicePushTokenInput,
} from './device-push-token.repository.js';

interface FakeDevicePushTokenRow {
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
  readonly rows = new Map<string, FakeDevicePushTokenRow>();

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
    findMany: async ({
      where,
      orderBy,
    }: {
      where: Record<string, unknown>;
      orderBy?: { lastRegisteredAt: 'asc' | 'desc' };
    }) => {
      let results = [...this.rows.values()].filter((row) =>
        Object.entries(where).every(
          ([key, value]) => (row as Record<string, unknown>)[key] === value,
        ),
      );
      if (orderBy?.lastRegisteredAt === 'desc') {
        results = results.sort(
          (a, b) => b.lastRegisteredAt.getTime() - a.lastRegisteredAt.getTime(),
        );
      }
      return results;
    },
    create: async ({ data }: { data: Omit<FakeDevicePushTokenRow, 'id'> }) => {
      const row = { id: randomUUID(), ...data } as FakeDevicePushTokenRow;
      this.rows.set(row.id, row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeDevicePushTokenRow>;
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
      data: Partial<FakeDevicePushTokenRow>;
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
    count: async ({
      where,
    }: {
      where: { userId: string; lastRegisteredAt: { gte: Date } };
    }) => {
      return [...this.rows.values()].filter(
        (row) =>
          row.userId === where.userId &&
          row.lastRegisteredAt.getTime() >=
            where.lastRegisteredAt.gte.getTime(),
      ).length;
    },
  };

  async $transaction<T>(
    callback: (transaction: this) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }
}

function buildRepository() {
  const config = new ConfigService({
    push: {
      tokenEncryptionKey: randomBytes(32).toString('base64'),
      tokenHashSecret: 'test-hash-secret',
    },
  });
  const crypto = new PushTokenCryptoService(config);
  const prisma = new FakePrisma();
  const repository = new DevicePushTokenRepository(prisma as never, crypto);
  return { repository, prisma, crypto };
}

function registrationInput(
  overrides?: Partial<RegisterDevicePushTokenInput>,
): RegisterDevicePushTokenInput {
  return {
    userId: 'user-1',
    deviceSessionId: 'session-1',
    deviceId: 'device-1',
    application: 'PASSENGER' as never,
    platform: 'ANDROID' as never,
    provider: 'FCM' as never,
    environment: 'STAGING' as never,
    rawToken: 'raw-push-token-1',
    notificationsPermission: true,
    ...overrides,
  };
}

describe('DevicePushTokenRepository', () => {
  it('registers a new token as an ACTIVE row with an encrypted token and a stable hash', async () => {
    const { repository, prisma, crypto } = buildRepository();

    const row = await repository.register(registrationInput());

    expect(row.status).toBe('ACTIVE');
    expect(row.encryptedToken).not.toBe('raw-push-token-1');
    expect(crypto.decrypt(row.encryptedToken)).toBe('raw-push-token-1');
    expect(row.tokenHash).toBe(crypto.hash('raw-push-token-1'));
    expect(prisma.rows.size).toBe(1);
  });

  it('re-registering the exact same raw token is idempotent and just refreshes metadata', async () => {
    const { repository, prisma } = buildRepository();
    const first = await repository.register(
      registrationInput({ appVersion: '1.0.0' }),
    );

    const second = await repository.register(
      registrationInput({ appVersion: '1.1.0', deviceSessionId: 'session-2' }),
    );

    expect(second.id).toBe(first.id);
    expect(second.appVersion).toBe('1.1.0');
    expect(second.deviceSessionId).toBe('session-2');
    expect(prisma.rows.size).toBe(1);
  });

  it('registering a new physical token for the same (user, device, application) revokes the old row as TOKEN_REPLACED', async () => {
    const { repository, prisma } = buildRepository();
    const first = await repository.register(
      registrationInput({ rawToken: 'token-v1' }),
    );

    const second = await repository.register(
      registrationInput({ rawToken: 'token-v2' }),
    );

    expect(second.id).not.toBe(first.id);
    const oldRow = prisma.rows.get(first.id)!;
    expect(oldRow.status).toBe('REVOKED');
    expect(oldRow.invalidationReason).toBe('TOKEN_REPLACED');
    expect(second.status).toBe('ACTIVE');
    expect(prisma.rows.size).toBe(2);
  });

  it('does not revoke an existing row belonging to a different application', async () => {
    const { repository } = buildRepository();
    await repository.register(
      registrationInput({
        rawToken: 'passenger-token',
        application: 'PASSENGER' as never,
      }),
    );

    await repository.register(
      registrationInput({
        rawToken: 'driver-token',
        application: 'DRIVER' as never,
        deviceId: 'device-1',
      }),
    );

    const active = await repository.listActiveForUser('user-1');
    expect(active).toHaveLength(2);
    expect(active.every((row) => row.status === 'ACTIVE')).toBe(true);
  });

  it('listActiveTargetsForUser returns correctly decrypted raw tokens', async () => {
    const { repository } = buildRepository();
    await repository.register(
      registrationInput({ rawToken: 'raw-token-for-send' }),
    );

    const targets = await repository.listActiveTargetsForUser(
      'user-1',
      'PASSENGER' as never,
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]!.rawToken).toBe('raw-token-for-send');
    expect(targets[0]!.platform).toBe('ANDROID');
  });

  it('revoke marks a single row REVOKED with the given reason', async () => {
    const { repository, prisma } = buildRepository();
    const row = await repository.register(registrationInput());

    await repository.revoke(row.id, 'USER_LOGOUT');

    const stored = prisma.rows.get(row.id)!;
    expect(stored.status).toBe('REVOKED');
    expect(stored.invalidationReason).toBe('USER_LOGOUT');
    expect(stored.invalidatedAt).not.toBeNull();
  });

  it('revokeBySession revokes only tokens tied to that device session', async () => {
    const { repository } = buildRepository();
    await repository.register(
      registrationInput({ deviceSessionId: 'session-a', deviceId: 'device-a' }),
    );
    await repository.register(
      registrationInput({ deviceSessionId: 'session-b', deviceId: 'device-b' }),
    );

    await repository.revokeBySession('session-a', 'SESSION_LOGOUT');

    const active = await repository.listActiveForUser('user-1');
    expect(active).toHaveLength(1);
    expect(active[0]!.deviceSessionId).toBe('session-b');
  });

  it('revokeAllForUser revokes every active token for that user (logout-all)', async () => {
    const { repository } = buildRepository();
    await repository.register(
      registrationInput({ deviceSessionId: 'session-a', deviceId: 'device-a' }),
    );
    await repository.register(
      registrationInput({ deviceSessionId: 'session-b', deviceId: 'device-b' }),
    );

    await repository.revokeAllForUser('user-1', 'LOGOUT_ALL');

    expect(await repository.listActiveForUser('user-1')).toHaveLength(0);
  });

  it('markInvalid sets INVALID status distinct from REVOKED', async () => {
    const { repository, prisma } = buildRepository();
    const row = await repository.register(registrationInput());

    await repository.markInvalid(row.id, 'PROVIDER_TOKEN_NOT_REGISTERED');

    const stored = prisma.rows.get(row.id)!;
    expect(stored.status).toBe('INVALID');
    expect(stored.invalidationReason).toBe('PROVIDER_TOKEN_NOT_REGISTERED');
  });

  it('countRecentRegistrationsForUser only counts rows within the given window', async () => {
    const { repository, prisma } = buildRepository();
    const row = await repository.register(registrationInput());
    prisma.rows.get(row.id)!.lastRegisteredAt = new Date(Date.now() - 60_000);

    const withinWindow = await repository.countRecentRegistrationsForUser(
      'user-1',
      5 * 60_000,
    );
    const outsideWindow = await repository.countRecentRegistrationsForUser(
      'user-1',
      30_000,
    );

    expect(withinWindow).toBe(1);
    expect(outsideWindow).toBe(0);
  });

  it('findByIdForUser scopes lookup to the owning user', async () => {
    const { repository } = buildRepository();
    const row = await repository.register(registrationInput());

    expect(await repository.findByIdForUser(row.id, 'user-1')).not.toBeNull();
    expect(await repository.findByIdForUser(row.id, 'someone-else')).toBeNull();
  });
});
