CREATE TYPE "RealtimeEventType" AS ENUM (
    'TRIP_SEARCHING',
    'TRIP_UPDATED',
    'TRIP_CANCELLED',
    'BID_CREATED',
    'BID_WITHDRAWN',
    'BID_EXPIRED',
    'BID_ACCEPTED',
    'DRIVER_LOCATION_UPDATED',
    'DRIVER_ARRIVED',
    'TRIP_STARTED',
    'TRIP_COMPLETED'
);

CREATE TYPE "RealtimeOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED');

CREATE TABLE "realtime_room_sequences" (
    "room" VARCHAR(128) NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "realtime_room_sequences_pkey" PRIMARY KEY ("room"),
    CONSTRAINT "realtime_room_sequences_last_value_check" CHECK ("lastValue" >= 0)
);

CREATE TABLE "realtime_outbox_events" (
    "id" UUID NOT NULL,
    "room" VARCHAR(128) NOT NULL,
    "eventType" "RealtimeEventType" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "RealtimeOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realtime_outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "realtime_outbox_events_sequence_check" CHECK ("sequence" >= 1),
    CONSTRAINT "realtime_outbox_events_attempts_check" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "realtime_outbox_events_room_sequence_key"
    ON "realtime_outbox_events"("room", "sequence");
CREATE INDEX "realtime_outbox_events_status_available_at_idx"
    ON "realtime_outbox_events"("status", "availableAt");
CREATE INDEX "realtime_outbox_events_room_sequence_idx"
    ON "realtime_outbox_events"("room", "sequence");
