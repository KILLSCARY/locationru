-- CreateEnum
CREATE TYPE "StoredDocumentStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'DELETED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- CreateTable
CREATE TABLE "stored_documents" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "mimeType" VARCHAR(128) NOT NULL,
    "sizeBytes" INTEGER,
    "status" "StoredDocumentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "originalFilename" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stored_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_documents_object_key_key" ON "stored_documents"("objectKey");

-- CreateIndex
CREATE INDEX "stored_documents_owner_created_at_idx" ON "stored_documents"("ownerId", "createdAt");

-- AddForeignKey
ALTER TABLE "stored_documents" ADD CONSTRAINT "stored_documents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
