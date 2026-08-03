import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { DocumentProcessingPipelineService } from '../document-processing/document-processing-pipeline.service.js';
import { DocumentStatus } from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import {
  OBJECT_STORAGE_PROVIDER,
  type ObjectStorageProvider,
} from '../storage/object-storage-provider.interface.js';
import { DocumentUploadRateLimitService } from './document-upload-rate-limit.service.js';
import {
  extensionForMimeType,
  sanitizeAndValidateFileName,
} from './document-filename.util.js';
import { DocumentVersionService } from './document-version.service.js';
import type { RequestDriverDocumentUploadUrlDto } from './dto/request-document-upload-url.dto.js';

const DOWNLOAD_SHORT_TTL_SECONDS = 60;

/**
 * Driver document upload/confirm/list/get/delete (Task 29 section 10).
 * Structurally identical to VehicleDocumentService — kept as a separate
 * class rather than a shared generic base because the two operate on
 * different Prisma models with different ownership checks (driverId vs.
 * vehicle.driverId), and forcing a shared abstraction over that would cost
 * more in indirection than it saves in line count.
 */
@Injectable()
export class DriverDocumentService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE_PROVIDER)
    private readonly storage: ObjectStorageProvider,
    private readonly pipeline: DocumentProcessingPipelineService,
    private readonly metrics: MetricsService,
    private readonly rateLimit: DocumentUploadRateLimitService,
    private readonly versions: DocumentVersionService,
  ) {}

  async requestUploadUrl(
    driverId: string,
    input: RequestDriverDocumentUploadUrlDto,
  ) {
    await this.rateLimit.checkRequestUploadUrl(driverId);
    this.assertAllowedSize(input.mimeType, input.fileSize);
    const fileNameSanitized = sanitizeAndValidateFileName(input.fileName);

    // Idempotent against retries: an abandoned UPLOADING row for the same
    // (driver, type) is reused (fresh object key + presigned URL) instead of
    // accumulating orphaned pending rows — see docs/drivers/documents.md.
    const abandoned = await this.prisma.driverDocument.findFirst({
      where: {
        driverId,
        type: input.documentType,
        status: DocumentStatus.UPLOADING,
      },
    });

    const objectKey = `pending/${driverId}/${randomUUID()}.${extensionForMimeType(input.mimeType)}`;
    const document = abandoned
      ? await this.prisma.driverDocument.update({
          where: { id: abandoned.id },
          data: {
            objectKey,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            fileNameSanitized,
            version: { increment: 1 },
          },
        })
      : await this.prisma.driverDocument.create({
          data: {
            driverId,
            type: input.documentType,
            status: DocumentStatus.UPLOADING,
            objectKey,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            fileNameSanitized,
          },
        });

    const { url, expiresInSeconds } =
      await this.storage.createDocumentUploadUrl(objectKey, input.mimeType);
    this.metrics.increment(
      'document_upload_started_total',
      'Document uploads for which a presigned upload URL was issued',
      { documentKind: 'driver' },
    );

    return {
      documentId: document.id,
      uploadUrl: url,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1_000).toISOString(),
      requiredHeaders: { 'Content-Type': input.mimeType },
    };
  }

  async confirmUpload(driverId: string, documentId: string) {
    const document = await this.requireOwnedDocument(driverId, documentId);
    if (document.status !== DocumentStatus.UPLOADING) {
      throw new ConflictException({
        code: 'DOCUMENT_NOT_AWAITING_UPLOAD',
        message: 'This document is not awaiting an upload confirmation',
      });
    }

    const metadata = await this.storage.confirmDocumentUpload(
      document.objectKey,
    );
    if (!metadata) {
      throw new BadRequestException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'No object was found at the presigned upload location yet',
      });
    }
    this.assertAllowedSize(document.mimeType, metadata.sizeBytes);

    await this.prisma.driverDocument.update({
      where: { id: document.id },
      data: { status: DocumentStatus.PROCESSING, fileSize: metadata.sizeBytes },
    });

    const outcome = await this.pipeline.process({
      objectKey: document.objectKey,
      mimeType: document.mimeType,
      fileSize: metadata.sizeBytes,
    });

    if (outcome.outcome === 'FAILED_SECURITY_CHECK') {
      this.metrics.increment(
        'document_security_failed_total',
        'Documents that failed the security/validation pipeline',
        { documentKind: 'driver' },
      );
      return this.prisma.driverDocument.update({
        where: { id: document.id },
        data: { status: DocumentStatus.FAILED_SECURITY_CHECK },
      });
    }

    const updated = await this.prisma.driverDocument.update({
      where: { id: document.id },
      data: {
        status: DocumentStatus.READY_FOR_REVIEW,
        objectKey: outcome.quarantineObjectKey,
        previewObjectKey: outcome.previewObjectKey,
      },
    });
    await this.versions.recordNewVersion(
      `driver:${driverId}:${document.type}`,
      { driverDocumentId: document.id },
    );
    this.metrics.increment(
      'document_upload_completed_total',
      'Documents that finished processing and reached READY_FOR_REVIEW',
      { documentKind: 'driver' },
    );
    return updated;
  }

  async listDocuments(driverId: string) {
    const documents = await this.prisma.driverDocument.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
    });
    // Never includes a download URL — see docs/drivers/documents.md.
    return documents.map((document) => this.toSummary(document));
  }

  async getDocument(driverId: string, documentId: string) {
    const document = await this.requireOwnedDocument(driverId, documentId);
    const previewUrl = document.previewObjectKey
      ? await this.storage.createSecureDownloadUrl(
          document.previewObjectKey,
          DOWNLOAD_SHORT_TTL_SECONDS,
        )
      : null;
    return {
      ...this.toSummary(document),
      previewUrl: previewUrl?.url ?? null,
      previewUrlExpiresAt: previewUrl
        ? new Date(
            Date.now() + previewUrl.expiresInSeconds * 1_000,
          ).toISOString()
        : null,
    };
  }

  async deleteDocument(driverId: string, documentId: string): Promise<void> {
    const document = await this.requireOwnedDocument(driverId, documentId);
    if (document.status === DocumentStatus.APPROVED) {
      throw new ConflictException({
        code: 'CANNOT_DELETE_APPROVED_DOCUMENT',
        message:
          'An approved document cannot be deleted — upload a replacement to start a new review instead',
      });
    }

    await this.prisma.$transaction([
      this.prisma.driverDocument.update({
        where: { id: document.id },
        data: { status: DocumentStatus.REVOKED },
      }),
      this.prisma.documentDeletionQueueEntry.create({
        data: {
          documentType: 'DRIVER',
          documentId: document.id,
          reason: 'USER_REQUESTED',
          eligibleAt: new Date(
            Date.now() +
              this.config.getOrThrow<number>(
                'documents.pendingRetentionHours',
              ) *
                3_600_000,
          ),
        },
      }),
    ]);
  }

  private assertAllowedSize(mimeType: string, sizeBytes: number): void {
    const maxBytes =
      mimeType === 'application/pdf'
        ? this.config.getOrThrow<number>('documents.pdfMaxBytes')
        : this.config.getOrThrow<number>('documents.imageMaxBytes');
    if (sizeBytes > maxBytes) {
      throw new BadRequestException({
        code: 'DOCUMENT_TOO_LARGE',
        message: `Document exceeds the ${maxBytes}-byte limit for ${mimeType}`,
      });
    }
  }

  private async requireOwnedDocument(driverId: string, documentId: string) {
    const document = await this.prisma.driverDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document was not found',
      });
    }
    if (document.driverId !== driverId) {
      throw new ForbiddenException({
        code: 'DOCUMENT_ACCESS_DENIED',
        message: 'You do not own this document',
      });
    }
    return document;
  }

  private toSummary(document: {
    id: string;
    type: string;
    status: string;
    fileNameSanitized: string;
    mimeType: string;
    fileSize: number;
    issuedAt: Date | null;
    expiresAt: Date | null;
    rejectionReasonCode: string | null;
    rejectionComment: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: document.id,
      type: document.type,
      status: document.status,
      fileNameSanitized: document.fileNameSanitized,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      issuedAt: document.issuedAt,
      expiresAt: document.expiresAt,
      rejectionReasonCode: document.rejectionReasonCode,
      rejectionComment: document.rejectionComment,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
