-- Extend trips with passenger-facing order options.
ALTER TABLE "trips"
    ADD COLUMN "childSeat" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "pet" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "luggage" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "comment" VARCHAR(1000);

-- Persist idempotency keys independently from the client request lifecycle.
CREATE TABLE "trip_idempotency_keys" (
    "id" UUID NOT NULL,
    "passengerId" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "tripId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trip_idempotency_keys_trip_id_key" ON "trip_idempotency_keys"("tripId");
CREATE UNIQUE INDEX "trip_idempotency_keys_passenger_key_key" ON "trip_idempotency_keys"("passengerId", "key");

ALTER TABLE "trip_idempotency_keys"
    ADD CONSTRAINT "trip_idempotency_keys_passengerId_fkey"
    FOREIGN KEY ("passengerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trip_idempotency_keys"
    ADD CONSTRAINT "trip_idempotency_keys_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A passenger can create only one active order. Terminal and failed orders do
-- not block creation of a new order.
CREATE UNIQUE INDEX "trips_one_active_per_passenger_idx"
    ON "trips"("passengerId")
    WHERE "status" IN (
        'DRAFT',
        'SEARCHING',
        'OFFERS_RECEIVED',
        'DRIVER_SELECTED',
        'PAYMENT_PENDING',
        'PAYMENT_RESERVED',
        'DRIVER_EN_ROUTE',
        'DRIVER_ARRIVED',
        'IN_PROGRESS'
    );
