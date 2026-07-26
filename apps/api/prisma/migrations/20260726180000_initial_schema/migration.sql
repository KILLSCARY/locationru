-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PASSENGER', 'DRIVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'PENDING');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('OFFLINE', 'ONLINE', 'BUSY', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DriverVerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_phone_e164_check" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$')
);

-- CreateTable
CREATE TABLE "passenger_profiles" (
    "userId" UUID NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "rating" DECIMAL(3,2) NOT NULL DEFAULT 5.0,
    "completedTripsCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "passenger_profiles_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "passenger_profiles_rating_check" CHECK ("rating" >= 0 AND "rating" <= 5),
    CONSTRAINT "passenger_profiles_completed_trips_check" CHECK ("completedTripsCount" >= 0)
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "userId" UUID NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'OFFLINE',
    "verificationStatus" "DriverVerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "rating" DECIMAL(3,2) NOT NULL DEFAULT 5.0,
    "completedTripsCount" INTEGER NOT NULL DEFAULT 0,
    "commissionBasisPoints" SMALLINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "driver_profiles_rating_check" CHECK ("rating" >= 0 AND "rating" <= 5),
    CONSTRAINT "driver_profiles_completed_trips_check" CHECK ("completedTripsCount" >= 0),
    CONSTRAINT "driver_profiles_commission_check" CHECK ("commissionBasisPoints" >= 0 AND "commissionBasisPoints" <= 10000)
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "brand" VARCHAR(100) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "color" VARCHAR(50) NOT NULL,
    "registrationNumber" VARCHAR(32) NOT NULL,
    "productionYear" SMALLINT NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vehicles_production_year_check" CHECK ("productionYear" >= 1886)
);

-- CreateTable
CREATE TABLE "device_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" VARCHAR(255) NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "refreshTokenHash" VARCHAR(255) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("createdAt");

-- CreateIndex
CREATE INDEX "driver_profiles_status_verification_idx" ON "driver_profiles"("status", "verificationStatus");

-- CreateIndex
CREATE INDEX "driver_profiles_rating_idx" ON "driver_profiles"("rating");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_registration_number_key" ON "vehicles"("registrationNumber");

-- CreateIndex
CREATE INDEX "vehicles_driver_status_idx" ON "vehicles"("driverId", "status");

-- CreateIndex
CREATE INDEX "vehicles_status_idx" ON "vehicles"("status");

-- CreateIndex
CREATE INDEX "device_sessions_user_revoked_idx" ON "device_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "device_sessions_last_seen_at_idx" ON "device_sessions"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "device_sessions_user_device_key" ON "device_sessions"("userId", "deviceId");

-- AddForeignKey
ALTER TABLE "passenger_profiles" ADD CONSTRAINT "passenger_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
