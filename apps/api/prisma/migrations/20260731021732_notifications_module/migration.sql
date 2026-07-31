-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "PushApplication" AS ENUM ('PASSENGER', 'DRIVER');

-- CreateEnum
CREATE TYPE "PushProviderType" AS ENUM ('DEVELOPMENT', 'STAGING', 'FCM', 'APNS');

-- CreateEnum
CREATE TYPE "PushTokenStatus" AS ENUM ('ACTIVE', 'INVALID', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PushEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DRIVER_NEW_TRIP_AVAILABLE', 'DRIVER_BID_ACCEPTED', 'DRIVER_BID_REJECTED', 'DRIVER_TRIP_CANCELLED', 'DRIVER_PAYMENT_RESERVED', 'DRIVER_PICKUP_REMINDER', 'DRIVER_LOCATION_DEGRADED', 'DRIVER_DOCUMENT_EXPIRING', 'DRIVER_ACCOUNT_APPROVED', 'DRIVER_ACCOUNT_REJECTED', 'DRIVER_PAYOUT_COMPLETED', 'DRIVER_PAYOUT_FAILED', 'PASSENGER_BID_RECEIVED', 'PASSENGER_DRIVER_SELECTED', 'PASSENGER_DRIVER_EN_ROUTE', 'PASSENGER_DRIVER_ARRIVED', 'PASSENGER_TRIP_STARTED', 'PASSENGER_TRIP_COMPLETED', 'PASSENGER_TRIP_CANCELLED', 'PASSENGER_PAYMENT_RESERVED', 'PASSENGER_PAYMENT_FAILED', 'PASSENGER_REFUND_COMPLETED', 'SECURITY_SESSION_REVOKED', 'SYSTEM_SERVICE_NOTICE');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('TRIP_OFFERS', 'ACTIVE_TRIP', 'PAYMENTS', 'DRIVER_OPERATIONS', 'ACCOUNT', 'SECURITY');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'PARTIALLY_SENT', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'PROVIDER_ACCEPTED', 'DELIVERED', 'OPENED', 'RETRY_SCHEDULED', 'FAILED_TEMPORARY', 'FAILED_PERMANENT', 'TOKEN_INVALID');

-- CreateEnum
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'CANCELLED', 'EXPIRED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "NotificationPreviewMode" AS ENUM ('FULL', 'GENERIC', 'HIDDEN');

-- CreateTable
CREATE TABLE "device_push_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceSessionId" UUID NOT NULL,
    "deviceId" VARCHAR(255) NOT NULL,
    "application" "PushApplication" NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "provider" "PushProviderType" NOT NULL,
    "environment" "PushEnvironment" NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "status" "PushTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "appVersion" VARCHAR(32),
    "osVersion" VARCHAR(32),
    "locale" VARCHAR(16),
    "timezone" VARCHAR(64),
    "notificationsPermission" BOOLEAN NOT NULL,
    "lastRegisteredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),
    "invalidatedAt" TIMESTAMPTZ(3),
    "invalidationReason" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox_events" (
    "id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "userId" UUID NOT NULL,
    "application" "PushApplication" NOT NULL,
    "entityType" VARCHAR(32) NOT NULL,
    "entityId" UUID,
    "payload" JSONB NOT NULL,
    "priority" "NotificationPriority" NOT NULL,
    "deduplicationKey" VARCHAR(255) NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "notificationId" UUID,
    "lastError" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "notification_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "application" "PushApplication" NOT NULL,
    "entityType" VARCHAR(32) NOT NULL,
    "entityId" UUID,
    "titleTemplate" VARCHAR(128) NOT NULL,
    "bodyTemplate" VARCHAR(512) NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "NotificationPriority" NOT NULL,
    "deduplicationKey" VARCHAR(255) NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "openedAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "devicePushTokenId" UUID NOT NULL,
    "provider" "PushProviderType" NOT NULL,
    "providerMessageId" VARCHAR(255),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" VARCHAR(64),
    "errorCategory" VARCHAR(32),
    "sentAt" TIMESTAMPTZ(3),
    "acknowledgedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "nextRetryAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "userId" UUID NOT NULL,
    "application" "PushApplication" NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "vibrationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("userId","application","category")
);

-- CreateTable
CREATE TABLE "notification_privacy_settings" (
    "userId" UUID NOT NULL,
    "previewMode" "NotificationPreviewMode" NOT NULL DEFAULT 'GENERIC',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_privacy_settings_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_push_tokens_token_hash_key" ON "device_push_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "device_push_tokens_user_idx" ON "device_push_tokens"("userId");

-- CreateIndex
CREATE INDEX "device_push_tokens_device_session_idx" ON "device_push_tokens"("deviceSessionId");

-- CreateIndex
CREATE INDEX "device_push_tokens_status_idx" ON "device_push_tokens"("status");

-- CreateIndex
CREATE INDEX "device_push_tokens_app_environment_idx" ON "device_push_tokens"("application", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_events_dedup_key_key" ON "notification_outbox_events"("deduplicationKey");

-- CreateIndex
CREATE INDEX "notification_outbox_events_status_available_at_idx" ON "notification_outbox_events"("status", "availableAt");

-- CreateIndex
CREATE INDEX "notification_outbox_events_user_type_idx" ON "notification_outbox_events"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedup_key_key" ON "notifications"("deduplicationKey");

-- CreateIndex
CREATE INDEX "notifications_user_created_at_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_user_read_at_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_idx" ON "notification_deliveries"("notificationId");

-- CreateIndex
CREATE INDEX "notification_deliveries_device_push_token_idx" ON "notification_deliveries"("devicePushTokenId");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_retry_idx" ON "notification_deliveries"("status", "nextRetryAt");

-- AddForeignKey
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_deviceSessionId_fkey" FOREIGN KEY ("deviceSessionId") REFERENCES "device_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_devicePushTokenId_fkey" FOREIGN KEY ("devicePushTokenId") REFERENCES "device_push_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_privacy_settings" ADD CONSTRAINT "notification_privacy_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
