import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';

import { PhoneNormalizer } from '../auth/phone-normalizer.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service.js';
import { RedisService } from '../redis/redis.service.js';
import { StagingToolsService } from './staging-tools.service.js';

function makeService() {
  const prisma = {
    driverLocation: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    adminAuditLog: { create: jest.fn().mockResolvedValue(undefined) },
    $queryRawUnsafe: jest.fn(),
  };
  const service = new StagingToolsService(
    prisma as never,
    {} as RedisService,
    new PhoneNormalizer(),
    { name: 'staging' } as never,
    {} as PaymentService,
    {} as RealtimeOutboxService,
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
