-- Persist the audit trail of driver positions. The live position itself is
-- deliberately kept in Redis by the API and expires automatically.
CREATE TYPE "DriverLocationConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "driver_locations" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "deviceId" VARCHAR(255) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" geography(Point, 4326) NOT NULL,
    "accuracyMeters" DOUBLE PRECISION NOT NULL,
    "speedMetersPerSecond" DOUBLE PRECISION,
    "bearingDegrees" DOUBLE PRECISION,
    "altitudeMeters" DOUBLE PRECISION,
    "provider" VARCHAR(64) NOT NULL,
    "reportedConfidence" "DriverLocationConfidence",
    "confidence" "DriverLocationConfidence" NOT NULL,
    "suspectedSpoofing" BOOLEAN NOT NULL DEFAULT false,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "satellitesVisible" INTEGER,
    "cellCount" INTEGER,

    CONSTRAINT "driver_locations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "driver_locations_accuracy_check" CHECK ("accuracyMeters" >= 0),
    CONSTRAINT "driver_locations_speed_check" CHECK ("speedMetersPerSecond" IS NULL OR "speedMetersPerSecond" >= 0),
    CONSTRAINT "driver_locations_bearing_check" CHECK ("bearingDegrees" IS NULL OR ("bearingDegrees" >= 0 AND "bearingDegrees" < 360)),
    CONSTRAINT "driver_locations_satellites_check" CHECK ("satellitesVisible" IS NULL OR "satellitesVisible" >= 0),
    CONSTRAINT "driver_locations_cell_count_check" CHECK ("cellCount" IS NULL OR "cellCount" >= 0)
);

CREATE UNIQUE INDEX "driver_locations_device_recorded_at_key"
    ON "driver_locations"("deviceId", "recordedAt");
CREATE INDEX "driver_locations_driver_recorded_at_idx"
    ON "driver_locations"("driverId", "recordedAt");
CREATE INDEX "driver_locations_recorded_at_idx"
    ON "driver_locations"("recordedAt");
CREATE INDEX "driver_locations_location_gist_idx"
    ON "driver_locations" USING GIST ("location");

ALTER TABLE "driver_locations"
    ADD CONSTRAINT "driver_locations_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId")
    ON DELETE CASCADE ON UPDATE CASCADE;
