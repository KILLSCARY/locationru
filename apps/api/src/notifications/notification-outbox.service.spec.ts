import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { NotificationOutboxService } from './notification-outbox.service.js';
import type { NotificationDraft } from './notification.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { NotificationTemplateService } from './templates/notification-template.service.js';

interface FakeRow {
  id: string;
  type: string;
  userId: string;
  application: string;
  entityType: string;
  entityId: string | null;
  payload: unknown;
  priority: string;
  deduplicationKey: string;
  collapseKey: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  expiresAt: Date | null;
  notificationId: string | null;
  processedAt: Date | null;
  createdAt: Date;
}

class FakePrisma {
  readonly rows = new Map<string, FakeRow>();

  readonly notificationOutboxEvent = {
    findUnique: async ({ where }: { where: { deduplicationKey: string } }) => {
      for (const row of this.rows.values()) {
        if (row.deduplicationKey === where.deduplicationKey) return row;
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
    create: async ({ data }: { data: Omit<FakeRow, 'id' | 'createdAt'> }) => {
      const row = {
        id: randomUUID(),
        createdAt: new Date(),
        ...data,
      } as FakeRow;
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
          Object.entries(where).every(([key, value]) => {
            const actual = (row as Record<string, unknown>)[key];
            if (value && typeof value === 'object' && 'not' in value) {
              return actual !== (value as { not: unknown }).not;
            }
            return actual === value;
          })
        ) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };
}

function buildService(maxAttempts = 5) {
  const config = new ConfigService({ push: { maxAttempts } });
  const prisma = new FakePrisma();
  const metrics = new MetricsService();
  const service = new NotificationOutboxService(
    config,
    prisma as never,
    new NotificationTemplateService(),
    metrics,
  );
  return { service, prisma, metrics };
}

function draft(overrides: Partial<NotificationDraft> = {}): NotificationDraft {
  return {
    userId: 'user-1',
    type: 'DRIVER_NEW_TRIP_AVAILABLE' as never,
    application: 'DRIVER' as never,
    entityType: 'TRIP',
    entityId: 'trip-1',
    title: 'Новый заказ рядом',
    body: 'Пассажир предложил 350 ₽',
    templateVersion: 1,
    deepLink: 'resilienttaxi://driver/orders/trip-1',
    priority: 'HIGH' as never,
    ttlSeconds: 30,
    collapseStrategy: 'NONE',
    collapseKey: 'collapse-key-1',
    deduplicationKey: 'dedup-key-1',
    ...overrides,
  };
}

describe('NotificationOutboxService', () => {
  it('inserts a new outbox row for a NONE-strategy draft', async () => {
    const { service, prisma } = buildService();

    await service.enqueue(prisma as never, draft({ collapseStrategy: 'NONE' }));

    expect(prisma.rows.size).toBe(1);
    const row = [...prisma.rows.values()][0]!;
    expect(row.status).toBe('PENDING');
    expect(row.deduplicationKey).toBe('dedup-key-1');
    expect((row.payload as { count: number }).count).toBe(1);
  });

  it('increments notifications_queued_total on a fresh insert', async () => {
    const { service, prisma, metrics } = buildService();

    await service.enqueue(prisma as never, draft({ collapseStrategy: 'NONE' }));

    expect(metrics.renderPrometheusText()).toContain(
      'notifications_queued_total{application="DRIVER",type="DRIVER_NEW_TRIP_AVAILABLE"} 1',
    );
  });

  it('is idempotent: re-enqueueing the same deduplicationKey never creates a second row', async () => {
    const { service, prisma } = buildService();
    const input = draft({ collapseStrategy: 'NONE' });

    await service.enqueue(prisma as never, input);
    await service.enqueue(prisma as never, input);

    expect(prisma.rows.size).toBe(1);
  });

  it('SUPERSEDE cancels a prior PENDING row sharing the collapse key before inserting the new one', async () => {
    const { service, prisma } = buildService();
    await service.enqueue(
      prisma as never,
      draft({
        collapseStrategy: 'SUPERSEDE',
        collapseKey: 'trip-1-status',
        deduplicationKey: 'event-1',
      }),
    );

    await service.enqueue(
      prisma as never,
      draft({
        collapseStrategy: 'SUPERSEDE',
        collapseKey: 'trip-1-status',
        deduplicationKey: 'event-2',
        title: 'Водитель прибыл',
      }),
    );

    expect(prisma.rows.size).toBe(2);
    const statuses = [...prisma.rows.values()].map((row) => row.status);
    expect(statuses.sort()).toEqual(['CANCELLED', 'PENDING']);
  });

  it('SUPERSEDE does not touch a row from a different collapse family', async () => {
    const { service, prisma } = buildService();
    await service.enqueue(
      prisma as never,
      draft({
        collapseStrategy: 'SUPERSEDE',
        collapseKey: 'trip-1-status',
        deduplicationKey: 'event-1',
      }),
    );

    await service.enqueue(
      prisma as never,
      draft({
        collapseStrategy: 'SUPERSEDE',
        collapseKey: 'trip-2-status',
        deduplicationKey: 'event-2',
      }),
    );

    expect(
      [...prisma.rows.values()].every((row) => row.status === 'PENDING'),
    ).toBe(true);
  });

  it('COLLAPSE_COUNT merges a repeated event into the existing PENDING row instead of creating a new one', async () => {
    const { service, prisma } = buildService();
    await service.enqueue(
      prisma as never,
      draft({
        collapseStrategy: 'COLLAPSE_COUNT',
        collapseKey: 'trip-1-bids',
        deduplicationKey: 'bid-1',
      }),
    );
    await service.enqueue(
      prisma as never,
      draft({
        collapseStrategy: 'COLLAPSE_COUNT',
        collapseKey: 'trip-1-bids',
        deduplicationKey: 'bid-2',
      }),
    );
    await service.enqueue(
      prisma as never,
      draft({
        collapseStrategy: 'COLLAPSE_COUNT',
        collapseKey: 'trip-1-bids',
        deduplicationKey: 'bid-3',
      }),
    );

    expect(prisma.rows.size).toBe(1);
    const row = [...prisma.rows.values()][0]!;
    expect((row.payload as { count: number }).count).toBe(3);
  });

  it('COLLAPSE_COUNT re-renders the copy on merge so the text reflects the new count, not just a stale number', async () => {
    const { service, prisma } = buildService();
    await service.enqueue(
      prisma as never,
      draft({
        type: 'PASSENGER_BID_RECEIVED' as never,
        body: 'Получено новое предложение. Откройте приложение для просмотра.',
        collapseStrategy: 'COLLAPSE_COUNT',
        collapseKey: 'trip-1-bids',
        deduplicationKey: 'bid-1',
      }),
    );
    let row = [...prisma.rows.values()][0]!;
    expect((row.payload as { body: string }).body).toBe(
      'Получено новое предложение. Откройте приложение для просмотра.',
    );

    await service.enqueue(
      prisma as never,
      draft({
        type: 'PASSENGER_BID_RECEIVED' as never,
        collapseStrategy: 'COLLAPSE_COUNT',
        collapseKey: 'trip-1-bids',
        deduplicationKey: 'bid-2',
      }),
    );
    row = [...prisma.rows.values()][0]!;
    expect((row.payload as { body: string }).body).toBe(
      'Получено 2 новых предложений. Откройте приложение для просмотра.',
    );
  });

  it('COLLAPSE_COUNT starts a fresh row once the prior one is no longer PENDING', async () => {
    const { service, prisma } = buildService();
    await service.enqueue(
      prisma as never,
      draft({
        collapseStrategy: 'COLLAPSE_COUNT',
        collapseKey: 'trip-1-bids',
        deduplicationKey: 'bid-1',
      }),
    );
    const firstRow = [...prisma.rows.values()][0]!;
    firstRow.status = 'DELIVERED';

    await service.enqueue(
      prisma as never,
      draft({
        collapseStrategy: 'COLLAPSE_COUNT',
        collapseKey: 'trip-1-bids',
        deduplicationKey: 'bid-2',
      }),
    );

    expect(prisma.rows.size).toBe(2);
  });

  it('sets expiresAt from the draft TTL and maxAttempts from config', async () => {
    const { service, prisma } = buildService(7);
    const before = Date.now();

    await service.enqueue(
      prisma as never,
      draft({ ttlSeconds: 45, collapseStrategy: 'NONE' }),
    );

    const row = [...prisma.rows.values()][0]!;
    expect(row.maxAttempts).toBe(7);
    expect(row.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 45_000);
  });

  describe('cancelPendingForEntity', () => {
    it('cancels every PENDING row of that type/entity across different users', async () => {
      const { service, prisma } = buildService();
      await service.enqueue(
        prisma as never,
        draft({
          userId: 'driver-1',
          collapseKey: 'trip-1-driver-1',
          deduplicationKey: 'dispatch-1-driver-1',
        }),
      );
      await service.enqueue(
        prisma as never,
        draft({
          userId: 'driver-2',
          collapseKey: 'trip-1-driver-2',
          deduplicationKey: 'dispatch-1-driver-2',
        }),
      );

      await service.cancelPendingForEntity(
        prisma as never,
        'DRIVER_NEW_TRIP_AVAILABLE' as never,
        'trip-1',
      );

      expect(
        [...prisma.rows.values()].every((row) => row.status === 'CANCELLED'),
      ).toBe(true);
    });

    it('leaves the exceptUserId row untouched', async () => {
      const { service, prisma } = buildService();
      await service.enqueue(
        prisma as never,
        draft({
          userId: 'driver-1',
          collapseKey: 'trip-1-driver-1',
          deduplicationKey: 'dispatch-1-driver-1',
        }),
      );
      await service.enqueue(
        prisma as never,
        draft({
          userId: 'driver-2',
          collapseKey: 'trip-1-driver-2',
          deduplicationKey: 'dispatch-1-driver-2',
        }),
      );

      await service.cancelPendingForEntity(
        prisma as never,
        'DRIVER_NEW_TRIP_AVAILABLE' as never,
        'trip-1',
        { exceptUserId: 'driver-2' },
      );

      const byUser = new Map(
        [...prisma.rows.values()].map((row) => [row.userId, row.status]),
      );
      expect(byUser.get('driver-1')).toBe('CANCELLED');
      expect(byUser.get('driver-2')).toBe('PENDING');
    });

    it('does not touch rows for a different entityId', async () => {
      const { service, prisma } = buildService();
      await service.enqueue(
        prisma as never,
        draft({
          entityId: 'trip-1',
          collapseKey: 'trip-1-driver-1',
          deduplicationKey: 'dispatch-1',
        }),
      );
      await service.enqueue(
        prisma as never,
        draft({
          entityId: 'trip-2',
          collapseKey: 'trip-2-driver-1',
          deduplicationKey: 'dispatch-2',
        }),
      );

      await service.cancelPendingForEntity(
        prisma as never,
        'DRIVER_NEW_TRIP_AVAILABLE' as never,
        'trip-1',
      );

      const byEntity = new Map(
        [...prisma.rows.values()].map((row) => [row.entityId, row.status]),
      );
      expect(byEntity.get('trip-1')).toBe('CANCELLED');
      expect(byEntity.get('trip-2')).toBe('PENDING');
    });
  });
});
