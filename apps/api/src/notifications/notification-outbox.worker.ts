import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushDataPayloadSchema } from '@resilient-taxi/contracts';

import { PrismaService } from '../database/prisma.service.js';
import {
  NotificationDeliveryStatus,
  NotificationOutboxStatus,
  NotificationStatus,
} from '../generated/prisma/client.js';
import type {
  NotificationOutboxStatus as NotificationOutboxStatusType,
  NotificationPriority,
  NotificationType,
  PushApplication,
  PushProviderType,
} from '../generated/prisma/enums.js';
import type { SendOutcomeStatus } from './domain/push-provider.interface.js';
import { MetricsService } from '../observability/metrics.service.js';
import { NotificationPreferenceService } from './notification-preference.service.js';
import { PushProviderResolver } from './providers/push-provider.resolver.js';
import { DevicePushTokenRepository } from './repositories/device-push-token.repository.js';
import { NotificationTemplateService } from './templates/notification-template.service.js';

interface OutboxEventRow {
  id: string;
  type: NotificationType;
  userId: string;
  application: PushApplication;
  entityType: string;
  entityId: string | null;
  payload: unknown;
  priority: NotificationPriority;
  deduplicationKey: string;
  status: NotificationOutboxStatusType;
  attempts: number;
  maxAttempts: number;
  expiresAt: Date | null;
}

interface OutboxPayload {
  title: string;
  body: string;
  deepLink: string | null;
  templateVersion: number;
  count: number;
}

/** A claim visibility window: how long a PROCESSING row is presumed "owned" by whichever worker claimed it before another worker is allowed to reclaim it (crash recovery), mirroring RealtimeOutboxService's own 30s window. */
const CLAIM_VISIBILITY_MS = 30_000;
const BATCH_SIZE = 20;

function pushPriorityFor(priority: NotificationPriority): 'NORMAL' | 'HIGH' {
  return priority === 'NORMAL' ? 'NORMAL' : 'HIGH';
}

/**
 * Polls NotificationOutboxEvent, claims rows with the same optimistic
 * conditional-updateMany pattern RealtimeOutboxService uses (no
 * `SELECT ... FOR UPDATE`), and drives each claimed event through:
 * expire-silently (past TTL) -> resolve active device targets -> send via
 * the resolved PushProvider(s) -> record a Notification + one
 * NotificationDelivery row per target -> DELIVERED, or retry with
 * exponential backoff+jitter up to maxAttempts, then DEAD_LETTER.
 */
@Injectable()
export class NotificationOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationOutboxWorker.name);
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly devicePushTokens: DevicePushTokenRepository,
    private readonly providerResolver: PushProviderResolver,
    private readonly metrics: MetricsService,
    private readonly preferences: NotificationPreferenceService,
    private readonly templates: NotificationTemplateService,
  ) {}

  onModuleInit(): void {
    if (this.config.getOrThrow<string>('app.environment') === 'test') {
      return;
    }
    const intervalMs = this.config.getOrThrow<number>(
      'push.outboxPollIntervalMs',
    );
    this.pollTimer = setInterval(() => {
      void this.processPending().catch((error: unknown) => {
        this.logger.error({ event: 'push.outbox_dispatch_failed', error });
      });
    }, intervalMs);
    this.pollTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  /** Used by HealthService's readiness check, same convention as RealtimeOutboxService.isRunning(). */
  isRunning(): boolean {
    if (this.config.getOrThrow<string>('app.environment') === 'test') {
      return true;
    }
    return this.pollTimer !== undefined;
  }

  async processPending(): Promise<void> {
    const now = new Date();
    await this.refreshGauges(now);

    // Crash recovery: a row stuck PROCESSING past its claim window is
    // presumed abandoned by whichever worker claimed it and made
    // reclaimable again.
    await this.prisma.notificationOutboxEvent.updateMany({
      where: {
        status: NotificationOutboxStatus.PROCESSING,
        availableAt: { lte: now },
      },
      data: { status: NotificationOutboxStatus.PENDING },
    });

    const events = await this.prisma.notificationOutboxEvent.findMany({
      where: {
        status: NotificationOutboxStatus.PENDING,
        availableAt: { lte: now },
      },
      orderBy: [{ createdAt: 'asc' }],
      take: BATCH_SIZE,
    });

    for (const event of events) {
      const claimed = await this.prisma.notificationOutboxEvent.updateMany({
        where: { id: event.id, status: NotificationOutboxStatus.PENDING },
        data: {
          status: NotificationOutboxStatus.PROCESSING,
          attempts: { increment: 1 },
          availableAt: new Date(Date.now() + CLAIM_VISIBILITY_MS),
        },
      });
      if (claimed.count !== 1) continue;

      const refreshed = await this.prisma.notificationOutboxEvent.findUnique({
        where: { id: event.id },
      });
      if (!refreshed) continue;

      await this.processOne(refreshed as unknown as OutboxEventRow);
    }
  }

  private async processOne(event: OutboxEventRow): Promise<void> {
    if (event.expiresAt && event.expiresAt.getTime() <= Date.now()) {
      // Expires silently — no push, no error, no retry. A new-order offer
      // nobody could respond to in time is simply gone, not a failure.
      await this.prisma.notificationOutboxEvent.update({
        where: { id: event.id },
        data: {
          status: NotificationOutboxStatus.EXPIRED,
          processedAt: new Date(),
        },
      });
      return;
    }

    const category = this.templates.categoryFor(event.type);
    const pushEnabled = await this.preferences.isPushEnabled(
      event.userId,
      event.application,
      category,
    );
    if (!pushEnabled) {
      // The Notification row still exists (still shows up in the in-app
      // inbox) — the user disabled the *push channel* for this category,
      // not the underlying event's visibility.
      const payload = event.payload as unknown as OutboxPayload;
      const notification = await this.upsertNotification(event, payload);
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: NotificationStatus.CANCELLED },
      });
      await this.prisma.notificationOutboxEvent.update({
        where: { id: event.id },
        data: {
          status: NotificationOutboxStatus.DELIVERED,
          processedAt: new Date(),
          notificationId: notification.id,
        },
      });
      return;
    }

    try {
      const result = await this.sendEvent(event);
      if (result.outcome === 'DELIVERED') {
        await this.prisma.notificationOutboxEvent.update({
          where: { id: event.id },
          data: {
            status: NotificationOutboxStatus.DELIVERED,
            processedAt: new Date(),
            notificationId: result.notificationId,
          },
        });
      } else {
        await this.retryOrDeadLetter(
          event,
          result.outcome,
          result.notificationId,
        );
      }
    } catch (error) {
      await this.retryOrDeadLetter(
        event,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** `outcome` is 'DELIVERED' on at least one accepted send, otherwise the failure reason for retryOrDeadLetter. */
  private async sendEvent(
    event: OutboxEventRow,
  ): Promise<{ outcome: 'DELIVERED' | string; notificationId: string }> {
    const payload = event.payload as unknown as OutboxPayload;

    const notification = await this.upsertNotification(event, payload);

    const targets = await this.devicePushTokens.listActiveTargetsForUser(
      event.userId,
      event.application,
    );
    if (!targets.length) {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: NotificationStatus.FAILED, failedAt: new Date() },
      });
      return {
        outcome: 'no active device tokens for this user',
        notificationId: notification.id,
      };
    }

    const dataPayload = PushDataPayloadSchema.parse({
      notificationId: notification.id,
      type: event.type,
      ...(event.entityType === 'TRIP' && event.entityId
        ? { tripId: event.entityId }
        : {}),
      ...(event.entityType === 'PAYMENT' && event.entityId
        ? { paymentId: event.entityId }
        : {}),
      sequence: notification.createdAt.getTime(),
      ...(payload.deepLink ? { deepLink: payload.deepLink } : {}),
      occurredAt: notification.createdAt.toISOString(),
    });
    const wireData: Record<string, string> = Object.fromEntries(
      Object.entries(dataPayload)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)]),
    );

    const byProvider = new Map<PushProviderType, typeof targets>();
    for (const target of targets) {
      const group = byProvider.get(target.provider) ?? [];
      group.push(target);
      byProvider.set(target.provider, group);
    }

    let anyAccepted = false;
    let anyTemporaryFailure = false;

    for (const [providerType, group] of byProvider) {
      const provider = this.providerResolver.resolve(providerType);
      const startedAt = Date.now();
      const result = await provider.sendToDevices({
        targets: group.map((target) => ({
          devicePushTokenId: target.devicePushTokenId,
          rawToken: target.rawToken,
          platform: target.platform,
        })),
        title: payload.title,
        body: payload.body,
        data: wireData,
        priority: pushPriorityFor(event.priority),
        ttlSeconds: Math.max(
          1,
          Math.round((event.expiresAt!.getTime() - Date.now()) / 1_000),
        ),
      });
      this.metrics.setGauge(
        'push_provider_latency_ms',
        'Time taken by the last push provider send call, in milliseconds',
        { provider: providerType },
        Date.now() - startedAt,
      );

      for (const sendResult of result.results) {
        this.metrics.increment(
          'push_send_attempts_total',
          'Push send attempts by provider/application/platform/type/result',
          {
            provider: providerType,
            application: event.application,
            type: event.type,
            result: sendResult.status,
          },
        );

        await this.prisma.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            devicePushTokenId: sendResult.devicePushTokenId,
            provider: providerType,
            ...(sendResult.providerMessageId
              ? { providerMessageId: sendResult.providerMessageId }
              : {}),
            attempt: event.attempts,
            status: this.deliveryStatusFor(sendResult.status),
            ...(sendResult.errorCode
              ? { errorCode: sendResult.errorCode }
              : {}),
            sentAt: sendResult.status === 'ACCEPTED' ? new Date() : null,
            failedAt: sendResult.status === 'ACCEPTED' ? null : new Date(),
          },
        });

        if (sendResult.status === 'ACCEPTED') {
          anyAccepted = true;
          this.metrics.increment(
            'push_provider_accepted_total',
            'Push sends accepted by the provider',
            { provider: providerType, application: event.application },
          );
        } else if (sendResult.status === 'TOKEN_INVALID') {
          await this.devicePushTokens.markInvalid(
            sendResult.devicePushTokenId,
            'PROVIDER_REPORTED_INVALID',
          );
          this.metrics.increment(
            'push_invalid_token_total',
            'Push tokens the provider reported as invalid',
            { provider: providerType, application: event.application },
          );
        } else if (sendResult.status === 'FAILED_TEMPORARY') {
          anyTemporaryFailure = true;
          this.metrics.increment(
            'push_failed_total',
            'Push send attempts that failed (temporarily or permanently)',
            {
              provider: providerType,
              application: event.application,
              result: 'temporary',
            },
          );
        } else if (sendResult.status === 'FAILED_PERMANENT') {
          this.metrics.increment(
            'push_failed_total',
            'Push send attempts that failed (temporarily or permanently)',
            {
              provider: providerType,
              application: event.application,
              result: 'permanent',
            },
          );
        }
      }
    }

    if (anyAccepted) {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: anyTemporaryFailure
            ? NotificationStatus.PARTIALLY_SENT
            : NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
      return { outcome: 'DELIVERED', notificationId: notification.id };
    }

    await this.prisma.notification.update({
      where: { id: notification.id },
      data: { status: NotificationStatus.FAILED, failedAt: new Date() },
    });
    return {
      outcome: anyTemporaryFailure
        ? 'temporary provider failure on every target'
        : 'no target accepted the push (invalid tokens or permanent failure)',
      notificationId: notification.id,
    };
  }

  /**
   * Refreshes the two gauges that only make sense as a point-in-time
   * snapshot rather than a per-event counter: how many device tokens are
   * currently active (by application/platform) and how stale the oldest
   * still-unprocessed PENDING row is. Run once per poll tick rather than
   * per event, since both are cheap aggregate queries.
   */
  private async refreshGauges(now: Date): Promise<void> {
    const oldestPending = await this.prisma.notificationOutboxEvent.findFirst({
      where: { status: NotificationOutboxStatus.PENDING },
      orderBy: { createdAt: 'asc' },
    });
    this.metrics.setGauge(
      'notification_outbox_lag_seconds',
      'Age in seconds of the oldest still-PENDING outbox event',
      {},
      oldestPending
        ? Math.max(
            0,
            (now.getTime() - oldestPending.createdAt.getTime()) / 1_000,
          )
        : 0,
    );

    const activeCounts =
      await this.devicePushTokens.countActiveByApplicationAndPlatform();
    for (const { application, platform, count } of activeCounts) {
      this.metrics.setGauge(
        'active_push_tokens',
        'Currently ACTIVE device push tokens by application/platform',
        { application, platform },
        count,
      );
    }
  }

  private async upsertNotification(
    event: OutboxEventRow,
    payload: OutboxPayload,
  ) {
    const existing = await this.prisma.notification.findUnique({
      where: { deduplicationKey: event.deduplicationKey },
    });
    if (existing) return existing;

    const created = await this.prisma.notification.create({
      data: {
        userId: event.userId,
        type: event.type,
        application: event.application,
        entityType: event.entityType,
        entityId: event.entityId,
        titleTemplate: payload.title,
        bodyTemplate: payload.body,
        templateVersion: payload.templateVersion,
        payload: payload as never,
        status: NotificationStatus.QUEUED,
        priority: event.priority,
        deduplicationKey: event.deduplicationKey,
        scheduledAt: new Date(),
        ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
      },
    });
    this.metrics.increment(
      'notifications_created_total',
      'Notification rows created from an outbox event',
      { type: event.type, application: event.application },
    );
    return created;
  }

  private deliveryStatusFor(
    status: SendOutcomeStatus,
  ): NotificationDeliveryStatus {
    switch (status) {
      case 'ACCEPTED':
        return NotificationDeliveryStatus.PROVIDER_ACCEPTED;
      case 'TOKEN_INVALID':
        return NotificationDeliveryStatus.TOKEN_INVALID;
      case 'FAILED_TEMPORARY':
        return NotificationDeliveryStatus.FAILED_TEMPORARY;
      case 'FAILED_PERMANENT':
        return NotificationDeliveryStatus.FAILED_PERMANENT;
    }
  }

  private async retryOrDeadLetter(
    event: OutboxEventRow,
    reason: string,
    notificationId?: string,
  ): Promise<void> {
    const lastError = reason.slice(0, 512);

    if (event.attempts >= event.maxAttempts) {
      await this.prisma.notificationOutboxEvent.update({
        where: { id: event.id },
        data: {
          status: NotificationOutboxStatus.DEAD_LETTER,
          lastError,
          processedAt: new Date(),
          ...(notificationId ? { notificationId } : {}),
        },
      });
      this.metrics.increment(
        'push_dead_letter_total',
        'Outbox events that exhausted every retry attempt',
        { type: event.type, application: event.application },
      );
      return;
    }

    const initialDelaySeconds = this.config.getOrThrow<number>(
      'push.initialRetryDelaySeconds',
    );
    const maxDelaySeconds = this.config.getOrThrow<number>(
      'push.maxRetryDelaySeconds',
    );
    const backoffSeconds = Math.min(
      maxDelaySeconds,
      initialDelaySeconds * 2 ** (event.attempts - 1),
    );
    const jitteredSeconds = backoffSeconds * (0.5 + Math.random() * 0.5);

    await this.prisma.notificationOutboxEvent.update({
      where: { id: event.id },
      data: {
        status: NotificationOutboxStatus.PENDING,
        availableAt: new Date(Date.now() + jitteredSeconds * 1_000),
        lastError,
        ...(notificationId ? { notificationId } : {}),
      },
    });
    this.metrics.increment(
      'push_retry_total',
      'Outbox events scheduled for another retry attempt',
      { type: event.type, application: event.application },
    );
  }
}
