-- CreateEnum
CREATE TYPE "DriverOperationalStatus" AS ENUM ('OFFLINE', 'ONLINE', 'BUSY', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VehicleVerificationStatus" AS ENUM ('DRAFT', 'DOCUMENTS_REQUIRED', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DriverDocumentType" AS ENUM ('PASSPORT_MAIN_PAGE', 'PASSPORT_REGISTRATION', 'DRIVER_LICENSE_FRONT', 'DRIVER_LICENSE_BACK', 'PROFILE_PHOTO', 'SELFIE_WITH_DOCUMENT', 'TAX_STATUS_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleDocumentType" AS ENUM ('VEHICLE_REGISTRATION_FRONT', 'VEHICLE_REGISTRATION_BACK', 'INSURANCE_POLICY', 'VEHICLE_PHOTO_FRONT', 'VEHICLE_PHOTO_BACK', 'VEHICLE_PHOTO_LEFT', 'VEHICLE_PHOTO_RIGHT', 'VEHICLE_INTERIOR', 'TAXI_LICENSE_FUTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'PROCESSING', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED', 'FAILED_SECURITY_CHECK');

-- CreateEnum
CREATE TYPE "DocumentRejectionReasonCode" AS ENUM ('DOCUMENT_UNREADABLE', 'DOCUMENT_CROPPED', 'DOCUMENT_EXPIRED', 'DOCUMENT_MISMATCH', 'WRONG_DOCUMENT_TYPE', 'PROFILE_PHOTO_MISMATCH', 'DRIVER_LICENSE_INVALID', 'VEHICLE_DATA_MISMATCH', 'VEHICLE_TOO_OLD', 'INSURANCE_EXPIRED', 'SECURITY_CHECK_FAILED', 'DUPLICATE_ACCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentVersionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "VerificationCaseStatus" AS ENUM ('CREATED', 'QUEUED', 'ASSIGNED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "VerificationCaseDecision" AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "VerificationCasePriority" AS ENUM ('NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "DriverConsentType" AS ENUM ('PERSONAL_DATA_PROCESSING', 'DOCUMENT_PROCESSING', 'BIOMETRIC_PROCESSING_FUTURE', 'TERMS_OF_SERVICE', 'DRIVER_PARTNER_AGREEMENT');

-- CreateEnum
CREATE TYPE "DuplicateMatchResult" AS ENUM ('NO_MATCH', 'POSSIBLE_MATCH', 'STRONG_MATCH', 'MANUAL_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "DeletionQueueStatus" AS ENUM ('PENDING', 'LEGAL_HOLD', 'DELETED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "DriverVerificationStatus_new" AS ENUM ('NOT_STARTED', 'PROFILE_INCOMPLETE', 'DOCUMENTS_REQUIRED', 'DOCUMENTS_SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'EXPIRED');
ALTER TABLE "driver_profiles" ALTER COLUMN "verificationStatus" DROP DEFAULT;
ALTER TABLE "driver_profiles" ALTER COLUMN "verificationStatus" TYPE "DriverVerificationStatus_new" USING ("verificationStatus"::text::"DriverVerificationStatus_new");
ALTER TYPE "DriverVerificationStatus" RENAME TO "DriverVerificationStatus_old";
ALTER TYPE "DriverVerificationStatus_new" RENAME TO "DriverVerificationStatus";
DROP TYPE "DriverVerificationStatus_old";
ALTER TABLE "driver_profiles" ALTER COLUMN "verificationStatus" SET DEFAULT 'NOT_STARTED';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "VehicleStatus_new" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED', 'ARCHIVED');
ALTER TABLE "vehicles" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "vehicles" ALTER COLUMN "status" TYPE "VehicleStatus_new" USING ("status"::text::"VehicleStatus_new");
ALTER TYPE "VehicleStatus" RENAME TO "VehicleStatus_old";
ALTER TYPE "VehicleStatus_new" RENAME TO "VehicleStatus";
DROP TYPE "VehicleStatus_old";
ALTER TABLE "vehicles" ALTER COLUMN "status" SET DEFAULT 'INACTIVE';
COMMIT;

-- DropIndex
DROP INDEX "driver_profiles_status_verification_idx";

-- DropIndex
DROP INDEX "vehicles_registration_number_key";

-- AlterTable
ALTER TABLE "driver_profiles" DROP CONSTRAINT "driver_profiles_pkey",
DROP COLUMN "status",
ADD COLUMN     "approvedAt" TIMESTAMPTZ(3),
ADD COLUMN     "birthDate" DATE,
ADD COLUMN     "cityId" VARCHAR(64) NOT NULL,
ADD COLUMN     "email" VARCHAR(255),
ADD COLUMN     "id" UUID NOT NULL,
ADD COLUMN     "middleName" VARCHAR(100),
ADD COLUMN     "operationalStatus" "DriverOperationalStatus" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "phone" VARCHAR(16) NOT NULL,
ADD COLUMN     "profilePhotoObjectKey" VARCHAR(512),
ADD COLUMN     "rejectedAt" TIMESTAMPTZ(3),
ADD COLUMN     "submittedAt" TIMESTAMPTZ(3),
ADD COLUMN     "suspendedAt" TIMESTAMPTZ(3),
ADD COLUMN     "verificationComment" VARCHAR(1024),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "verificationStatus" SET DEFAULT 'NOT_STARTED',
ADD CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "vehicles" DROP COLUMN "registrationNumber",
ADD COLUMN     "approvedAt" TIMESTAMPTZ(3),
ADD COLUMN     "category" VARCHAR(32) NOT NULL,
ADD COLUMN     "childSeatAvailable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "luggageCapacity" SMALLINT,
ADD COLUMN     "petAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationNumberEncrypted" VARCHAR(512) NOT NULL,
ADD COLUMN     "registrationNumberHash" VARCHAR(128) NOT NULL,
ADD COLUMN     "registrationNumberMasked" VARCHAR(32) NOT NULL,
ADD COLUMN     "rejectedAt" TIMESTAMPTZ(3),
ADD COLUMN     "seats" SMALLINT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "verificationStatus" "VehicleVerificationStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vinEncrypted" VARCHAR(512),
ADD COLUMN     "vinHash" VARCHAR(128),
ADD COLUMN     "vinLastFour" VARCHAR(4),
ALTER COLUMN "status" SET DEFAULT 'INACTIVE';

-- DropEnum
DROP TYPE "DriverStatus";

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "type" "DriverDocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "objectKey" VARCHAR(512) NOT NULL,
    "previewObjectKey" VARCHAR(512),
    "fileNameSanitized" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(128) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "documentNumberEncrypted" VARCHAR(512),
    "documentNumberHash" VARCHAR(128),
    "documentNumberLastFour" VARCHAR(4),
    "issuedAt" DATE,
    "expiresAt" DATE,
    "issuingCountry" VARCHAR(2) NOT NULL DEFAULT 'RU',
    "rejectionReasonCode" "DocumentRejectionReasonCode",
    "rejectionComment" VARCHAR(1024),
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_documents" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "type" "VehicleDocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "objectKey" VARCHAR(512) NOT NULL,
    "previewObjectKey" VARCHAR(512),
    "fileNameSanitized" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(128) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "documentNumberEncrypted" VARCHAR(512),
    "documentNumberHash" VARCHAR(128),
    "documentNumberLastFour" VARCHAR(4),
    "issuedAt" DATE,
    "expiresAt" DATE,
    "issuingCountry" VARCHAR(2) NOT NULL DEFAULT 'RU',
    "rejectionReasonCode" "DocumentRejectionReasonCode",
    "rejectionComment" VARCHAR(1024),
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "documentFamily" VARCHAR(160) NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "DocumentVersionStatus" NOT NULL DEFAULT 'ACTIVE',
    "driverDocumentId" UUID,
    "vehicleDocumentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ(3),

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_cases" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "status" "VerificationCaseStatus" NOT NULL DEFAULT 'CREATED',
    "submittedSnapshot" JSONB NOT NULL,
    "duplicateCheckResult" JSONB,
    "assignedAdminId" UUID,
    "priority" "VerificationCasePriority" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "decision" "VerificationCaseDecision",
    "decisionReasonCodes" "DocumentRejectionReasonCode"[],
    "publicComment" VARCHAR(1024),
    "internalComment" VARCHAR(2048),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "verification_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_consents" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "consentType" "DriverConsentType" NOT NULL,
    "documentVersion" VARCHAR(32) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" VARCHAR(128),
    "deviceId" VARCHAR(255),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "driver_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_deletion_queue" (
    "id" UUID NOT NULL,
    "documentType" VARCHAR(16) NOT NULL,
    "documentId" UUID NOT NULL,
    "reason" VARCHAR(64) NOT NULL,
    "eligibleAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "DeletionQueueStatus" NOT NULL DEFAULT 'PENDING',
    "legalHoldReason" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "document_deletion_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_documents_object_key_key" ON "driver_documents"("objectKey");

-- CreateIndex
CREATE INDEX "driver_documents_driver_type_idx" ON "driver_documents"("driverId", "type");

-- CreateIndex
CREATE INDEX "driver_documents_status_idx" ON "driver_documents"("status");

-- CreateIndex
CREATE INDEX "driver_documents_expires_at_idx" ON "driver_documents"("expiresAt");

-- CreateIndex
CREATE INDEX "driver_documents_number_hash_idx" ON "driver_documents"("documentNumberHash");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_documents_object_key_key" ON "vehicle_documents"("objectKey");

-- CreateIndex
CREATE INDEX "vehicle_documents_vehicle_type_idx" ON "vehicle_documents"("vehicleId", "type");

-- CreateIndex
CREATE INDEX "vehicle_documents_status_idx" ON "vehicle_documents"("status");

-- CreateIndex
CREATE INDEX "vehicle_documents_expires_at_idx" ON "vehicle_documents"("expiresAt");

-- CreateIndex
CREATE INDEX "vehicle_documents_number_hash_idx" ON "vehicle_documents"("documentNumberHash");

-- CreateIndex
CREATE INDEX "document_versions_family_status_idx" ON "document_versions"("documentFamily", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_family_version_key" ON "document_versions"("documentFamily", "versionNumber");

-- CreateIndex
CREATE INDEX "verification_cases_status_idx" ON "verification_cases"("status");

-- CreateIndex
CREATE INDEX "verification_cases_driver_status_idx" ON "verification_cases"("driverId", "status");

-- CreateIndex
CREATE INDEX "driver_consents_user_type_idx" ON "driver_consents"("userId", "consentType");

-- CreateIndex
CREATE INDEX "document_deletion_queue_status_eligible_idx" ON "document_deletion_queue"("status", "eligibleAt");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_userId_key" ON "driver_profiles"("userId");

-- CreateIndex
CREATE INDEX "driver_profiles_status_verification_idx" ON "driver_profiles"("operationalStatus", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_registration_number_hash_key" ON "vehicles"("registrationNumberHash");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vin_hash_key" ON "vehicles"("vinHash");

-- CreateIndex
CREATE INDEX "vehicles_verification_status_idx" ON "vehicles"("verificationStatus");

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_driverDocumentId_fkey" FOREIGN KEY ("driverDocumentId") REFERENCES "driver_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_vehicleDocumentId_fkey" FOREIGN KEY ("vehicleDocumentId") REFERENCES "vehicle_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_consents" ADD CONSTRAINT "driver_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

