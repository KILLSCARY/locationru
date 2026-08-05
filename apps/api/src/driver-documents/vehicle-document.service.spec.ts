import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import type { DocumentProcessingPipelineService } from '../document-processing/document-processing-pipeline.service.js';
import {
  DocumentStatus,
  VehicleVerificationStatus,
} from '../generated/prisma/client.js';
import type { MetricsService } from '../observability/metrics.service.js';
import type { ObjectStorageProvider } from '../storage/object-storage-provider.interface.js';
import type { DocumentUploadRateLimitService } from './document-upload-rate-limit.service.js';
import type { DocumentVersionService } from './document-version.service.js';
import { VehicleDocumentService } from './vehicle-document.service.js';

const DRIVER_ID = 'driver-1';
const VEHICLE_ID = 'vehicle-1';

interface VehicleDocumentRow {
  id: string;
  vehicleId: string;
  type: string;
  status: DocumentStatus;
  objectKey: string;
  previewObjectKey: string | null;
  mimeType: string;
  fileSize: number;
  fileNameSanitized: string;
  issuedAt: Date | null;
  expiresAt: Date | null;
  rejectionReasonCode: string | null;
  rejectionComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeRow(
  overrides: Partial<VehicleDocumentRow> = {},
): VehicleDocumentRow {
  return {
    id: 'vdoc-1',
    vehicleId: VEHICLE_ID,
    type: 'VEHICLE_REGISTRATION',
    status: DocumentStatus.UPLOADING,
    objectKey: `pending/${VEHICLE_ID}/abc.jpg`,
    previewObjectKey: null,
    mimeType: 'image/jpeg',
    fileSize: 1_000,
    fileNameSanitized: 'sts.jpg',
    issuedAt: null,
    expiresAt: null,
    rejectionReasonCode: null,
    rejectionComment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakePrisma {
  documents = new Map<string, VehicleDocumentRow>();
  vehicle_: { id: string; driverId: string } | null = {
    id: VEHICLE_ID,
    driverId: DRIVER_ID,
  };
  vehicleUpdateManyCalls: unknown[] = [];
  openVerificationCase: { id: string } | null = null;
  deletionQueueEntries: unknown[] = [];

  vehicleDocument = {
    findFirst: async ({
      where,
    }: {
      where: { vehicleId: string; type: string; status: DocumentStatus };
    }) => {
      for (const doc of this.documents.values()) {
        if (
          doc.vehicleId === where.vehicleId &&
          doc.type === where.type &&
          doc.status === where.status
        ) {
          return doc;
        }
      }
      return null;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.documents.get(where.id) ?? null,
    findMany: async ({ where }: { where: { vehicleId: string } }) =>
      [...this.documents.values()].filter(
        (doc) => doc.vehicleId === where.vehicleId,
      ),
    create: async ({ data }: { data: Partial<VehicleDocumentRow> }) => {
      const row = makeRow({ id: `vdoc-${this.documents.size + 1}`, ...data });
      this.documents.set(row.id, row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<VehicleDocumentRow> & { version?: { increment: number } };
    }) => {
      const existing = this.documents.get(where.id);
      if (!existing) throw new Error('not found in fake');
      const updated: VehicleDocumentRow = { ...existing, ...data };
      this.documents.set(where.id, updated);
      return updated;
    },
  };

  vehicle = {
    findUnique: async () => this.vehicle_,
    updateMany: async (args: unknown) => {
      this.vehicleUpdateManyCalls.push(args);
      return { count: 1 };
    },
  };

  verificationCase = {
    findFirst: async () => this.openVerificationCase,
  };

  documentDeletionQueueEntry = {
    create: async ({ data }: { data: unknown }) => {
      this.deletionQueueEntries.push(data);
      return data;
    },
  };

  async $transaction<T>(operations: Promise<T>[]): Promise<T[]> {
    return Promise.all(operations);
  }
}

function buildService(
  overrides: {
    pipeline?: Partial<DocumentProcessingPipelineService>;
    versions?: Partial<DocumentVersionService>;
  } = {},
) {
  const prisma = new FakePrisma();
  const config = new ConfigService({
    documents: {
      imageMaxBytes: 10 * 1024 * 1024,
      pdfMaxBytes: 15 * 1024 * 1024,
      pendingRetentionHours: 24,
    },
  });
  const storage: Partial<ObjectStorageProvider> = {
    createDocumentUploadUrl: async () => ({
      url: 'https://storage.local/upload',
      expiresInSeconds: 300,
    }),
    confirmDocumentUpload: async () => ({
      sizeBytes: 1_000,
      mimeType: 'image/jpeg',
      lastModified: new Date(),
    }),
  };
  const metrics: Partial<MetricsService> = { increment: () => undefined };
  const rateLimit: Partial<DocumentUploadRateLimitService> = {
    checkRequestUploadUrl: async () => undefined,
  };
  const pipeline: Partial<DocumentProcessingPipelineService> = {
    process: async () => ({
      outcome: 'READY_FOR_REVIEW',
      quarantineObjectKey: 'quarantine/x.jpg',
      previewObjectKey: 'quarantine/x-preview.jpg',
    }),
    ...overrides.pipeline,
  };
  const versions: Partial<DocumentVersionService> = {
    recordNewVersion: async () => ({ isReplacement: false }),
    ...overrides.versions,
  };

  const service = new VehicleDocumentService(
    config,
    prisma as unknown as PrismaService,
    storage as ObjectStorageProvider,
    pipeline as DocumentProcessingPipelineService,
    metrics as MetricsService,
    rateLimit as DocumentUploadRateLimitService,
    versions as DocumentVersionService,
  );

  return { service, prisma };
}

describe('VehicleDocumentService', () => {
  it('rejects requesting an upload URL for a vehicle owned by a different driver', async () => {
    const { service, prisma } = buildService();
    prisma.vehicle_ = { id: VEHICLE_ID, driverId: 'other-driver' };

    await expect(
      service.requestUploadUrl(DRIVER_ID, VEHICLE_ID, {
        documentType: 'VEHICLE_REGISTRATION',
        fileName: 'sts.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1_000,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFoundException when the vehicle does not exist', async () => {
    const { service, prisma } = buildService();
    prisma.vehicle_ = null;

    await expect(
      service.requestUploadUrl(DRIVER_ID, VEHICLE_ID, {
        documentType: 'VEHICLE_REGISTRATION',
        fileName: 'sts.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1_000,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an oversized vehicle document', async () => {
    const { service } = buildService();

    await expect(
      service.requestUploadUrl(DRIVER_ID, VEHICLE_ID, {
        documentType: 'VEHICLE_REGISTRATION',
        fileName: 'sts.jpg',
        mimeType: 'image/jpeg',
        fileSize: 11 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('completes the upload/confirm flow and reaches READY_FOR_REVIEW', async () => {
    const { service, prisma } = buildService();
    prisma.documents.set('vdoc-1', makeRow());

    const result = await service.confirmUpload(DRIVER_ID, VEHICLE_ID, 'vdoc-1');

    expect(result.status).toBe(DocumentStatus.READY_FOR_REVIEW);
  });

  it('rejects confirming a document for a vehicle the caller does not own', async () => {
    const { service, prisma } = buildService();
    prisma.documents.set('vdoc-1', makeRow());
    prisma.vehicle_ = { id: VEHICLE_ID, driverId: 'other-driver' };

    await expect(
      service.confirmUpload(DRIVER_ID, VEHICLE_ID, 'vdoc-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reverts an APPROVED vehicle to UNDER_REVIEW when a replacement document is confirmed', async () => {
    const { service, prisma } = buildService({
      versions: { recordNewVersion: async () => ({ isReplacement: true }) },
    });
    prisma.documents.set('vdoc-1', makeRow());

    await service.confirmUpload(DRIVER_ID, VEHICLE_ID, 'vdoc-1');

    expect(prisma.vehicleUpdateManyCalls).toHaveLength(1);
    expect(prisma.vehicleUpdateManyCalls[0]).toMatchObject({
      where: {
        id: VEHICLE_ID,
        verificationStatus: VehicleVerificationStatus.APPROVED,
      },
      data: { verificationStatus: VehicleVerificationStatus.UNDER_REVIEW },
    });
  });

  it('does not revert the vehicle when the upload is not a replacement', async () => {
    const { service, prisma } = buildService();
    prisma.documents.set('vdoc-1', makeRow());

    await service.confirmUpload(DRIVER_ID, VEHICLE_ID, 'vdoc-1');

    expect(prisma.vehicleUpdateManyCalls).toHaveLength(0);
  });

  it('rejects deleting an APPROVED vehicle document', async () => {
    const { service, prisma } = buildService();
    prisma.documents.set(
      'vdoc-1',
      makeRow({ status: DocumentStatus.APPROVED }),
    );

    await expect(
      service.deleteDocument(DRIVER_ID, VEHICLE_ID, 'vdoc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects deleting a READY_FOR_REVIEW vehicle document while an open verification case exists', async () => {
    const { service, prisma } = buildService();
    prisma.documents.set(
      'vdoc-1',
      makeRow({ status: DocumentStatus.READY_FOR_REVIEW }),
    );
    prisma.openVerificationCase = { id: 'case-1' };

    await expect(
      service.deleteDocument(DRIVER_ID, VEHICLE_ID, 'vdoc-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows deleting a REJECTED vehicle document and queues it for retention deletion', async () => {
    const { service, prisma } = buildService();
    prisma.documents.set(
      'vdoc-1',
      makeRow({ status: DocumentStatus.REJECTED }),
    );

    await service.deleteDocument(DRIVER_ID, VEHICLE_ID, 'vdoc-1');

    expect(prisma.documents.get('vdoc-1')?.status).toBe(DocumentStatus.REVOKED);
    expect(prisma.deletionQueueEntries).toHaveLength(1);
  });

  it('throws NotFoundException for a document that belongs to a different vehicle', async () => {
    const { service, prisma } = buildService();
    prisma.documents.set('vdoc-1', makeRow({ vehicleId: 'other-vehicle' }));

    await expect(
      service.deleteDocument(DRIVER_ID, VEHICLE_ID, 'vdoc-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
