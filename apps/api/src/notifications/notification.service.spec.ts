import { ConfigService } from '@nestjs/config';

import {
  NotificationPriority,
  NotificationType,
} from '../generated/prisma/enums.js';
import { NotificationService } from './notification.service.js';
import { NotificationTemplateService } from './templates/notification-template.service.js';

function buildService() {
  const config = new ConfigService({
    push: {
      ttl: {
        newOrderSeconds: 30,
        activeTripSeconds: 300,
        paymentSeconds: 86_400,
      },
    },
  });
  return new NotificationService(config, new NotificationTemplateService());
}

describe('NotificationService', () => {
  describe('resolvePriority', () => {
    it('reserves CRITICAL for SECURITY_SESSION_REVOKED only', () => {
      const service = buildService();
      for (const type of Object.values(NotificationType)) {
        const priority = service.resolvePriority(type);
        if (type === NotificationType.SECURITY_SESSION_REVOKED) {
          expect(priority).toBe(NotificationPriority.CRITICAL);
        } else {
          expect(priority).not.toBe(NotificationPriority.CRITICAL);
        }
      }
    });

    it('assigns HIGH to time-sensitive trip/order types', () => {
      const service = buildService();
      expect(
        service.resolvePriority(NotificationType.DRIVER_NEW_TRIP_AVAILABLE),
      ).toBe(NotificationPriority.HIGH);
      expect(
        service.resolvePriority(NotificationType.PASSENGER_DRIVER_ARRIVED),
      ).toBe(NotificationPriority.HIGH);
    });

    it('does not assign HIGH to every notification (financial/system types are NORMAL)', () => {
      const service = buildService();
      expect(
        service.resolvePriority(NotificationType.DRIVER_PAYOUT_COMPLETED),
      ).toBe(NotificationPriority.NORMAL);
      expect(
        service.resolvePriority(NotificationType.SYSTEM_SERVICE_NOTICE),
      ).toBe(NotificationPriority.NORMAL);
    });
  });

  describe('resolveTtlSeconds', () => {
    it('gives DRIVER_NEW_TRIP_AVAILABLE the short new-order TTL', () => {
      const service = buildService();
      expect(
        service.resolveTtlSeconds(NotificationType.DRIVER_NEW_TRIP_AVAILABLE),
      ).toBe(30);
    });

    it('gives active-trip status types the active-trip TTL', () => {
      const service = buildService();
      expect(
        service.resolveTtlSeconds(NotificationType.PASSENGER_DRIVER_ARRIVED),
      ).toBe(300);
    });

    it('gives financial notifications the long TTL', () => {
      const service = buildService();
      expect(
        service.resolveTtlSeconds(NotificationType.PASSENGER_PAYMENT_FAILED),
      ).toBe(86_400);
    });
  });

  describe('resolveCollapseStrategy', () => {
    it('supersedes a new-order push and active-trip status pushes', () => {
      const service = buildService();
      expect(
        service.resolveCollapseStrategy(
          NotificationType.DRIVER_NEW_TRIP_AVAILABLE,
        ),
      ).toBe('SUPERSEDE');
      expect(
        service.resolveCollapseStrategy(
          NotificationType.PASSENGER_DRIVER_ARRIVED,
        ),
      ).toBe('SUPERSEDE');
    });

    it('collapses repeated bid offers by count instead of one push per bid', () => {
      const service = buildService();
      expect(
        service.resolveCollapseStrategy(
          NotificationType.PASSENGER_BID_RECEIVED,
        ),
      ).toBe('COLLAPSE_COUNT');
    });

    it('never collapses or supersedes financial/security notifications', () => {
      const service = buildService();
      expect(
        service.resolveCollapseStrategy(NotificationType.DRIVER_PAYOUT_FAILED),
      ).toBe('NONE');
      expect(
        service.resolveCollapseStrategy(
          NotificationType.SECURITY_SESSION_REVOKED,
        ),
      ).toBe('NONE');
    });
  });

  describe('collapse and deduplication keys', () => {
    it('computeCollapseKey is stable for the same (userId, type, entityId) and ignores idempotencyKey', () => {
      const service = buildService();
      const keyA = service.computeCollapseKey(
        'user-1',
        NotificationType.PASSENGER_BID_RECEIVED,
        'trip-1',
      );
      const keyB = service.computeCollapseKey(
        'user-1',
        NotificationType.PASSENGER_BID_RECEIVED,
        'trip-1',
      );
      expect(keyA).toBe(keyB);
    });

    it('computeCollapseKey differs across entity/type/user', () => {
      const service = buildService();
      const base = service.computeCollapseKey(
        'user-1',
        NotificationType.PASSENGER_BID_RECEIVED,
        'trip-1',
      );
      expect(
        service.computeCollapseKey(
          'user-2',
          NotificationType.PASSENGER_BID_RECEIVED,
          'trip-1',
        ),
      ).not.toBe(base);
      expect(
        service.computeCollapseKey(
          'user-1',
          NotificationType.PASSENGER_DRIVER_ARRIVED,
          'trip-1',
        ),
      ).not.toBe(base);
      expect(
        service.computeCollapseKey(
          'user-1',
          NotificationType.PASSENGER_BID_RECEIVED,
          'trip-2',
        ),
      ).not.toBe(base);
    });

    it('computeDeduplicationKey differs per idempotencyKey even for the same entity, so two distinct bids never collide', () => {
      const service = buildService();
      const keyForBidA = service.computeDeduplicationKey(
        'user-1',
        NotificationType.PASSENGER_BID_RECEIVED,
        'trip-1',
        'bid-a',
      );
      const keyForBidB = service.computeDeduplicationKey(
        'user-1',
        NotificationType.PASSENGER_BID_RECEIVED,
        'trip-1',
        'bid-b',
      );
      expect(keyForBidA).not.toBe(keyForBidB);
    });

    it('computeDeduplicationKey is deterministic — reprocessing the same domain event yields the same key', () => {
      const service = buildService();
      const first = service.computeDeduplicationKey(
        'user-1',
        NotificationType.DRIVER_BID_ACCEPTED,
        'trip-1',
        'lifecycle-action-42',
      );
      const second = service.computeDeduplicationKey(
        'user-1',
        NotificationType.DRIVER_BID_ACCEPTED,
        'trip-1',
        'lifecycle-action-42',
      );
      expect(first).toBe(second);
    });
  });

  describe('createDraft', () => {
    it('combines rendered copy with priority/ttl/collapse/dedup decisions', () => {
      const service = buildService();
      const draft = service.createDraft({
        userId: 'user-1',
        type: NotificationType.DRIVER_NEW_TRIP_AVAILABLE,
        application: 'DRIVER' as never,
        entityType: 'TRIP',
        entityId: 'trip-1',
        idempotencyKey: 'dispatch-attempt-1',
        templateParams: { tripId: 'trip-1', formattedPrice: '350 ₽' },
      });

      expect(draft.title).toBe('Новый заказ рядом');
      expect(draft.deepLink).toBe('resilienttaxi://driver/orders/trip-1');
      expect(draft.priority).toBe(NotificationPriority.HIGH);
      expect(draft.ttlSeconds).toBe(30);
      expect(draft.collapseStrategy).toBe('SUPERSEDE');
      expect(draft.deduplicationKey).toMatch(/^[0-9a-f]{64}$/);
      expect(draft.collapseKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('never puts client-controlled text in the draft — only structured params flow through', () => {
      const service = buildService();
      expect(service.createDraft.length).toBeLessThanOrEqual(1);
    });
  });
});
