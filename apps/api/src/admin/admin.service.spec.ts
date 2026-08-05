import { randomUUID } from 'node:crypto';

import { NotFoundException } from '@nestjs/common';

import { AdminService } from './admin.service.js';

interface FakeOutboxRow {
  id: string;
  type: string;
  application: string;
  userId: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

class FakePrisma {
  readonly outboxRows = new Map<string, FakeOutboxRow>();
  readonly notificationRows: Array<{ status: string }> = [];
  readonly tokenRows: Array<{
    status: string;
    application: string;
    platform: string;
  }> = [];
  readonly auditEntries: Array<Record<string, unknown>> = [];

  addOutboxRow(overrides: Partial<FakeOutboxRow> = {}): FakeOutboxRow {
    const row: FakeOutboxRow = {
      id: randomUUID(),
      type: 'DRIVER_NEW_TRIP_AVAILABLE',
      application: 'DRIVER',
      userId: 'user-1',
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 5,
      lastError: null,
      createdAt: new Date(),
      processedAt: null,
      ...overrides,
    };
    this.outboxRows.set(row.id, row);
    return row;
  }

  readonly notificationOutboxEvent = {
    groupBy: async () => {
      const counts = new Map<string, number>();
      for (const row of this.outboxRows.values()) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      }
      return [...counts.entries()].map(([status, count]) => ({
        status,
        _count: { _all: count },
      }));
    },
    findMany: async ({
      where,
      skip,
      take,
    }: {
      where: { status: string };
      skip: number;
      take: number;
    }) =>
      [...this.outboxRows.values()]
        .filter((row) => row.status === where.status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(skip, skip + take),
    count: async ({ where }: { where: { status: string } }) =>
      [...this.outboxRows.values()].filter((row) => row.status === where.status)
        .length,
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status: string };
      data: Partial<FakeOutboxRow>;
    }) => {
      const row = this.outboxRows.get(where.id);
      if (!row || row.status !== where.status) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  };

  readonly notification = {
    groupBy: async () => {
      const counts = new Map<string, number>();
      for (const row of this.notificationRows) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      }
      return [...counts.entries()].map(([status, count]) => ({
        status,
        _count: { _all: count },
      }));
    },
  };

  readonly devicePushToken = {
    groupBy: async ({ where }: { where: { status: string } }) => {
      const counts = new Map<
        string,
        { application: string; platform: string; count: number }
      >();
      for (const row of this.tokenRows) {
        if (row.status !== where.status) continue;
        const key = `${row.application}:${row.platform}`;
        const existing = counts.get(key);
        if (existing) existing.count += 1;
        else
          counts.set(key, {
            application: row.application,
            platform: row.platform,
            count: 1,
          });
      }
      return [...counts.values()].map((entry) => ({
        application: entry.application,
        platform: entry.platform,
        _count: { _all: entry.count },
      }));
    },
  };

  readonly adminAuditLog = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.auditEntries.push(data);
      return data;
    },
  };

  async $transaction(ops: Promise<unknown>[]): Promise<unknown[]> {
    return Promise.all(ops);
  }
}

function buildService() {
  const prisma = new FakePrisma();
  const service = new AdminService(prisma as never);
  return { service, prisma };
}

describe('AdminService push monitoring', () => {
  describe('getPushStats', () => {
    it('groups outbox/notification/token rows into count summaries', async () => {
      const { service, prisma } = buildService();
      prisma.addOutboxRow({ status: 'PENDING' });
      prisma.addOutboxRow({ status: 'PENDING' });
      prisma.addOutboxRow({ status: 'DEAD_LETTER' });
      prisma.notificationRows.push({ status: 'SENT' }, { status: 'CANCELLED' });
      prisma.tokenRows.push({
        status: 'ACTIVE',
        application: 'DRIVER',
        platform: 'ANDROID',
      });

      const stats = await service.getPushStats();

      expect(stats.outboxByStatus).toEqual({ PENDING: 2, DEAD_LETTER: 1 });
      expect(stats.notificationsByStatus).toEqual({
        SENT: 1,
        CANCELLED: 1,
      });
      expect(stats.activeTokens).toEqual([
        { application: 'DRIVER', platform: 'ANDROID', count: 1 },
      ]);
    });
  });

  describe('listDeadLetterPush', () => {
    it('only returns DEAD_LETTER rows, newest first', async () => {
      const { service, prisma } = buildService();
      prisma.addOutboxRow({
        status: 'DEAD_LETTER',
        createdAt: new Date(Date.now() - 10_000),
      });
      const newest = prisma.addOutboxRow({
        status: 'DEAD_LETTER',
        createdAt: new Date(),
      });
      prisma.addOutboxRow({ status: 'PENDING' });

      const page = await service.listDeadLetterPush({});

      expect(page.total).toBe(2);
      expect(page.items[0]!.id).toBe(newest.id);
    });
  });

  describe('retryDeadLetterPush', () => {
    it('resets a DEAD_LETTER row back to PENDING with attempts cleared and logs an audit entry', async () => {
      const { service, prisma } = buildService();
      const row = prisma.addOutboxRow({
        status: 'DEAD_LETTER',
        attempts: 5,
        lastError: 'no active device tokens',
      });

      await service.retryDeadLetterPush('admin-1', row.id);

      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(0);
      expect(row.lastError).toBeNull();
      expect(prisma.auditEntries).toHaveLength(1);
      expect(prisma.auditEntries[0]).toMatchObject({
        adminId: 'admin-1',
        action: 'PUSH_DEAD_LETTER_RETRIED',
        targetId: row.id,
      });
    });

    it('throws NotFoundException when the event is not in DEAD_LETTER state', async () => {
      const { service, prisma } = buildService();
      const row = prisma.addOutboxRow({ status: 'PENDING' });

      await expect(
        service.retryDeadLetterPush('admin-1', row.id),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
