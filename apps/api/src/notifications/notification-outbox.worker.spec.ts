import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { MetricsService } from '../observability/metrics.service.js';
import { NotificationOutboxWorker } from './notification-outbox.worker.js';

const TRIP_ID = randomUUID();

interface FakeOutboxRow {
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
  lastError: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

interface FakeNotificationRow {
  id: string;
  userId: string;
  type: string;
  application: string;
  entityType: string;
  entityId: string | null;
  titleTemplate: string;
  bodyTemplate: string;
  templateVersion: number;
  payload: unknown;
  status: string;
  priority: string;
  deduplicationKey: string;
  scheduledAt: Date;
  createdAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  expiresAt: Date | null;
}

/** Mirrors Prisma's `{ increment: N }` update operator, which a plain `Object.assign` would otherwise overwrite a numeric field with the literal operator object. */
function applyUpdate<T extends Record<string, unknown>>(
  row: T,
  data: Partial<Record<keyof T, unknown>>,
): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      (row as Record<string, unknown>)[key] =
        ((row as Record<string, unknown>)[key] as number) +
        (value as { increment: number }).increment;
    } else {
      (row as Record<string, unknown>)[key] = value;
    }
  }
}

class FakePrisma {
  readonly outboxRows = new Map<string, FakeOutboxRow>();
  readonly notifications = new Map<string, FakeNotificationRow>();
  readonly deliveries: Array<Record<string, unknown>> = [];
  private nextId = 1;

  addOutboxRow(overrides: Partial<FakeOutboxRow> = {}): FakeOutboxRow {
    const row: FakeOutboxRow = {
      id: randomUUID(),
      type: 'DRIVER_NEW_TRIP_AVAILABLE',
      userId: 'user-1',
      application: 'DRIVER',
      entityType: 'TRIP',
      entityId: TRIP_ID,
      payload: {
        title: 'Новый заказ рядом',
        body: 'Пассажир предложил 350 ₽',
        deepLink: `resilienttaxi://driver/orders/${TRIP_ID}`,
        templateVersion: 1,
        count: 1,
      },
      priority: 'HIGH',
      deduplicationKey: `dedup-${this.nextId}`,
      collapseKey: `collapse-${this.nextId}`,
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 5,
      availableAt: new Date(Date.now() - 1_000),
      expiresAt: new Date(Date.now() + 60_000),
      notificationId: null,
      lastError: null,
      createdAt: new Date(),
      processedAt: null,
      ...overrides,
    };
    this.nextId += 1;
    this.outboxRows.set(row.id, row);
    return row;
  }

  readonly notificationOutboxEvent = {
    findMany: async ({
      where,
    }: {
      where: { status: string; availableAt: { lte: Date } };
    }) =>
      [...this.outboxRows.values()].filter(
        (row) =>
          row.status === where.status &&
          row.availableAt.getTime() <= where.availableAt.lte.getTime(),
      ),
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.outboxRows.get(where.id) ?? null,
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: { status: string };
      orderBy?: { createdAt: 'asc' | 'desc' };
    }) => {
      const matches = [...this.outboxRows.values()].filter(
        (row) => row.status === where.status,
      );
      matches.sort((a, b) =>
        orderBy?.createdAt === 'desc'
          ? b.createdAt.getTime() - a.createdAt.getTime()
          : a.createdAt.getTime() - b.createdAt.getTime(),
      );
      return matches[0] ?? null;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id?: string; status: string; availableAt?: { lte: Date } };
      data: Partial<FakeOutboxRow>;
    }) => {
      let count = 0;
      for (const row of this.outboxRows.values()) {
        if (where.id && row.id !== where.id) continue;
        if (row.status !== where.status) continue;
        if (
          where.availableAt &&
          row.availableAt.getTime() > where.availableAt.lte.getTime()
        )
          continue;
        applyUpdate(row, data);
        count += 1;
      }
      return { count };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeOutboxRow>;
    }) => {
      const row = this.outboxRows.get(where.id)!;
      applyUpdate(row, data);
      return row;
    },
  };

  readonly notification = {
    findUnique: async ({ where }: { where: { deduplicationKey: string } }) =>
      [...this.notifications.values()].find(
        (row) => row.deduplicationKey === where.deduplicationKey,
      ) ?? null,
    create: async ({
      data,
    }: {
      data: Omit<FakeNotificationRow, 'id' | 'createdAt'>;
    }) => {
      const row: FakeNotificationRow = {
        id: randomUUID(),
        createdAt: new Date(),
        ...data,
      };
      this.notifications.set(row.id, row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<FakeNotificationRow>;
    }) => {
      const row = this.notifications.get(where.id)!;
      Object.assign(row, data);
      return row;
    },
  };

  readonly notificationDelivery = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.deliveries.push(data);
      return data;
    },
  };
}

function buildWorker(overrides?: {
  pushEnabled?: boolean;
  targets?: Array<{
    devicePushTokenId: string;
    rawToken: string;
    platform: string;
    provider: string;
  }>;
  sendResults?: Array<{ status: string; devicePushTokenId: string }>;
  sendError?: Error;
  activeTokenCounts?: Array<{
    application: string;
    platform: string;
    count: number;
  }>;
}) {
  const config = new ConfigService({
    app: { environment: 'test' },
    push: {
      outboxPollIntervalMs: 1_000,
      initialRetryDelaySeconds: 5,
      maxRetryDelaySeconds: 900,
    },
  });
  const prisma = new FakePrisma();
  const markInvalidCalls: string[] = [];
  const devicePushTokens = {
    listActiveTargetsForUser: async () => overrides?.targets ?? [],
    markInvalid: async (id: string) => {
      markInvalidCalls.push(id);
    },
    countActiveByApplicationAndPlatform: async () =>
      overrides?.activeTokenCounts ?? [],
  };
  const sendToDevicesCalls: unknown[] = [];
  const providerResolver = {
    resolve: () => ({
      sendToDevices: async (input: unknown) => {
        sendToDevicesCalls.push(input);
        if (overrides?.sendError) throw overrides.sendError;
        return { results: overrides?.sendResults ?? [] };
      },
    }),
  };
  const metrics = new MetricsService();
  const preferences = {
    isPushEnabled: async () => overrides?.pushEnabled ?? true,
  };
  const templates = {
    categoryFor: () => 'TRIP_OFFERS',
  };
  const worker = new NotificationOutboxWorker(
    config,
    prisma as never,
    devicePushTokens as never,
    providerResolver as never,
    metrics,
    preferences as never,
    templates as never,
  );
  return { worker, prisma, markInvalidCalls, sendToDevicesCalls, metrics };
}

describe('NotificationOutboxWorker', () => {
  it('expires an outbox event silently once past its TTL, without sending or creating a Notification', async () => {
    const { worker, prisma } = buildWorker();
    const row = prisma.addOutboxRow({
      expiresAt: new Date(Date.now() - 1_000),
    });

    await worker.processPending();

    expect(prisma.outboxRows.get(row.id)!.status).toBe('EXPIRED');
    expect(prisma.notifications.size).toBe(0);
  });

  it('delivers successfully when the provider accepts the send, marking the outbox event DELIVERED', async () => {
    const target = {
      devicePushTokenId: 'token-1',
      rawToken: 'raw-1',
      platform: 'ANDROID',
      provider: 'FCM',
    };
    const { worker, prisma } = buildWorker({
      targets: [target],
      sendResults: [{ status: 'ACCEPTED', devicePushTokenId: 'token-1' }],
    });
    const row = prisma.addOutboxRow();

    await worker.processPending();

    expect(prisma.outboxRows.get(row.id)!.status).toBe('DELIVERED');
    expect(prisma.notifications.size).toBe(1);
    const notification = [...prisma.notifications.values()][0]!;
    expect(notification.status).toBe('SENT');
    expect(prisma.deliveries).toHaveLength(1);
    expect(prisma.deliveries[0]).toMatchObject({
      status: 'PROVIDER_ACCEPTED',
    });
  });

  it('marks PARTIALLY_SENT when some targets accept and others fail temporarily', async () => {
    const { worker, prisma } = buildWorker({
      targets: [
        {
          devicePushTokenId: 'token-1',
          rawToken: 'raw-1',
          platform: 'ANDROID',
          provider: 'FCM',
        },
        {
          devicePushTokenId: 'token-2',
          rawToken: 'raw-2',
          platform: 'ANDROID',
          provider: 'FCM',
        },
      ],
      sendResults: [
        { status: 'ACCEPTED', devicePushTokenId: 'token-1' },
        { status: 'FAILED_TEMPORARY', devicePushTokenId: 'token-2' },
      ],
    });
    prisma.addOutboxRow();

    await worker.processPending();

    const notification = [...prisma.notifications.values()][0]!;
    expect(notification.status).toBe('PARTIALLY_SENT');
  });

  it('marks an invalid token via the device token repository and never retries that token', async () => {
    const { worker, prisma, markInvalidCalls } = buildWorker({
      targets: [
        {
          devicePushTokenId: 'token-1',
          rawToken: 'raw-1',
          platform: 'ANDROID',
          provider: 'FCM',
        },
      ],
      sendResults: [{ status: 'TOKEN_INVALID', devicePushTokenId: 'token-1' }],
    });
    prisma.addOutboxRow();

    await worker.processPending();

    expect(markInvalidCalls).toEqual(['token-1']);
  });

  it('schedules a retry with backoff+jitter when no target accepts, up to maxAttempts', async () => {
    const { worker, prisma } = buildWorker({ targets: [] });
    const before = Date.now();
    const row = prisma.addOutboxRow({ attempts: 0, maxAttempts: 5 });

    await worker.processPending();

    const stored = prisma.outboxRows.get(row.id)!;
    expect(stored.status).toBe('PENDING');
    expect(stored.attempts).toBe(1);
    expect(stored.availableAt.getTime()).toBeGreaterThan(before);
    expect(stored.lastError).toContain('no active device tokens');
  });

  it('moves to DEAD_LETTER once maxAttempts is reached', async () => {
    const { worker, prisma } = buildWorker({ targets: [] });
    const row = prisma.addOutboxRow({ attempts: 4, maxAttempts: 5 });

    await worker.processPending();

    const stored = prisma.outboxRows.get(row.id)!;
    expect(stored.status).toBe('DEAD_LETTER');
    expect(stored.lastError).toContain('no active device tokens');
  });

  it('retries when the provider send itself throws', async () => {
    const { worker, prisma } = buildWorker({
      targets: [
        {
          devicePushTokenId: 'token-1',
          rawToken: 'raw-1',
          platform: 'ANDROID',
          provider: 'FCM',
        },
      ],
      sendError: new Error('network blip'),
    });
    const row = prisma.addOutboxRow({ attempts: 0, maxAttempts: 5 });

    await worker.processPending();

    const stored = prisma.outboxRows.get(row.id)!;
    expect(stored.status).toBe('PENDING');
    expect(stored.lastError).toBe('network blip');
  });

  it('does not double-claim a row that is not PENDING (concurrent-worker safety)', async () => {
    const { worker, prisma } = buildWorker({ targets: [] });
    const row = prisma.addOutboxRow({
      status: 'PROCESSING',
      availableAt: new Date(Date.now() + 60_000),
    });

    await worker.processPending();

    // Still PROCESSING and not touched — its availableAt is in the future
    // so it's neither reclaimed for crash-recovery nor picked up as PENDING.
    expect(prisma.outboxRows.get(row.id)!.status).toBe('PROCESSING');
  });

  it('skips sending and cancels the Notification when the category is disabled by preference', async () => {
    const target = {
      devicePushTokenId: 'token-1',
      rawToken: 'raw-1',
      platform: 'ANDROID',
      provider: 'FCM',
    };
    const { worker, prisma, sendToDevicesCalls } = buildWorker({
      pushEnabled: false,
      targets: [target],
      sendResults: [{ status: 'ACCEPTED', devicePushTokenId: 'token-1' }],
    });
    const row = prisma.addOutboxRow();

    await worker.processPending();

    expect(sendToDevicesCalls).toHaveLength(0);
    expect(prisma.outboxRows.get(row.id)!.status).toBe('DELIVERED');
    expect(prisma.notifications.size).toBe(1);
    const notification = [...prisma.notifications.values()][0]!;
    expect(notification.status).toBe('CANCELLED');
  });

  it('refreshes active_push_tokens and notification_outbox_lag_seconds gauges on every poll tick', async () => {
    const { worker, prisma, metrics } = buildWorker({
      activeTokenCounts: [
        { application: 'DRIVER', platform: 'ANDROID', count: 7 },
      ],
    });
    prisma.addOutboxRow({
      createdAt: new Date(Date.now() - 5_000),
      availableAt: new Date(Date.now() + 60_000),
      status: 'PENDING',
    });

    await worker.processPending();

    const text = metrics.renderPrometheusText();
    expect(text).toContain(
      'active_push_tokens{application="DRIVER",platform="ANDROID"} 7',
    );
    expect(text).toMatch(/notification_outbox_lag_seconds [1-9]\d*(\.\d+)?/);
  });

  it('reuses the existing Notification row when re-processing the same deduplicationKey', async () => {
    const { worker, prisma } = buildWorker({
      targets: [
        {
          devicePushTokenId: 'token-1',
          rawToken: 'raw-1',
          platform: 'ANDROID',
          provider: 'FCM',
        },
      ],
      sendResults: [{ status: 'ACCEPTED', devicePushTokenId: 'token-1' }],
    });
    const row = prisma.addOutboxRow({ deduplicationKey: 'shared-key' });

    await worker.processPending();
    expect(prisma.notifications.size).toBe(1);

    // Simulate the same event being reprocessed (e.g. after a crash-recovery
    // requeue) by resetting it back to PENDING with the same dedup key.
    row.status = 'PENDING';
    row.availableAt = new Date(Date.now() - 1_000);
    await worker.processPending();

    expect(prisma.notifications.size).toBe(1);
  });
});
