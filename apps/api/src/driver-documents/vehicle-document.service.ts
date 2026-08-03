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
import {
  DocumentStatus,
  VehicleVerificationStatus,
} from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import {
  OBJECT_STORAGE_PROVIDER,
  type ObjectStorageProvider,
} from '../storage/object-storage-provider.interface.js';
import {
  extensionForMimeType,
  sanitizeAndValidateFileName,
} from './document-filename.util.js';
import { DocumentUploadRateLimitService } from './document-upload-rate-limit.service.js';
import { DocumentVersionService } from './document-version.service.js';
import type { RequestVehicleDocumentUploadUrlDto } from './dto/request-vehicle-document-upload-url.dto.js';

/** Mirrors DriverDocumentService — see its header comment for why this isn't a shared generic base. */
@Injectable()
export class VehicleDocumentService {
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
    vehicleId: string,
    input: RequestVehicleDocumentUploadUrlDto,
  ) {
    await this.rateLimit.checkRequestUploadUrl(driverId);
    await this.requireOwnedVehicle(driverId, vehicleId);
    this.assertAllowedSize(input.mimeType, input.fileSize);
    const fileNameSanitized = sanitizeAndValidateFileName(input.fileName);

    const abandoned = await this.prisma.vehicleDocument.findFirst({
      where: {
        vehicleId,
        type: input.documentType,
        status: DocumentStatus.UPLOADING,
      },
    });

    const objectKey = `pending/${vehicleId}/${randomUUID()}.${extensionForMimeType(input.mimeType)}`;
    const document = abandoned
      ? await this.prisma.vehicleDocument.update({
          where: { id: abandoned.id },
          data: {
            objectKey,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            fileNameSanitized,
            version: { increment: 1 },
          },
        })
      : await this.prisma.vehicleDocument.create({
          data: {
            vehicleId,
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
      { documentKind: 'vehicle' },
    );

    return {
      documentId: document.id,
      uploadUrl: url,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1_000).toISOString(),
      requiredHeaders: { 'Content-Type': input.mimeType },
    };
  }

  async confirmUpload(driverId: string, vehicleId: string, documentId: string) {
    await this.requireOwnedVehicle(driverId, vehicleId);
    const document = await this.requireDocument(vehicleId, documentId);
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

    await this.prisma.vehicleDocument.update({
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
        { documentKind: 'vehicle' },
      );
      return this.prisma.vehicleDocument.update({
        where: { id: document.id },
        data: { status: DocumentStatus.FAILED_SECURITY_CHECK },
      });
    }

    const updated = await this.prisma.vehicleDocument.update({
      where: { id: document.id },
      data: {
        status: DocumentStatus.READY_FOR_REVIEW,
        objectKey: outcome.quarantineObjectKey,
        previewObjectKey: outcome.previewObjectKey,
      },
    });
    const { isReplacement } = await this.versions.recordNewVersion(
      `vehicle:${vehicleId}:${document.type}`,
      { vehicleDocumentId: document.id },
    );
    if (isReplacement) {
      // A previously-approved vehicle document is being replaced — the
      // vehicle can no longer be considered fully verified until the new
      // version is reviewed (Task 29 section 5/16).
      await this.prisma.vehicle.updateMany({
        where: {
          id: vehicleId,
          verificationStatus: VehicleVerificationStatus.APPROVED,
        },
        data: { verificationStatus: VehicleVerificationStatus.UNDER_REVIEW },
      });
    }
    this.metrics.increment(
      'document_upload_completed_total',
      'Documents that finished processing and reached READY_FOR_REVIEW',
      { documentKind: 'vehicle' },
    );
    return updated;
  }

  async listDocuments(driverId: string, vehicleId: string) {
    await this.requireOwnedVehicle(driverId, vehicleId);
    const documents = await this.prisma.vehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((document) => this.toSummary(document));
  }

  async deleteDocument(
    driverId: string,
    vehicleId: string,
    documentId: string,
  ): Promise<void> {
    await this.requireOwnedVehicle(driverId, vehicleId);
    const document = await this.requireDocument(vehicleId, documentId);
    if (document.status === DocumentStatus.APPROVED) {
      throw new ConflictException({
        code: 'CANNOT_DELETE_APPROVED_DOCUMENT',
        message:
          'An approved document cannot be deleted — upload a replacement to start a new review instead',
      });
    }

    await this.prisma.$transaction([
      this.prisma.vehicleDocument.update({
        where: { id: document.id },
        data: { status: DocumentStatus.REVOKED },
      }),
      this.prisma.documentDeletionQueueEntry.create({
        data: {
          documentType: 'VEHICLE',
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

  private async requireOwnedVehicle(driverId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, driverId: true },
    });
    if (!vehicle) {
      throw new NotFoundException({
        code: 'VEHICLE_NOT_FOUND',
        message: 'Vehicle was not found',
      });
    }
    if (vehicle.driverId !== driverId) {
      throw new ForbiddenException({
        code: 'VEHICLE_ACCESS_DENIED',
        message: 'You do not own this vehicle',
      });
    }
    return vehicle;
  }

  private async requireDocument(vehicleId: string, documentId: string) {
    const document = await this.prisma.vehicleDocument.findUnique({
      where: { id: documentId },
    });
    if (!document || document.vehicleId !== vehicleId) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document was not found',
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
