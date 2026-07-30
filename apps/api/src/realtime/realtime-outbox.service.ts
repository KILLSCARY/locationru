import { randomUUID } from 'node:crypto';

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import {
  type Prisma,
  RealtimeEventType,
  RealtimeOutboxStatus,
} from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';
import type { RealtimeEnvelope } from './realtime-event.types.js';
import { tripRoom, userRoom } from './realtime-event.types.js';

type OutboxClient =
  | Pick<
      Prisma.TransactionClient,
      'realtimeOutboxEvent' | 'realtimeRoomSequence'
    >
  | PrismaService;

type RealtimePublisher = (event: RealtimeEnvelope) => Promise<void> | void;

@Injectable()
export class RealtimeOutboxService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(RealtimeOutboxService.name);
  private pollTimer: NodeJS.Timeout | undefined;
  private publisher: RealtimePublisher | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    if (this.configService.getOrThrow<string>('app.environment') === 'test') {
      return;
    }

    const intervalMs = this.configService.getOrThrow<number>(
      'realtime.outboxPollIntervalMs',
    );
    this.pollTimer = setInterval(() => {
      void this.dispatchPending().catch((error: unknown) => {
        this.logger.error({ event: 'realtime.outbox_dispatch_failed', error });
      });
    }, intervalMs);
    this.pollTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  attachPublisher(publisher: RealtimePublisher): void {
    this.publisher = publisher;
  }

  async enqueueTripEvent(
    client: OutboxClient,
    tripId: string,
    eventType: RealtimeEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.enqueueRoomEvent(client, tripRoom(tripId), eventType, payload);
  }

  async enqueueUserEvent(
    client: OutboxClient,
    userId: string,
    eventType: RealtimeEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.enqueueRoomEvent(client, userRoom(userId), eventType, payload);
  }

  async enqueueDriverLocationUpdate(
    input: {
      accuracyMeters: number;
      driverId: string;
      latitude: number;
      longitude: number;
      recordedAt: string;
    },
    /** Trip the driver is currently assigned to, if any — see below. */
    activeTripId?: string | null,
  ): Promise<void> {
    const interval = this.configService.getOrThrow<number>(
      'realtime.locationEventIntervalSeconds',
    );
    const accepted = await this.redis.setIfNotExistsWithTtl(
      `realtime:driver-location:${input.driverId}`,
      '1',
      interval,
    );
    if (!accepted) return;

    await this.enqueueUserEvent(
      this.prisma,
      input.driverId,
      RealtimeEventType.DRIVER_LOCATION_UPDATED,
      input,
    );

    // Also publish to the trip room so the assigned passenger can render the
    // driver's marker; the passenger never joins the driver's own user room.
    if (activeTripId) {
      await this.enqueueTripEvent(
        this.prisma,
        activeTripId,
        RealtimeEventType.DRIVER_LOCATION_UPDATED,
        input,
      );
    }
  }

  async getLastSequence(room: string): Promise<number> {
    const sequence = await this.prisma.realtimeRoomSequence.findUnique({
      where: { room },
      select: { lastValue: true },
    });
    return sequence?.lastValue ?? 0;
  }

  async getDeliveredEventsAfter(
    room: string,
    afterSequence: number,
  ): Promise<RealtimeEnvelope[]> {
    const events = await this.prisma.realtimeOutboxEvent.findMany({
      where: {
        room,
        sequence: { gt: afterSequence },
        status: RealtimeOutboxStatus.DELIVERED,
      },
      orderBy: { sequence: 'asc' },
      take: 100,
    });

    return events.map((event) => ({
      eventId: event.id,
      eventType: event.eventType,
      room: event.room,
      sequence: event.sequence,
      occurredAt: event.createdAt.toISOString(),
      payload: event.payload,
    }));
  }

  async dispatchPending(): Promise<void> {
    if (!this.publisher) return;

    const now = new Date();
    await this.prisma.realtimeOutboxEvent.updateMany({
      where: {
        status: RealtimeOutboxStatus.PROCESSING,
        availableAt: { lte: now },
      },
      data: { status: RealtimeOutboxStatus.PENDING },
    });
    const events = await this.prisma.realtimeOutboxEvent.findMany({
      where: {
        status: RealtimeOutboxStatus.PENDING,
        availableAt: { lte: now },
      },
      orderBy: [{ createdAt: 'asc' }, { sequence: 'asc' }],
      take: 100,
    });

    for (const event of events) {
      const claimed = await this.prisma.realtimeOutboxEvent.updateMany({
        where: { id: event.id, status: RealtimeOutboxStatus.PENDING },
        data: {
          status: RealtimeOutboxStatus.PROCESSING,
          attempts: { increment: 1 },
          availableAt: new Date(Date.now() + 30_000),
        },
      });
      if (claimed.count !== 1) continue;

      try {
        await this.publisher({
          eventId: event.id,
          eventType: event.eventType,
          room: event.room,
          sequence: event.sequence,
          occurredAt: event.createdAt.toISOString(),
          payload: event.payload,
        });
        await this.prisma.realtimeOutboxEvent.update({
          where: { id: event.id },
          data: {
            status: RealtimeOutboxStatus.DELIVERED,
            deliveredAt: new Date(),
          },
        });
      } catch (error) {
        const retryDelayMs = Math.min(60_000, 1_000 * 2 ** event.attempts);
        await this.prisma.realtimeOutboxEvent.update({
          where: { id: event.id },
          data: {
            status: RealtimeOutboxStatus.PENDING,
            availableAt: new Date(Date.now() + retryDelayMs),
          },
        });
        this.logger.warn({
          event: 'realtime.outbox_publish_retry',
          eventId: event.id,
          error,
        });
      }
    }
  }

  private async enqueueRoomEvent(
    client: OutboxClient,
    room: string,
    eventType: RealtimeEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sequence = await client.realtimeRoomSequence.upsert({
      where: { room },
      create: { room, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
      select: { lastValue: true },
    });
    await client.realtimeOutboxEvent.create({
      data: {
        id: randomUUID(),
        room,
        eventType,
        sequence: sequence.lastValue,
        payload: payload as Prisma.InputJsonObject,
      },
    });
  }
}
