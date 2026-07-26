CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'CANCELED', 'REFUNDED', 'FAILED');
CREATE TYPE "PaymentTransactionType" AS ENUM ('AUTHORIZATION', 'CAPTURE', 'CANCELLATION', 'REFUND');
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('SUCCEEDED', 'FAILED');
CREATE TYPE "DriverPayoutStatus" AS ENUM ('CREATED', 'PAID', 'FAILED');

CREATE TABLE "payment_intents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tripId" UUID NOT NULL, "provider" VARCHAR(64) NOT NULL,
  "providerPaymentId" VARCHAR(128) NOT NULL, "idempotencyKey" VARCHAR(255) NOT NULL, "amountKopecks" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'RUB', "status" "PaymentIntentStatus" NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id"), CONSTRAINT "payment_intents_trip_id_key" UNIQUE ("tripId"),
  CONSTRAINT "payment_intents_provider_payment_id_key" UNIQUE ("providerPaymentId"), CONSTRAINT "payment_intents_idempotency_key_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "payment_intents_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "payment_intents_status_created_at_idx" ON "payment_intents"("status", "createdAt");

CREATE TABLE "payment_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "paymentIntentId" UUID NOT NULL, "type" "PaymentTransactionType" NOT NULL,
  "status" "PaymentTransactionStatus" NOT NULL, "amountKopecks" INTEGER NOT NULL, "providerReference" VARCHAR(128) NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id"), CONSTRAINT "payment_transactions_provider_reference_key" UNIQUE ("providerReference"),
  CONSTRAINT "payment_transactions_idempotency_key_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "payment_transactions_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "payment_transactions_intent_created_at_idx" ON "payment_transactions"("paymentIntentId", "createdAt");

CREATE TABLE "commission_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tripId" UUID NOT NULL, "driverId" UUID NOT NULL, "totalKopecks" INTEGER NOT NULL,
  "commissionBasisPoints" INTEGER NOT NULL, "commissionKopecks" INTEGER NOT NULL, "driverPayoutKopecks" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "commission_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_records_trip_id_key" UNIQUE ("tripId"), CONSTRAINT "commission_records_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "commission_records_driver_created_at_idx" ON "commission_records"("driverId", "createdAt");

CREATE TABLE "driver_payouts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tripId" UUID NOT NULL, "driverId" UUID NOT NULL, "provider" VARCHAR(64) NOT NULL,
  "providerPayoutId" VARCHAR(128) NOT NULL, "idempotencyKey" VARCHAR(255) NOT NULL, "amountKopecks" INTEGER NOT NULL,
  "status" "DriverPayoutStatus" NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "driver_payouts_pkey" PRIMARY KEY ("id"), CONSTRAINT "driver_payouts_trip_id_key" UNIQUE ("tripId"),
  CONSTRAINT "driver_payouts_provider_payout_id_key" UNIQUE ("providerPayoutId"), CONSTRAINT "driver_payouts_idempotency_key_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "driver_payouts_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "driver_payouts_driver_status_created_at_idx" ON "driver_payouts"("driverId", "status", "createdAt");

CREATE TABLE "payment_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "provider" VARCHAR(64) NOT NULL, "providerEventId" VARCHAR(128) NOT NULL,
  "signature" VARCHAR(512) NOT NULL, "payload" JSONB NOT NULL, "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id"), CONSTRAINT "payment_webhook_events_provider_event_key" UNIQUE ("provider", "providerEventId")
);
CREATE INDEX "payment_webhook_events_processed_at_idx" ON "payment_webhook_events"("processedAt");
