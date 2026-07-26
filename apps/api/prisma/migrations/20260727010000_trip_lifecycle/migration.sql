CREATE TYPE "TripPaymentStatus" AS ENUM ('RESERVED', 'SETTLED');

CREATE TABLE "trip_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tripId" UUID NOT NULL,
  "providerReference" VARCHAR(128) NOT NULL,
  "status" "TripPaymentStatus" NOT NULL,
  "reservedAmountKopecks" INTEGER NOT NULL,
  "settledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "trip_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trip_payments_trip_id_key" UNIQUE ("tripId"),
  CONSTRAINT "trip_payments_provider_reference_key" UNIQUE ("providerReference"),
  CONSTRAINT "trip_payments_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "trip_boarding_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tripId" UUID NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "usedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trip_boarding_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trip_boarding_codes_trip_id_key" UNIQUE ("tripId"),
  CONSTRAINT "trip_boarding_codes_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "trip_boarding_codes_expires_at_idx" ON "trip_boarding_codes"("expiresAt");

CREATE TABLE "trip_lifecycle_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tripId" UUID NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "actorType" "TripStatusActorType" NOT NULL,
  "actorId" UUID,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trip_lifecycle_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trip_lifecycle_actions_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "trip_lifecycle_actions_idempotency_key" ON "trip_lifecycle_actions"("tripId", "action", "actorId", "idempotencyKey");
CREATE INDEX "trip_lifecycle_actions_trip_created_at_idx" ON "trip_lifecycle_actions"("tripId", "createdAt");
