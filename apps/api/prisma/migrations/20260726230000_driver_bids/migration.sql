CREATE TYPE "DriverBidStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');

CREATE TABLE "driver_bids" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "offeredPriceKopecks" INTEGER NOT NULL,
    "estimatedPickupSeconds" INTEGER NOT NULL,
    "distanceToPickupMeters" INTEGER NOT NULL,
    "status" "DriverBidStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "driver_bids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "driver_bids_price_check" CHECK ("offeredPriceKopecks" >= 0),
    CONSTRAINT "driver_bids_pickup_seconds_check" CHECK ("estimatedPickupSeconds" >= 0),
    CONSTRAINT "driver_bids_distance_check" CHECK ("distanceToPickupMeters" >= 0),
    CONSTRAINT "driver_bids_version_check" CHECK ("version" >= 0)
);

CREATE UNIQUE INDEX "driver_bids_one_active_per_trip_driver_idx"
    ON "driver_bids"("tripId", "driverId")
    WHERE "status" = 'ACTIVE';
CREATE INDEX "driver_bids_trip_status_expires_at_idx"
    ON "driver_bids"("tripId", "status", "expiresAt");
CREATE INDEX "driver_bids_driver_status_idx"
    ON "driver_bids"("driverId", "status");
CREATE INDEX "driver_bids_vehicle_idx" ON "driver_bids"("vehicleId");

ALTER TABLE "driver_bids"
    ADD CONSTRAINT "driver_bids_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_bids"
    ADD CONSTRAINT "driver_bids_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "driver_bids"
    ADD CONSTRAINT "driver_bids_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
