import { randomUUID } from 'node:crypto';

import { jest } from '@jest/globals';

import { MetricsService } from '../observability/metrics.service.js';
import { NotificationInboxService } from './notification-inbox.service.js';

interface FakeNotificationRow {
  id: string;
  userId: string;
  application: string;
  type: string;
  entityType: string;
  entityId: string | null;
  titleTemplate: string;
  bodyTemplate: string;
  payload: unknown;
  createdAt: Date;
  readAt: Date | null;
  openedAt: Date | null;
}

class FakePrisma {
  readonly rows: FakeNotificationRow[] = [];

  addRow(overrides: Partial<FakeNotificationRow> = {}): FakeNotificationRow {
    const row: FakeNotificationRow = {
      id: randomUUID(),
      userId: 'user-1',
      application: 'DRIVER',
      type: 'DRIVER_NEW_TRIP_AVAILABLE',
      entityType: 'TRIP',
      entityId: randomUUID(),
      titleTemplate: 'Новый заказ рядом',
      bodyTemplate: 'Пассажир предложил 350 ₽',
      payload: { deepLink: 'resilienttaxi://driver/orders/1' },
      createdAt: new Date(),
      readAt: null,
      openedAt: null,
      ...overrides,
    };
    this.rows.push(row);
    return row;
  }

  readonly notification = {
    findMany: async ({
      where,
      take,
      cursor,
      skip,
    }: {
      where: {
        userId: string;
        application: string;
        readAt?: null;
      };
      take: number;
      cursor?: { id: string };
      skip?: number;
    }) => {
      let filtered = this.rows
        .filter(
          (row) =>
            row.userId === where.userId &&
            row.application === where.application &&
            (where.readAt === undefined || row.readAt === where.readAt),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      if (cursor) {
        const index = filtered.findIndex((row) => row.id === cursor.id);
        filtered = filtered.slice(index + (skip ?? 0));
      }
      return filtered.slice(0, take);
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.rows.find((row) => row.id === where.id) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeNotificationRow>;
    }) => {
      const row = this.rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { userId: string; application: string; readAt: null };
      data: Partial<FakeNotificationRow>;
    }) => {
      let count = 0;
      for (const row of this.rows) {
        if (
          row.userId === where.userId &&
          row.application === where.application &&
          row.readAt === where.readAt
        ) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };
}

function buildService() {
  const prisma = new FakePrisma();
  const metrics = new MetricsService();
  const service = new NotificationInboxService(prisma as never, metrics);
  return { service, prisma, metrics };
}

describe('NotificationInboxService', () => {
  describe('listInbox', () => {
    it('returns items newest-first with a null cursor when there is no more data', async () => {
      const { service, prisma } = buildService();
      prisma.addRow({ createdAt: new Date(Date.now() - 2_000) });
      const newest = prisma.addRow({ createdAt: new Date() });

      const result = await service.listInbox('user-1', 'DRIVER', {});

      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.id).toBe(newest.id);
      expect(result.nextCursor).toBeNull();
    });

    it('paginates via cursor when more rows exist than the limit', async () => {
      const { service, prisma } = buildService();
      const rows = Array.from({ length: 3 }, (_, i) =>
        prisma.addRow({ createdAt: new Date(Date.now() - i * 1_000) }),
      );

      const page1 = await service.listInbox('user-1', 'DRIVER', { limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.items.map((i) => i.id)).toEqual([rows[0]!.id, rows[1]!.id]);
      expect(page1.nextCursor).toBe(rows[1]!.id);

      const page2 = await service.listInbox('user-1', 'DRIVER', {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((i) => i.id)).toEqual([rows[2]!.id]);
      expect(page2.nextCursor).toBeNull();
    });

    it('filters to unread only when requested', async () => {
      const { service, prisma } = buildService();
      prisma.addRow({ readAt: new Date() });
      const unread = prisma.addRow({ readAt: null });

      const result = await service.listInbox('user-1', 'DRIVER', {
        unreadOnly: true,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe(unread.id);
    });

    it('maps deepLink from the stored payload', async () => {
      const { service, prisma } = buildService();
      prisma.addRow({ payload: { deepLink: 'resilienttaxi://trip/xyz' } });

      const result = await service.listInbox('user-1', 'DRIVER', {});

      expect(result.items[0]!.deepLink).toBe('resilienttaxi://trip/xyz');
    });
  });

  describe('markOpened', () => {
    it('sets openedAt and emits a metric exactly once', async () => {
      const { service, prisma, metrics } = buildService();
      const row = prisma.addRow();
      const incrementSpy = jest.spyOn(metrics, 'increment');

      await service.markOpened('user-1', row.id);
      await service.markOpened('user-1', row.id);

      expect(row.openedAt).not.toBeNull();
      expect(incrementSpy).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException for a notification owned by another user', async () => {
      const { service, prisma } = buildService();
      const row = prisma.addRow({ userId: 'someone-else' });

      await expect(service.markOpened('user-1', row.id)).rejects.toThrow(
        'Notification not found',
      );
    });
  });

  describe('markRead', () => {
    it('sets readAt', async () => {
      const { service, prisma } = buildService();
      const row = prisma.addRow();

      await service.markRead('user-1', row.id);

      expect(row.readAt).not.toBeNull();
    });
  });

  describe('markAllRead', () => {
    it('marks every unread row for the user+application and returns the count', async () => {
      const { service, prisma } = buildService();
      prisma.addRow({ readAt: null });
      prisma.addRow({ readAt: null });
      prisma.addRow({ readAt: new Date() });
      prisma.addRow({ userId: 'user-2', readAt: null });

      const result = await service.markAllRead('user-1', 'DRIVER');

      expect(result.count).toBe(2);
      expect(
        prisma.rows.filter((r) => r.userId === 'user-1' && r.readAt === null),
      ).toHaveLength(0);
    });
  });
});
