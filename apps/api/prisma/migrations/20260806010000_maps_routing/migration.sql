-- Provider-neutral address snapshots and server-built route data.
ALTER TABLE "trips"
  ADD COLUMN "pickupProviderPlaceId" VARCHAR(512),
  ADD COLUMN "destinationProviderPlaceId" VARCHAR(512),
  ADD COLUMN "route" geography(LineString, 4326),
  ADD COLUMN "routeBounds" JSONB,
  ADD COLUMN "routeProvider" VARCHAR(64),
  ADD COLUMN "routeProviderRouteId" VARCHAR(512);

ALTER TABLE "trip_stops"
  ADD COLUMN "providerPlaceId" VARCHAR(512);

-- Pickup and destination indexes were introduced with the trip model. The
-- guarded statements keep this migration safe for databases created from
-- older snapshots while adding the route index required for spatial reads.
CREATE INDEX IF NOT EXISTS "trips_pickup_location_gist_idx"
  ON "trips" USING GIST ("pickupLocation");
CREATE INDEX IF NOT EXISTS "trips_destination_location_gist_idx"
  ON "trips" USING GIST ("destinationLocation");
CREATE INDEX "trips_route_gist_idx"
  ON "trips" USING GIST ("route")
  WHERE "route" IS NOT NULL;
