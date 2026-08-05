import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../src/database/prisma.service.js';
import { MetricsService } from '../src/observability/metrics.service.js';
import { NotificationInboxService } from '../src/notifications/notification-inbox.service.js';
import { NotificationOutboxService } from '../src/notifications/notification-outbox.service.js';
import { NotificationOutboxWorker } from '../src/notifications/notification-outbox.worker.js';
import { NotificationPreferenceService } from '../src/notifications/notification-preference.service.js';
import { NotificationService } from '../src/notifications/notification.service.js';
import { PushTokenCryptoService } from '../src/notifications/infrastructure/push-token-crypto.service.js';
import { DevelopmentPushProvider } from '../src/notifications/providers/development-push.provider.js';
import { StagingPushProvider } from '../src/notifications/providers/staging-push.provider.js';
import { FirebasePushProvider } from '../src/notifications/providers/firebase-push.provider.js';
import { ApnsPushProvider } from '../src/notifications/providers/apns-push.provider.js';
import { PushProviderResolver } from '../src/notifications/providers/push-provider.resolver.js';
import { DevicePushTokenRepository } from '../src/notifications/repositories/device-push-token.repository.js';
import { NotificationTemplateService } from '../src/notifications/templates/notification-template.service.js';

// Real Postgres, same convention as auth-otp-flow.integration.e2e-spec.ts:
// skipped by default so CI without live infra stays green, run explicitly
// with RUN_NOTIFICATIONS_INTEGRATION=true when a database is available.
// Never touches a real FCM/APNs endpoint — PushProviderResolver only ever
// resolves DevelopmentPushProvider here (app.appEnvironment stays
// 'development' throughout), which logs and fabricates an ACCEPTED result
// instead of sending anything.
const describeNotificationsIntegration =
  process.env.RUN_NOTIFICATIONS_INTEGRATION === 'true'
    ? describe
    : describe.skip;

function buildConfig(): ConfigService {
  return new ConfigService({
    app: { environment: 'test', appEnvironment: 'development' },
    database: { url: process.env.DATABASE_URL },
    push: {
      tokenEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
      tokenHashSecret: 'integration-test-push-token-hash-secret-32-chars',
      maxAttempts: 5,
      outboxPollIntervalMs: 60_000,
      initialRetryDelaySeconds: 5,
      maxRetryDelaySeconds: 900,
      ttl: {
        newOrderSeconds: 30,
        activeTripSeconds: 300,
        paymentSeconds: 86_400,
      },
    },
  });
}

describeNotificationsIntegration(
  'Notification outbox pipeline (real Postgres, DevelopmentPushProvider)',
  () => {
    let prisma: PrismaService;
    let templates: NotificationTemplateService;
    let notifications: NotificationService;
    let outbox: NotificationOutboxService;
    let worker: NotificationOutboxWorker;
    let inbox: NotificationInboxService;
    let preferences: NotificationPreferenceService;
    let devicePushTokens: DevicePushTokenRepository;

    beforeAll(() => {
      const config = buildConfig();
      prisma = new PrismaService(config);
      const metrics = new MetricsService();
      templates = new NotificationTemplateService();
      notifications = new NotificationService(config, templates);
      outbox = new NotificationOutboxService(
        config,
        prisma,
        templates,
        metrics,
      );
      preferences = new NotificationPreferenceService(prisma);
      inbox = new NotificationInboxService(prisma, metrics);

      const crypto = new PushTokenCryptoService(config);
      devicePushTokens = new DevicePushTokenRepository(prisma, crypto);

      const development = new DevelopmentPushProvider(config);
      const staging = new StagingPushProvider(config, {
        checkConnection: async () => undefined,
      } as never);
      const firebase = new FirebasePushProvider(config);
      const apns = new ApnsPushProvider(firebase);
      const resolver = new PushProviderResolver(
        config,
        development,
        staging,
        firebase,
        apns,
      );

      worker = new NotificationOutboxWorker(
        config,
        prisma,
        devicePushTokens,
        resolver,
        metrics,
        preferences,
        templates,
      );
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function seedPassengerWithDevice() {
      const phone = `+7999${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
      const user = await prisma.user.create({
        data: { phone, role: 'PASSENGER', status: 'ACTIVE' },
      });
      const session = await prisma.deviceSession.create({
        data: {
          userId: user.id,
          deviceId: `device-${randomUUID()}`,
          platform: 'ANDROID',
          refreshTokenHash: 'unused-in-this-test',
        },
      });
      await devicePushTokens.register({
        userId: user.id,
        deviceSessionId: session.id,
        deviceId: session.deviceId,
        application: 'PASSENGER',
        platform: 'ANDROID',
        provider: 'DEVELOPMENT',
        environment: 'DEVELOPMENT',
        rawToken: `raw-push-token-${randomUUID()}`,
        notificationsPermission: true,
      });
      return user;
    }

    it('delivers a SYSTEM_SERVICE_NOTICE end to end and surfaces it in the inbox', async () => {
      const user = await seedPassengerWithDevice();
      const entityId = randomUUID();
      const draft = notifications.createDraft({
        userId: user.id,
        type: 'SYSTEM_SERVICE_NOTICE',
        application: 'PASSENGER',
        entityType: 'SYSTEM',
        entityId,
        idempotencyKey: randomUUID(),
      });

      await outbox.enqueue(prisma, draft);
      await worker.processPending();

      const outboxRow = await prisma.notificationOutboxEvent.findUnique({
        where: { deduplicationKey: draft.deduplicationKey },
      });
      expect(outboxRow?.status).toBe('DELIVERED');

      const notificationRow = await prisma.notification.findUnique({
        where: { deduplicationKey: draft.deduplicationKey },
      });
      expect(notificationRow?.status).toBe('SENT');

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId: notificationRow!.id },
      });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        provider: 'DEVELOPMENT',
        status: 'PROVIDER_ACCEPTED',
      });

      const page = await inbox.listInbox(user.id, 'PASSENGER', {});
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ id: notificationRow!.id });

      await inbox.markRead(user.id, notificationRow!.id);
      const unread = await inbox.listInbox(user.id, 'PASSENGER', {
        unreadOnly: true,
      });
      expect(unread.items).toHaveLength(0);
    });

    it('skips the send and cancels the Notification when the category is disabled by preference', async () => {
      const user = await seedPassengerWithDevice();
      await preferences.updatePreferences(user.id, 'PASSENGER', {
        categories: [{ category: 'ACCOUNT', pushEnabled: false }],
      });

      const entityId = randomUUID();
      const draft = notifications.createDraft({
        userId: user.id,
        type: 'SYSTEM_SERVICE_NOTICE',
        application: 'PASSENGER',
        entityType: 'SYSTEM',
        entityId,
        idempotencyKey: randomUUID(),
      });
      await outbox.enqueue(prisma, draft);
      await worker.processPending();

      const notificationRow = await prisma.notification.findUnique({
        where: { deduplicationKey: draft.deduplicationKey },
      });
      expect(notificationRow?.status).toBe('CANCELLED');

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId: notificationRow!.id },
      });
      expect(deliveries).toHaveLength(0);
    });

    it('retries with backoff when the user has no active (non-revoked) device token', async () => {
      const user = await seedPassengerWithDevice();
      // DevelopmentPushProvider always accepts, so exercise the "no active
      // targets" retry path instead by revoking the only token — the worker
      // never even calls the provider in that case.
      await prisma.devicePushToken.updateMany({
        where: { userId: user.id },
        data: { status: 'REVOKED' },
      });

      const entityId = randomUUID();
      const draft = notifications.createDraft({
        userId: user.id,
        type: 'SYSTEM_SERVICE_NOTICE',
        application: 'PASSENGER',
        entityType: 'SYSTEM',
        entityId,
        idempotencyKey: randomUUID(),
      });
      await outbox.enqueue(prisma, draft);
      await worker.processPending();

      const outboxRow = await prisma.notificationOutboxEvent.findUnique({
        where: { deduplicationKey: draft.deduplicationKey },
      });
      expect(outboxRow?.status).toBe('PENDING');
      expect(outboxRow?.lastError).toContain('no active device tokens');
    });
  },
);
