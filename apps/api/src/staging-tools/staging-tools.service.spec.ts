import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

import { PhoneNormalizer } from '../auth/phone-normalizer.service.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { NotificationOutboxWorker } from '../notifications/notification-outbox.worker.js';
import { NotificationService } from '../notifications/notification.service.js';
import { DevicePushTokenRepository } from '../notifications/repositories/device-push-token.repository.js';
import { PaymentService } from '../payments/payment.service.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import { RedisService } from '../redis/redis.service.js';
import { StagingToolsService } from './staging-tools.service.js';

function makeService(overrides?: {
  notifications?: Partial<NotificationService>;
  notificationOutbox?: Partial<NotificationOutboxService>;
  pushOutboxWorker?: Partial<NotificationOutboxWorker>;
  devicePushTokens?: Partial<DevicePushTokenRepository>;
  extraPrisma?: Record<string, unknown>;
}) {
  const prisma = {
    driverLocation: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue(undefined) },
    $queryRawUnsafe: jest.fn(),
    ...overrides?.extraPrisma,
  };
  const service = new StagingToolsService(
    prisma as never,
    {} as RedisService,
    new PhoneNormalizer(),
    { name: 'staging' } as never,
    {} as PaymentService,
    {} as RealtimeOutboxService,
    (overrides?.notifications ?? {}) as NotificationService,
    (overrides?.notificationOutbox ?? {}) as NotificationOutboxService,
    (overrides?.pushOutboxWorker ?? {}) as NotificationOutboxWorker,
    (overrides?.devicePushTokens ?? {}) as DevicePushTokenRepository,
  );
  return { service, prisma };
}

describe('StagingToolsService location tools', () => {
  describe('markLatestLocationStale', () => {
    it("marks the driver's most recent location stale", async () => {
      const { service, prisma } = makeService();
      prisma.driverLocation.findFirst.mockResolvedValue({ id: 'loc-1' });
      prisma.driverLocation.update.mockResolvedValue({});

      const result = await service.markLatestLocationStale(
        'admin-1',
        'driver-1',
      );

      expect(result).toEqual({ locationId: 'loc-1' });
      expect(prisma.driverLocation.update).toHaveBeenCalledWith({
        where: { id: 'loc-1' },
        data: { stale: true },
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalled();
    });

    it('throws NotFoundException when the driver has no location yet', async () => {
      const { service, prisma } = makeService();
      prisma.driverLocation.findFirst.mockResolvedValue(null);

      await expect(
        service.markLatestLocationStale('admin-1', 'driver-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('emulateGpsJump', () => {
    it("inserts a new location offset from the driver's last position", async () => {
      const { service, prisma } = makeService();
      prisma.driverLocation.findFirst.mockResolvedValue({
        id: 'loc-1',
        deviceId: 'device-1',
      });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        { latitude: 59.9, longitude: 30.3 },
      ]);
      prisma.$queryRawUnsafe.mockResolvedValueOnce(undefined);

      const result = await service.emulateGpsJump('admin-1', 'driver-1', 0.5);

      expect(result.locationId).toEqual(expect.any(String));
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
      const insertArgs = prisma.$queryRawUnsafe.mock.calls[1] as unknown[];
      expect(insertArgs).toContain(30.8); // longitude + offset
      expect(insertArgs).toContain(60.4); // latitude + offset
      expect(prisma.adminAuditLog.create).toHaveBeenCalled();
    });

    it('throws NotFoundException when the driver has no prior location', async () => {
      const { service, prisma } = makeService();
      prisma.driverLocation.findFirst.mockResolvedValue(null);

      await expect(
        service.emulateGpsJump('admin-1', 'driver-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

describe('StagingToolsService push tools', () => {
  describe('testSendPush', () => {
    it('builds a draft, enqueues it, drives the worker, and reports the resulting status', async () => {
      const createDraft = jest.fn().mockReturnValue({
        deduplicationKey: 'dedup-1',
      });
      const enqueue = jest.fn().mockResolvedValue(undefined);
      const processPending = jest.fn().mockResolvedValue(undefined);
      const { service, prisma } = makeService({
        notifications: { createDraft } as never,
        notificationOutbox: { enqueue } as never,
        pushOutboxWorker: { processPending } as never,
        extraPrisma: {
          notificationOutboxEvent: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ id: 'event-1', status: 'DELIVERED' }),
          },
          notification: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ id: 'notif-1', status: 'SENT' }),
          },
        },
      });

      const result = await service.testSendPush('admin-1', 'user-1', 'DRIVER');

      expect(createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', application: 'DRIVER' }),
      );
      expect(enqueue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ deduplicationKey: 'dedup-1' }),
      );
      expect(processPending).toHaveBeenCalled();
      expect(result).toEqual({
        outboxEventId: 'event-1',
        outboxStatus: 'DELIVERED',
        notificationId: 'notif-1',
        notificationStatus: 'SENT',
      });
      expect(prisma.adminAuditLog.create).toHaveBeenCalled();
    });
  });

  describe('listPushTokens', () => {
    it('returns token rows without the encrypted token or hash', async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          id: 'token-1',
          application: 'DRIVER',
          platform: 'ANDROID',
          provider: 'FCM',
          environment: 'STAGING',
          status: 'ACTIVE',
          notificationsPermission: true,
          lastRegisteredAt: new Date(),
          lastUsedAt: null,
          invalidatedAt: null,
          invalidationReason: null,
        },
      ]);
      const { service } = makeService({
        extraPrisma: { devicePushToken: { findMany } },
      });

      const rows = await service.listPushTokens('user-1');

      expect(rows).toHaveLength(1);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
      const selectArg = (
        findMany.mock.calls[0]![0] as { select: Record<string, boolean> }
      ).select;
      expect(selectArg).not.toHaveProperty('encryptedToken');
      expect(selectArg).not.toHaveProperty('tokenHash');
    });
  });

  describe('simulateInvalidPushToken', () => {
    it('marks the token invalid and logs an audit entry', async () => {
      const markInvalid = jest.fn().mockResolvedValue(undefined);
      const { service, prisma } = makeService({
        devicePushTokens: { markInvalid } as never,
      });

      await service.simulateInvalidPushToken('admin-1', 'token-1');

      expect(markInvalid).toHaveBeenCalledWith(
        'token-1',
        'STAGING_SIMULATED_INVALID',
      );
      expect(prisma.adminAuditLog.create).toHaveBeenCalled();
    });
  });
});
