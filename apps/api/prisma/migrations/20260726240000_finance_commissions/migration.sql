-- NULL means that a driver has no individual override and must inherit a city
-- or global commission rate. Existing default zeroes represented no override.
ALTER TABLE "driver_profiles"
    ALTER COLUMN "commissionBasisPoints" DROP DEFAULT,
    ALTER COLUMN "commissionBasisPoints" DROP NOT NULL;
UPDATE "driver_profiles"
    SET "commissionBasisPoints" = NULL
    WHERE "commissionBasisPoints" = 0;

ALTER TABLE "trips" ADD COLUMN "cityCode" VARCHAR(32);
CREATE INDEX "trips_city_status_idx" ON "trips"("cityCode", "status");

CREATE TABLE "city_commission_rates" (
    "cityCode" VARCHAR(32) NOT NULL,
    "commissionBasisPoints" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "city_commission_rates_pkey" PRIMARY KEY ("cityCode"),
    CONSTRAINT "city_commission_rates_basis_points_check"
      CHECK ("commissionBasisPoints" >= 0 AND "commissionBasisPoints" <= 10000)
);
