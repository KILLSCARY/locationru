import { ConfigService } from '@nestjs/config';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { TripStatus } from '../generated/prisma/client.js';
import type { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import type { NotificationDraft } from '../notifications/notification.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import {
  TripStateMachine,
  type TripTransitionResult,
} from '../trips/trip-state-machine.service.js';
import { TestPaymentProvider } from './test-payment.provider.js';
import { TripLifecycleService } from './trip-lifecycle.service.js';

const driver: AuthenticatedUser = {
  id: 'driver-1',
  phone: '+79990000001',
  role: 'DRIVER',
  sessionId: 'session-driver',
};

const passenger: AuthenticatedUser = {
  id: 'passenger-1',
  phone: '+79990000002',
  role: 'PASSENGER',
  sessionId: 'session-passenger',
};

const TRIP_ID = 'trip-1';

interface FakeTripRow {
  id: string;
  status: TripStatus;
  version: number;
  passengerPriceKopecks: number;
  finalPriceKopecks: number | null;
  passengerId: string;
  selectedDriverId: string;
}

class FakePrisma {
  tripRow: FakeTripRow = {
    id: TRIP_ID,
    status: TripStatus.DRIVER_SELECTED,
    version: 0,
    passengerPriceKopecks: 35_000,
    finalPriceKopecks: null,
    passengerId: passenger.id,
    selectedDriverId: driver.id,
  };
  tripPaymentRow: { status: string; providerReference: string } | null = null;
  boardingCodeRow: {
    codeHash: string;
    expiresAt: Date;
    attempts: number;
    usedAt: Date | null;
  } | null = null;
  readonly lifecycleActions: Array<{
    id: string;
    tripId: string;
    action: string;
    actorId: string;
    idempotencyKey: string;
    result: unknown;
  }> = [];
  private nextActionId = 1;

  readonly trip = {
    findFirst: async () => this.tripRow,
  };

  readonly tripPayment = {
    findUnique: async () => this.tripPaymentRow,
    upsert: async ({
      create,
    }: {
      create: { status: string; providerReference: string };
    }) => {
      this.tripPaymentRow ??= create;
      return this.tripPaymentRow;
    },
    update: async ({ data }: { data: { status?: string } }) => {
      Object.assign(this.tripPaymentRow!, data);
      return this.tripPaymentRow;
    },
  };

  readonly tripBoardingCode = {
    findUnique: async () => this.boardingCodeRow,
    create: async () => undefined,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(this.boardingCodeRow!, data);
      return this.boardingCodeRow;
    },
  };

  readonly tripLifecycleAction = {
    findFirst: async ({
      where,
    }: {
      where: {
        tripId: string;
        action: string;
        actorId: string;
        idempotencyKey: string;
      };
    }) =>
      this.lifecycleActions.find(
        (row) =>
          row.tripId === where.tripId &&
          row.action === where.action &&
          row.actorId === where.actorId &&
          row.idempotencyKey === where.idempotencyKey,
      ) ?? null,
    create: async ({
      data,
    }: {
      data: {
        tripId: string;
        action: string;
        actorId: string;
        idempotencyKey: string;
        result: unknown;
      };
    }) => {
      const row = { id: `action-${this.nextActionId++}`, ...data };
      this.lifecycleActions.push(row);
      return row;
    },
  };
}

function buildService() {
  const prisma = new FakePrisma();
  const enqueuedDrafts: NotificationDraft[] = [];
  const notifications = {
    createDraft: (input: {
      userId: string;
      type: string;
      application: string;
      entityType: string;
      entityId: string;
      idempotencyKey: string;
    }) =>
      ({
        ...input,
        title: 'title',
        body: 'body',
        templateVersion: 1,
        deepLink: null,
        priority: 'HIGH',
        ttlSeconds: 300,
        collapseStrategy: 'SUPERSEDE',
        collapseKey: `collapse:${input.entityId}:${input.type}`,
        deduplicationKey: `dedup:${input.idempotencyKey}`,
      }) as unknown as NotificationDraft,
  };
  const notificationOutbox = {
    enqueue: async (_client: unknown, draft: NotificationDraft) => {
      enqueuedDrafts.push(draft);
    },
  };
  const stateMachine = {
    transition: async (input: { tripId: string; newStatus: TripStatus }) => {
      prisma.tripRow.status = input.newStatus;
      prisma.tripRow.version += 1;
      return {
        id: input.tripId,
        status: input.newStatus,
        version: prisma.tripRow.version,
      } satisfies TripTransitionResult;
    },
  };
  const config = new ConfigService({
    trips: {
      boardingCodeHashSecret: 'test-boarding-secret',
      boardingCodeTtlSeconds: 300,
      boardingCodeMaxAttempts: 5,
    },
  });
  const service = new TripLifecycleService(
    config,
    new TestPaymentProvider(),
    prisma as unknown as PrismaService,
    stateMachine as unknown as TripStateMachine,
    notifications as unknown as NotificationService,
    notificationOutbox as unknown as NotificationOutboxService,
  );
  return { service, prisma, enqueuedDrafts };
}

describe('TripLifecycleService notification wiring', () => {
  it('arrive() notifies the passenger with PASSENGER_DRIVER_ARRIVED', async () => {
    const { service, prisma, enqueuedDrafts } = buildService();
    prisma.tripRow.status = TripStatus.DRIVER_EN_ROUTE;

    await service.arrive(driver, TRIP_ID, 'key-1');

    expect(enqueuedDrafts).toHaveLength(1);
    expect(enqueuedDrafts[0]).toMatchObject({
      userId: passenger.id,
      type: 'PASSENGER_DRIVER_ARRIVED',
      application: 'PASSENGER',
      entityId: TRIP_ID,
    });
  });

  it('startEnRoute() notifies the passenger with PASSENGER_DRIVER_EN_ROUTE', async () => {
    const { service, prisma, enqueuedDrafts } = buildService();
    prisma.tripRow.status = TripStatus.PAYMENT_RESERVED;
    prisma.tripPaymentRow = { status: 'RESERVED', providerReference: 'ref-1' };

    await service.startEnRoute(driver, TRIP_ID, 'key-1');

    expect(enqueuedDrafts).toHaveLength(1);
    expect(enqueuedDrafts[0]).toMatchObject({
      userId: passenger.id,
      type: 'PASSENGER_DRIVER_EN_ROUTE',
    });
  });

  it('authorizePayment() notifies both the passenger and the driver', async () => {
    const { service, prisma, enqueuedDrafts } = buildService();
    prisma.tripRow.status = TripStatus.PAYMENT_PENDING;

    await service.authorizePayment(passenger, TRIP_ID, 'key-1');

    expect(enqueuedDrafts).toHaveLength(2);
    const types = enqueuedDrafts.map((draft) => draft.type).sort();
    expect(types).toEqual(
      ['DRIVER_PAYMENT_RESERVED', 'PASSENGER_PAYMENT_RESERVED'].sort(),
    );
    expect(
      enqueuedDrafts.find((draft) => draft.type === 'DRIVER_PAYMENT_RESERVED'),
    ).toMatchObject({ userId: driver.id, application: 'DRIVER' });
    expect(
      enqueuedDrafts.find(
        (draft) => draft.type === 'PASSENGER_PAYMENT_RESERVED',
      ),
    ).toMatchObject({ userId: passenger.id, application: 'PASSENGER' });
  });

  it('confirmDeparture() sends no push (not a user-facing status)', async () => {
    const { service, prisma, enqueuedDrafts } = buildService();
    prisma.tripRow.status = TripStatus.DRIVER_SELECTED;

    await service.confirmDeparture(driver, TRIP_ID, 'key-1');

    expect(enqueuedDrafts).toHaveLength(0);
  });

  it('is idempotent: replaying the same action + Idempotency-Key never enqueues a second push', async () => {
    const { service, prisma, enqueuedDrafts } = buildService();
    prisma.tripRow.status = TripStatus.DRIVER_EN_ROUTE;

    await service.arrive(driver, TRIP_ID, 'same-key');
    // A second call with the same idempotency key short-circuits inside
    // execute() before ever reaching the notify step.
    await service.arrive(driver, TRIP_ID, 'same-key');

    expect(enqueuedDrafts).toHaveLength(1);
  });

  it('uses the lifecycle action id as the notification idempotencyKey', async () => {
    const { service, prisma, enqueuedDrafts } = buildService();
    prisma.tripRow.status = TripStatus.DRIVER_EN_ROUTE;

    await service.arrive(driver, TRIP_ID, 'key-1');

    expect(prisma.lifecycleActions).toHaveLength(1);
    const actionId = prisma.lifecycleActions[0]!.id;
    expect(enqueuedDrafts[0]!.deduplicationKey).toBe(`dedup:${actionId}`);
  });
});
