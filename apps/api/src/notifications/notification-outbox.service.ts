import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import {
  NotificationOutboxStatus,
  type Prisma,
} from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import type { NotificationDraft } from './notification.service.js';
import { NotificationTemplateService } from './templates/notification-template.service.js';

type OutboxClient =
  | Pick<Prisma.TransactionClient, 'notificationOutboxEvent'>
  | PrismaService;

interface OutboxPayload {
  title: string;
  body: string;
  deepLink: string | null;
  templateVersion: number;
  count: number;
}

/**
 * Turns a NotificationDraft into a NotificationOutboxEvent row, applying
 * the collapse strategy NotificationService assigned to the draft's type:
 *
 * - SUPERSEDE: cancels any still-PENDING row sharing the draft's
 *   collapseKey before inserting the new one (a fresher trip-status push
 *   replaces the stale one rather than stacking).
 * - COLLAPSE_COUNT: merges into an existing PENDING row of the same family
 *   by bumping its payload.count instead of creating a second row (bid
 *   offers become "N предложений", not one push per bid).
 * - NONE: always inserts independently.
 *
 * Idempotent the same way SmsWebhookService is (find-by-unique-key then
 * skip-if-present, not catching a unique-constraint error) — a reprocessed
 * domain event with the same deduplicationKey is a silent no-op, so
 * at-least-once delivery from callers never produces a duplicate push.
 */
@Injectable()
export class NotificationOutboxService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly templates: NotificationTemplateService,
    private readonly metrics: MetricsService,
  ) {}

  async enqueue(client: OutboxClient, draft: NotificationDraft): Promise<void> {
    const existingByDedupKey = await client.notificationOutboxEvent.findUnique({
      where: { deduplicationKey: draft.deduplicationKey },
    });
    if (existingByDedupKey) return;

    if (draft.collapseStrategy === 'SUPERSEDE') {
      await client.notificationOutboxEvent.updateMany({
        where: {
          collapseKey: draft.collapseKey,
          status: NotificationOutboxStatus.PENDING,
        },
        data: {
          status: NotificationOutboxStatus.CANCELLED,
          processedAt: new Date(),
        },
      });
    }

    if (draft.collapseStrategy === 'COLLAPSE_COUNT') {
      const existingPending = await client.notificationOutboxEvent.findFirst({
        where: {
          collapseKey: draft.collapseKey,
          status: NotificationOutboxStatus.PENDING,
        },
      });
      if (existingPending) {
        const existingPayload =
          existingPending.payload as unknown as OutboxPayload;
        const count = existingPayload.count + 1;
        // Re-render so the copy actually reflects the new count ("3 новых
        // предложений", not a stale "новое предложение" with a count field
        // nobody reads) — the deepLink is kept as-is (rendering again
        // without the original tripId/etc. params would blank it out).
        const rerendered = this.templates.render(existingPending.type, {
          count,
        });
        await client.notificationOutboxEvent.update({
          where: { id: existingPending.id },
          data: {
            payload: {
              ...existingPayload,
              title: rerendered.title,
              body: rerendered.body,
              count,
            } as Prisma.InputJsonObject,
          },
        });
        return;
      }
    }

    const maxAttempts = this.config.getOrThrow<number>('push.maxAttempts');
    const payload: OutboxPayload = {
      title: draft.title,
      body: draft.body,
      deepLink: draft.deepLink,
      templateVersion: draft.templateVersion,
      count: 1,
    };

    await client.notificationOutboxEvent.create({
      data: {
        type: draft.type,
        userId: draft.userId,
        application: draft.application,
        entityType: draft.entityType,
        entityId: draft.entityId,
        payload: payload as unknown as Prisma.InputJsonObject,
        priority: draft.priority,
        deduplicationKey: draft.deduplicationKey,
        collapseKey: draft.collapseKey,
        status: NotificationOutboxStatus.PENDING,
        maxAttempts,
        expiresAt: new Date(Date.now() + draft.ttlSeconds * 1_000),
      },
    });
    this.metrics.increment(
      'notifications_queued_total',
      'Outbox events newly queued for push delivery, by type/application',
      { type: draft.type, application: draft.application },
    );
  }

  /**
   * Cancels every still-PENDING row of `type` for `entityId`, regardless of
   * which user/collapseKey it belongs to — the cross-driver counterpart to
   * enqueue()'s same-collapseKey SUPERSEDE. Used when a trip's dispatch
   * concludes: every candidate driver who hadn't yet been sent (or hadn't
   * yet opened) their DRIVER_NEW_TRIP_AVAILABLE push for this trip should
   * stop getting it once another driver is chosen.
   */
  async cancelPendingForEntity(
    client: OutboxClient,
    type: NotificationDraft['type'],
    entityId: string,
    options?: { exceptUserId?: string },
  ): Promise<void> {
    await client.notificationOutboxEvent.updateMany({
      where: {
        type,
        entityId,
        status: NotificationOutboxStatus.PENDING,
        ...(options?.exceptUserId
          ? { userId: { not: options.exceptUserId } }
          : {}),
      },
      data: {
        status: NotificationOutboxStatus.CANCELLED,
        processedAt: new Date(),
      },
    });
  }
}
