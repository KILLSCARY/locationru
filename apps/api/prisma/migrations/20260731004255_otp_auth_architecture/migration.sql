-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'DRIVER_REGISTRATION', 'PHONE_CHANGE', 'SENSITIVE_ACTION');

-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('CREATED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'VERIFIED', 'EXPIRED', 'BLOCKED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('SMS', 'FLASH_CALL', 'INCOMING_CALL', 'STAGING');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('OTP_BRUTE_FORCE_SUSPECTED', 'REFRESH_TOKEN_REUSE', 'PHONE_BLOCKED', 'DEVICE_BLOCKED', 'PROVIDER_CIRCUIT_OPEN');

-- AlterTable
-- tokenFamilyId gets a DB-level default (not just Prisma's own generated
-- value) so the 2 pre-existing rows in this table backfill in the same
-- statement instead of needing a separate nullable-then-required step.
ALTER TABLE "device_sessions" ADD COLUMN     "appVersion" VARCHAR(32),
ADD COLUMN     "lastIpHash" VARCHAR(128),
ADD COLUMN     "revokeReason" VARCHAR(64),
ADD COLUMN     "tokenFamilyId" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "userAgentSummary" VARCHAR(255);

-- CreateTable
CREATE TABLE "otp_requests" (
    "id" UUID NOT NULL,
    "phoneHash" VARCHAR(128) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "channel" "VerificationChannel" NOT NULL,
    "codeHash" VARCHAR(255) NOT NULL,
    "status" "OtpStatus" NOT NULL DEFAULT 'CREATED',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "resendAvailableAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    "providerMessageId" VARCHAR(128),
    "providerStatus" VARCHAR(32),

    CONSTRAINT "otp_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "phoneHash" VARCHAR(128),
    "userId" UUID,
    "deviceId" VARCHAR(255),
    "ipHash" VARCHAR(128),
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_blocks" (
    "id" UUID NOT NULL,
    "phoneHash" VARCHAR(128),
    "deviceId" VARCHAR(255),
    "reason" VARCHAR(255) NOT NULL,
    "createdByAdminId" UUID,
    "blockedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "unblockedAt" TIMESTAMPTZ(3),
    "unblockedByAdminId" UUID,

    CONSTRAINT "auth_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "rawEventHash" VARCHAR(64) NOT NULL,
    "providerMessageId" VARCHAR(128),
    "status" VARCHAR(32) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "sms_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_requests_phone_purpose_created_idx" ON "otp_requests"("phoneHash", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "otp_requests_status_idx" ON "otp_requests"("status");

-- CreateIndex
CREATE INDEX "otp_requests_provider_message_id_idx" ON "otp_requests"("providerMessageId");

-- CreateIndex
CREATE INDEX "security_events_type_created_idx" ON "security_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_phone_created_idx" ON "security_events"("phoneHash", "createdAt");

-- CreateIndex
CREATE INDEX "auth_blocks_phone_active_idx" ON "auth_blocks"("phoneHash", "unblockedAt");

-- CreateIndex
CREATE INDEX "auth_blocks_device_active_idx" ON "auth_blocks"("deviceId", "unblockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sms_webhook_events_raw_event_hash_key" ON "sms_webhook_events"("rawEventHash");

-- CreateIndex
CREATE INDEX "sms_webhook_events_provider_message_id_idx" ON "sms_webhook_events"("providerMessageId");

-- CreateIndex
CREATE INDEX "device_sessions_token_family_idx" ON "device_sessions"("tokenFamilyId");
