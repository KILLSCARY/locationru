-- PostGIS is required for geography(Point, 4326) pickup, destination and stop data.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM (
    'DRAFT',
    'SEARCHING',
    'OFFERS_RECEIVED',
    'DRIVER_SELECTED',
    'PAYMENT_PENDING',
    'PAYMENT_RESERVED',
    'DRIVER_EN_ROUTE',
    'DRIVER_ARRIVED',
    'IN_PROGRESS',
    'COMPLETED',
    'SETTLED',
    'CANCELLED_BY_PASSENGER',
    'CANCELLED_BY_DRIVER',
    'CANCELLED_BY_SYSTEM',
    'PAYMENT_FAILED',
    'DISPUTED',
    'REFUNDED'
);

-- CreateEnum
CREATE TYPE "TripStatusActorType" AS ENUM (
    'PASSENGER',
    'DRIVER',
    'ADMIN',
    'SYSTEM',
    'PAYMENT'
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "passengerId" UUID NOT NULL,
    "selectedDriverId" UUID,
    "selectedVehicleId" UUID,
    "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
    "passengerPriceKopecks" INTEGER NOT NULL,
    "finalPriceKopecks" INTEGER,
    "commissionBasisPoints" SMALLINT,
    "commissionKopecks" INTEGER,
    "driverPayoutKopecks" INTEGER,
    "pickupLocation" geography(Point, 4326) NOT NULL,
    "destinationLocation" geography(Point, 4326) NOT NULL,
    "pickupAddress" VARCHAR(512) NOT NULL,
    "destinationAddress" VARCHAR(512) NOT NULL,
    "estimatedDistanceMeters" INTEGER NOT NULL,
    "estimatedDurationSeconds" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trips_passenger_price_check" CHECK ("passengerPriceKopecks" >= 0),
    CONSTRAINT "trips_final_price_check" CHECK ("finalPriceKopecks" IS NULL OR "finalPriceKopecks" >= 0),
    CONSTRAINT "trips_commission_basis_points_check" CHECK ("commissionBasisPoints" IS NULL OR ("commissionBasisPoints" >= 0 AND "commissionBasisPoints" <= 10000)),
    CONSTRAINT "trips_commission_kopecks_check" CHECK ("commissionKopecks" IS NULL OR "commissionKopecks" >= 0),
    CONSTRAINT "trips_driver_payout_check" CHECK ("driverPayoutKopecks" IS NULL OR "driverPayoutKopecks" >= 0),
    CONSTRAINT "trips_estimated_distance_check" CHECK ("estimatedDistanceMeters" >= 0),
    CONSTRAINT "trips_estimated_duration_check" CHECK ("estimatedDurationSeconds" >= 0),
    CONSTRAINT "trips_version_check" CHECK ("version" >= 0)
);

-- CreateTable
CREATE TABLE "trip_stops" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "location" geography(Point, 4326) NOT NULL,
    "address" VARCHAR(512) NOT NULL,

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trip_stops_sequence_check" CHECK ("sequence" >= 1)
);

-- CreateTable
CREATE TABLE "trip_status_history" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "previousStatus" "TripStatus" NOT NULL,
    "newStatus" "TripStatus" NOT NULL,
    "actorType" "TripStatusActorType" NOT NULL,
    "actorId" UUID,
    "reason" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trips_passenger_created_at_idx" ON "trips"("passengerId", "createdAt");

-- CreateIndex
CREATE INDEX "trips_selected_driver_status_idx" ON "trips"("selectedDriverId", "status");

-- CreateIndex
CREATE INDEX "trips_selected_vehicle_idx" ON "trips"("selectedVehicleId");

-- CreateIndex
CREATE INDEX "trips_status_created_at_idx" ON "trips"("status", "createdAt");

-- CreateIndex
CREATE INDEX "trips_pickup_location_gist_idx" ON "trips" USING GIST ("pickupLocation");

-- CreateIndex
CREATE INDEX "trips_destination_location_gist_idx" ON "trips" USING GIST ("destinationLocation");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_trip_sequence_key" ON "trip_stops"("tripId", "sequence");

-- CreateIndex
CREATE INDEX "trip_stops_location_gist_idx" ON "trip_stops" USING GIST ("location");

-- CreateIndex
CREATE INDEX "trip_status_history_trip_created_at_idx" ON "trip_status_history"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "trip_status_history_actor_created_at_idx" ON "trip_status_history"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_selectedDriverId_fkey" FOREIGN KEY ("selectedDriverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_selectedVehicleId_fkey" FOREIGN KEY ("selectedVehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_status_history" ADD CONSTRAINT "trip_status_history_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
