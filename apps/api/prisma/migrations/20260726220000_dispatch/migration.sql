CREATE TYPE "DispatchAttemptLogStatus" AS ENUM ('CANDIDATE');

CREATE TABLE "dispatch_attempts" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "redispatchReason" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dispatch_attempts_radius_check" CHECK ("radiusMeters" > 0),
    CONSTRAINT "dispatch_attempts_candidate_count_check" CHECK ("candidateCount" >= 0)
);

CREATE TABLE "dispatch_attempt_logs" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "distanceMeters" INTEGER NOT NULL,
    "estimatedPickupSeconds" INTEGER NOT NULL,
    "status" "DispatchAttemptLogStatus" NOT NULL DEFAULT 'CANDIDATE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_attempt_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dispatch_attempt_logs_rank_check" CHECK ("rank" >= 1),
    CONSTRAINT "dispatch_attempt_logs_distance_check" CHECK ("distanceMeters" >= 0),
    CONSTRAINT "dispatch_attempt_logs_pickup_seconds_check" CHECK ("estimatedPickupSeconds" >= 0)
);

CREATE INDEX "dispatch_attempts_trip_created_at_idx"
    ON "dispatch_attempts"("tripId", "createdAt");
CREATE UNIQUE INDEX "dispatch_attempt_logs_attempt_driver_key"
    ON "dispatch_attempt_logs"("attemptId", "driverId");
CREATE INDEX "dispatch_attempt_logs_attempt_rank_idx"
    ON "dispatch_attempt_logs"("attemptId", "rank");
CREATE INDEX "dispatch_attempt_logs_driver_created_at_idx"
    ON "dispatch_attempt_logs"("driverId", "createdAt");

ALTER TABLE "dispatch_attempts"
    ADD CONSTRAINT "dispatch_attempts_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispatch_attempt_logs"
    ADD CONSTRAINT "dispatch_attempt_logs_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "dispatch_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dispatch_attempt_logs"
    ADD CONSTRAINT "dispatch_attempt_logs_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
