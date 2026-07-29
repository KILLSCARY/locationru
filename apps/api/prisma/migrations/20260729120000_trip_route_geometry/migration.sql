-- Persist the server-computed route on each trip: geometry (a LineString), its
-- bounding box, the provider that produced it, and a snapshot of the resolved
-- pickup/destination place ids. Distance and duration already live on "trips".
ALTER TABLE "trips"
    ADD COLUMN "route" geography(LineString, 4326),
    ADD COLUMN "pickupPlaceId" VARCHAR(256),
    ADD COLUMN "destinationPlaceId" VARCHAR(256),
    ADD COLUMN "routeProvider" VARCHAR(64),
    ADD COLUMN "routeBounds" JSONB;

-- Spatial index so route geometry can be queried/filtered efficiently.
CREATE INDEX "trips_route_gist_idx" ON "trips" USING GIST ("route");
