import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';
import type {
  PushApplication,
  PushEnvironment,
  PushPlatform,
  PushProviderType,
} from '../../generated/prisma/enums.js';
import { PushTokenCryptoService } from '../infrastructure/push-token-crypto.service.js';

export interface RegisterDevicePushTokenInput {
  userId: string;
  deviceSessionId: string;
  deviceId: string;
  application: PushApplication;
  platform: PushPlatform;
  provider: PushProviderType;
  environment: PushEnvironment;
  rawToken: string;
  appVersion?: string;
  osVersion?: string;
  locale?: string;
  notificationsPermission: boolean;
}

export interface ActivePushTarget {
  devicePushTokenId: string;
  rawToken: string;
  platform: PushPlatform;
  provider: PushProviderType;
}

/**
 * Owns every read/write against DevicePushToken. Never returns a raw token
 * to a caller outside this module except via `decryptForSend` (used only by
 * the delivery path right before an actual send) — everything else works
 * with `tokenHash`/row ids, never the token itself.
 */
@Injectable()
export class DevicePushTokenRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PushTokenCryptoService,
  ) {}

  /**
   * Idempotent: re-registering the exact same physical token just refreshes
   * metadata. Registering a *new* token for a (user, device, application)
   * that already has an ACTIVE row revokes the old row (TOKEN_REPLACED)
   * rather than updating it in place, preserving delivery history.
   */
  async register(input: RegisterDevicePushTokenInput) {
    const tokenHash = this.crypto.hash(input.rawToken);
    const existingByHash = await this.prisma.devicePushToken.findUnique({
      where: { tokenHash },
    });

    if (existingByHash) {
      return this.prisma.devicePushToken.update({
        where: { id: existingByHash.id },
        data: {
          deviceSessionId: input.deviceSessionId,
          status: 'ACTIVE',
          appVersion: input.appVersion ?? null,
          osVersion: input.osVersion ?? null,
          locale: input.locale ?? null,
          notificationsPermission: input.notificationsPermission,
          lastRegisteredAt: new Date(),
          lastUsedAt: new Date(),
          invalidatedAt: null,
          invalidationReason: null,
        },
      });
    }

    return this.prisma.$transaction(async (transaction) => {
      const existingForDevice = await transaction.devicePushToken.findFirst({
        where: {
          userId: input.userId,
          deviceId: input.deviceId,
          application: input.application,
          status: 'ACTIVE',
        },
      });

      if (existingForDevice) {
        await transaction.devicePushToken.update({
          where: { id: existingForDevice.id },
          data: {
            status: 'REVOKED',
            invalidatedAt: new Date(),
            invalidationReason: 'TOKEN_REPLACED',
          },
        });
      }

      return transaction.devicePushToken.create({
        data: {
          userId: input.userId,
          deviceSessionId: input.deviceSessionId,
          deviceId: input.deviceId,
          application: input.application,
          platform: input.platform,
          provider: input.provider,
          environment: input.environment,
          encryptedToken: this.crypto.encrypt(input.rawToken),
          tokenHash,
          status: 'ACTIVE',
          appVersion: input.appVersion ?? null,
          osVersion: input.osVersion ?? null,
          locale: input.locale ?? null,
          notificationsPermission: input.notificationsPermission,
          lastRegisteredAt: new Date(),
          lastUsedAt: new Date(),
        },
      });
    });
  }

  async findByIdForUser(id: string, userId: string) {
    return this.prisma.devicePushToken.findFirst({ where: { id, userId } });
  }

  async listActiveForUser(userId: string) {
    return this.prisma.devicePushToken.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { lastRegisteredAt: 'desc' },
    });
  }

  async listActiveTargetsForUser(
    userId: string,
    application: PushApplication,
  ): Promise<ActivePushTarget[]> {
    const rows = await this.prisma.devicePushToken.findMany({
      where: { userId, application, status: 'ACTIVE' },
    });
    return rows.map((row) => ({
      devicePushTokenId: row.id,
      rawToken: this.crypto.decrypt(row.encryptedToken),
      platform: row.platform,
      provider: row.provider,
    }));
  }

  async revoke(id: string, reason: string): Promise<void> {
    await this.prisma.devicePushToken.updateMany({
      where: { id, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        invalidatedAt: new Date(),
        invalidationReason: reason,
      },
    });
  }

  async revokeBySession(
    deviceSessionId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.devicePushToken.updateMany({
      where: { deviceSessionId, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        invalidatedAt: new Date(),
        invalidationReason: reason,
      },
    });
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.prisma.devicePushToken.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        invalidatedAt: new Date(),
        invalidationReason: reason,
      },
    });
  }

  /** Called only from the delivery path when a provider reports the token as permanently invalid — never based on a client claim. */
  async markInvalid(id: string, reason: string): Promise<void> {
    await this.prisma.devicePushToken.updateMany({
      where: { id },
      data: {
        status: 'INVALID',
        invalidatedAt: new Date(),
        invalidationReason: reason,
      },
    });
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.prisma.devicePushToken.updateMany({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  async countRecentRegistrationsForUser(
    userId: string,
    sinceMs: number,
  ): Promise<number> {
    return this.prisma.devicePushToken.count({
      where: {
        userId,
        lastRegisteredAt: { gte: new Date(Date.now() - sinceMs) },
      },
    });
  }
}
