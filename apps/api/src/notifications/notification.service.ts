import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  NotificationPriority,
  NotificationType,
} from '../generated/prisma/enums.js';
import type { PushApplication } from '../generated/prisma/enums.js';
import {
  NotificationTemplateService,
  type NotificationTemplateParams,
} from './templates/notification-template.service.js';

/**
 * NONE: every notification is delivered independently (e.g. a payout).
 * SUPERSEDE: a new draft for the same (userId, type, entityId) cancels a
 *   not-yet-sent earlier one of the same type rather than stacking — trip
 *   status pushes (section 12: a new status replaces the old, not-yet-sent
 *   notification of the same type).
 * COLLAPSE_COUNT: repeated events for the same (userId, type, entityId)
 *   within the outbox debounce window merge into a single "N предложений"
 *   notification instead of one push per event (bid offers).
 * Applying SUPERSEDE/COLLAPSE_COUNT against existing outbox rows is the
 * outbox integration's job (NotificationOutboxService) — this service only
 * decides *which* strategy a type uses and computes the keys that decision
 * needs.
 */
export type NotificationCollapseStrategy =
  | 'NONE'
  | 'SUPERSEDE'
  | 'COLLAPSE_COUNT';

export interface NotificationDraft {
  userId: string;
  type: NotificationType;
  application: PushApplication;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  templateVersion: number;
  deepLink: string | null;
  priority: NotificationPriority;
  ttlSeconds: number;
  collapseStrategy: NotificationCollapseStrategy;
  /** Identifies the "family" a SUPERSEDE/COLLAPSE_COUNT draft belongs to — never includes a per-event id like bidId, so repeated events for the same entity share it. */
  collapseKey: string;
  /** Unique per underlying domain event — prevents a reprocessed outbox/domain event from creating a second push for the same thing (at-least-once delivery, exactly-once notification). */
  deduplicationKey: string;
}

export interface CreateDraftInput {
  userId: string;
  type: NotificationType;
  application: PushApplication;
  entityType: string;
  entityId: string;
  /** Identifies the specific domain event (e.g. a trip-lifecycle action id, a bid id, a payment webhook event id) — distinct from entityId, which identifies the trip/payment/etc the notification is *about*. */
  idempotencyKey: string;
  templateParams?: NotificationTemplateParams;
}

/** Reserved for SECURITY_SESSION_REVOKED — never assigned to an ordinary trip/payment notification. */
const CRITICAL_TYPES = new Set<NotificationType>([
  NotificationType.SECURITY_SESSION_REVOKED,
]);

/** High-priority, time-sensitive: a new order to respond to, or an in-progress trip's status just changed. */
const HIGH_PRIORITY_TYPES = new Set<NotificationType>([
  NotificationType.DRIVER_NEW_TRIP_AVAILABLE,
  NotificationType.DRIVER_BID_ACCEPTED,
  NotificationType.DRIVER_TRIP_CANCELLED,
  NotificationType.DRIVER_PAYMENT_RESERVED,
  NotificationType.DRIVER_PICKUP_REMINDER,
  NotificationType.PASSENGER_BID_RECEIVED,
  NotificationType.PASSENGER_DRIVER_SELECTED,
  NotificationType.PASSENGER_DRIVER_EN_ROUTE,
  NotificationType.PASSENGER_DRIVER_ARRIVED,
  NotificationType.PASSENGER_TRIP_STARTED,
  NotificationType.PASSENGER_TRIP_CANCELLED,
]);

type TtlBucket = 'NEW_ORDER' | 'ACTIVE_TRIP' | 'LONG';

const TTL_BUCKET_BY_TYPE: Record<NotificationType, TtlBucket> = {
  [NotificationType.DRIVER_NEW_TRIP_AVAILABLE]: 'NEW_ORDER',
  [NotificationType.DRIVER_BID_ACCEPTED]: 'ACTIVE_TRIP',
  [NotificationType.DRIVER_BID_REJECTED]: 'ACTIVE_TRIP',
  [NotificationType.DRIVER_TRIP_CANCELLED]: 'ACTIVE_TRIP',
  [NotificationType.DRIVER_PAYMENT_RESERVED]: 'ACTIVE_TRIP',
  [NotificationType.DRIVER_PICKUP_REMINDER]: 'ACTIVE_TRIP',
  [NotificationType.DRIVER_LOCATION_DEGRADED]: 'LONG',
  [NotificationType.DRIVER_DOCUMENT_EXPIRING]: 'LONG',
  [NotificationType.DRIVER_ACCOUNT_APPROVED]: 'LONG',
  [NotificationType.DRIVER_ACCOUNT_REJECTED]: 'LONG',
  [NotificationType.DRIVER_PAYOUT_COMPLETED]: 'LONG',
  [NotificationType.DRIVER_PAYOUT_FAILED]: 'LONG',
  [NotificationType.PASSENGER_BID_RECEIVED]: 'ACTIVE_TRIP',
  [NotificationType.PASSENGER_DRIVER_SELECTED]: 'ACTIVE_TRIP',
  [NotificationType.PASSENGER_DRIVER_EN_ROUTE]: 'ACTIVE_TRIP',
  [NotificationType.PASSENGER_DRIVER_ARRIVED]: 'ACTIVE_TRIP',
  [NotificationType.PASSENGER_TRIP_STARTED]: 'ACTIVE_TRIP',
  [NotificationType.PASSENGER_TRIP_COMPLETED]: 'ACTIVE_TRIP',
  [NotificationType.PASSENGER_TRIP_CANCELLED]: 'ACTIVE_TRIP',
  [NotificationType.PASSENGER_PAYMENT_RESERVED]: 'ACTIVE_TRIP',
  [NotificationType.PASSENGER_PAYMENT_FAILED]: 'LONG',
  [NotificationType.PASSENGER_REFUND_COMPLETED]: 'LONG',
  [NotificationType.SECURITY_SESSION_REVOKED]: 'LONG',
  [NotificationType.SYSTEM_SERVICE_NOTICE]: 'LONG',
};

const COLLAPSE_STRATEGY_BY_TYPE: Record<
  NotificationType,
  NotificationCollapseStrategy
> = {
  [NotificationType.DRIVER_NEW_TRIP_AVAILABLE]: 'SUPERSEDE',
  [NotificationType.DRIVER_BID_ACCEPTED]: 'NONE',
  [NotificationType.DRIVER_BID_REJECTED]: 'NONE',
  [NotificationType.DRIVER_TRIP_CANCELLED]: 'SUPERSEDE',
  [NotificationType.DRIVER_PAYMENT_RESERVED]: 'SUPERSEDE',
  [NotificationType.DRIVER_PICKUP_REMINDER]: 'SUPERSEDE',
  [NotificationType.DRIVER_LOCATION_DEGRADED]: 'NONE',
  [NotificationType.DRIVER_DOCUMENT_EXPIRING]: 'NONE',
  [NotificationType.DRIVER_ACCOUNT_APPROVED]: 'NONE',
  [NotificationType.DRIVER_ACCOUNT_REJECTED]: 'NONE',
  [NotificationType.DRIVER_PAYOUT_COMPLETED]: 'NONE',
  [NotificationType.DRIVER_PAYOUT_FAILED]: 'NONE',
  [NotificationType.PASSENGER_BID_RECEIVED]: 'COLLAPSE_COUNT',
  [NotificationType.PASSENGER_DRIVER_SELECTED]: 'SUPERSEDE',
  [NotificationType.PASSENGER_DRIVER_EN_ROUTE]: 'SUPERSEDE',
  [NotificationType.PASSENGER_DRIVER_ARRIVED]: 'SUPERSEDE',
  [NotificationType.PASSENGER_TRIP_STARTED]: 'SUPERSEDE',
  [NotificationType.PASSENGER_TRIP_COMPLETED]: 'SUPERSEDE',
  [NotificationType.PASSENGER_TRIP_CANCELLED]: 'SUPERSEDE',
  [NotificationType.PASSENGER_PAYMENT_RESERVED]: 'SUPERSEDE',
  [NotificationType.PASSENGER_PAYMENT_FAILED]: 'NONE',
  [NotificationType.PASSENGER_REFUND_COMPLETED]: 'NONE',
  [NotificationType.SECURITY_SESSION_REVOKED]: 'NONE',
  [NotificationType.SYSTEM_SERVICE_NOTICE]: 'NONE',
};

/**
 * Pure domain policy: given a NotificationType, decides priority, TTL,
 * and collapse behavior, and renders the copy via NotificationTemplateService.
 * Deliberately has no DB/outbox dependency — NotificationOutboxService
 * (the transactional-outbox integration) uses the NotificationDraft this
 * produces to decide what to insert/supersede/merge.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly config: ConfigService,
    private readonly templates: NotificationTemplateService,
  ) {}

  resolvePriority(type: NotificationType): NotificationPriority {
    if (CRITICAL_TYPES.has(type)) return NotificationPriority.CRITICAL;
    if (HIGH_PRIORITY_TYPES.has(type)) return NotificationPriority.HIGH;
    return NotificationPriority.NORMAL;
  }

  resolveTtlSeconds(type: NotificationType): number {
    switch (TTL_BUCKET_BY_TYPE[type]) {
      case 'NEW_ORDER':
        return this.config.getOrThrow<number>('push.ttl.newOrderSeconds');
      case 'ACTIVE_TRIP':
        return this.config.getOrThrow<number>('push.ttl.activeTripSeconds');
      case 'LONG':
        return this.config.getOrThrow<number>('push.ttl.paymentSeconds');
    }
  }

  resolveCollapseStrategy(
    type: NotificationType,
  ): NotificationCollapseStrategy {
    return COLLAPSE_STRATEGY_BY_TYPE[type];
  }

  computeCollapseKey(
    userId: string,
    type: NotificationType,
    entityId: string,
  ): string {
    return createHash('sha256')
      .update(`${userId}:${type}:${entityId}`)
      .digest('hex');
  }

  computeDeduplicationKey(
    userId: string,
    type: NotificationType,
    entityId: string,
    idempotencyKey: string,
  ): string {
    return createHash('sha256')
      .update(`${userId}:${type}:${entityId}:${idempotencyKey}`)
      .digest('hex');
  }

  createDraft(input: CreateDraftInput): NotificationDraft {
    const rendered = this.templates.render(input.type, input.templateParams);

    return {
      userId: input.userId,
      type: input.type,
      application: input.application,
      entityType: input.entityType,
      entityId: input.entityId,
      title: rendered.title,
      body: rendered.body,
      templateVersion: rendered.templateVersion,
      deepLink: rendered.deepLink,
      priority: this.resolvePriority(input.type),
      ttlSeconds: this.resolveTtlSeconds(input.type),
      collapseStrategy: this.resolveCollapseStrategy(input.type),
      collapseKey: this.computeCollapseKey(
        input.userId,
        input.type,
        input.entityId,
      ),
      deduplicationKey: this.computeDeduplicationKey(
        input.userId,
        input.type,
        input.entityId,
        input.idempotencyKey,
      ),
    };
  }
}
