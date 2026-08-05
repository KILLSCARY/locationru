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
  DriverVerificationStatus,
} from '../generated/prisma/client.js';
import type { MetricsService } from '../observability/metrics.service.js';
import type { ObjectStorageProvider } from '../storage/object-storage-provider.interface.js';
import type { DocumentUploadRateLimitService } from './document-upload-rate-limit.service.js';
import { DriverDocumentService } from './driver-document.service.js';
import type { DocumentVersionService } from './document-version.service.js';

const DRIVER_ID = 'driver-1';

interface DriverDocumentRow {
  id: string;
  driverId: string;
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
  version: number;
}

function makeRow(
  overrides: Partial<DriverDocumentRow> = {},
): DriverDocumentRow {
  return {
    id: 'doc-1',
    driverId: DRIVER_ID,
    type: 'PASSPORT_MAIN_PAGE',
    status: DocumentStatus.UPLOADING,
    objectKey: `pending/${DRIVER_ID}/abc.jpg`,
    previewObjectKey: null,
    mimeType: 'image/jpeg',
    fileSize: 1_000,
    fileNameSanitized: 'passport.jpg',
    issuedAt: null,
    expiresAt: null,
    rejectionReasonCode: null,
    rejectionComment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 0,
    ...overrides,
  };
}

class FakePrisma {
  documents = new Map<string, DriverDocumentRow>();
  profileUpdateManyCalls: unknown[] = [];
  openVerificationCase: { id: string } | null = null;
  deletionQueueEntries: unknown[] = [];

  driverDocument = {
    findFirst: async ({
      where,
    }: {
      where: { driverId: string; type: string; status: DocumentStatus };
    }) => {
      for (const doc of this.documents.values()) {
        if (
          doc.driverId === where.driverId &&
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
    findMany: async ({ where }: { where: { driverId: string } }) =>
      [...this.documents.values()].filter(
        (doc) => doc.driverId === where.driverId,
      ),
    create: async ({ data }: { data: Partial<DriverDocumentRow> }) => {
      const row = makeRow({ id: `doc-${this.documents.size + 1}`, ...data });
      this.documents.set(row.id, row);
      return row;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<DriverDocumentRow> & {
        version?: { increment: number };
      };
    }) => {
      const existing = this.documents.get(where.id);
      if (!existing) throw new Error('not found in fake');
      const { version, ...rest } = data;
      const updated: DriverDocumentRow = {
        ...existing,
        ...rest,
        version: version
          ? existing.version + version.increment
          : existing.version,
      };
      this.documents.set(where.id, updated);
      return updated;
    },
  };

  driverProfile = {
    updateMany: async (args: unknown) => {
      this.profileUpdateManyCalls.push(args);
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
    storage?: Partial<ObjectStorageProvider>;
    pipeline?: Partial<DocumentProcessingPipelineService>;
    metrics?: Partial<MetricsService>;
    rateLimit?: Partial<DocumentUploadRateLimitService>;
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
    createSecureDownloadUrl: async (key: string) => ({
      url: `https://storage.local/${key}`,
      expiresInSeconds: 60,
    }),
    ...overrides.storage,
  };
  const incrementCalls: [string, ...unknown[]][] = [];
  const metrics: Partial<MetricsService> = {
    increment: (...args: [string, ...unknown[]]) => {
      incrementCalls.push(args);
    },
    ...overrides.metrics,
  };
  const rateLimit: Partial<DocumentUploadRateLimitService> = {
    checkRequestUploadUrl: async () => undefined,
    ...overrides.rateLimit,
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

  const service = new DriverDocumentService(
    config,
    prisma as unknown as PrismaService,
    storage as ObjectStorageProvider,
    pipeline as DocumentProcessingPipelineService,
    metrics as MetricsService,
    rateLimit as DocumentUploadRateLimitService,
    versions as DocumentVersionService,
  );

  return { service, prisma, incrementCalls };
}

describe('DriverDocumentService', () => {
  describe('requestUploadUrl', () => {
    it('creates a new UPLOADING document and issues a presigned URL', async () => {
      const { service, prisma, incrementCalls } = buildService();

      const result = await service.requestUploadUrl(DRIVER_ID, {
        documentType: 'PASSPORT_MAIN_PAGE',
        fileName: 'passport.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1_000,
      });

      expect(result.uploadUrl).toBe('https://storage.local/upload');
      expect(prisma.documents.size).toBe(1);
      expect(incrementCalls.map((c) => c[0])).toContain(
        'document_upload_started_total',
      );
    });

    it('reuses an abandoned UPLOADING row for the same driver/type instead of creating a new one', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set(
        'doc-existing',
        makeRow({ id: 'doc-existing', status: DocumentStatus.UPLOADING }),
      );

      const result = await service.requestUploadUrl(DRIVER_ID, {
        documentType: 'PASSPORT_MAIN_PAGE',
        fileName: 'passport-retry.jpg',
        mimeType: 'image/jpeg',
        fileSize: 2_000,
      });

      expect(result.documentId).toBe('doc-existing');
      expect(prisma.documents.size).toBe(1);
    });

    it('rejects a file above the configured size limit before ever contacting storage', async () => {
      const { service } = buildService();

      await expect(
        service.requestUploadUrl(DRIVER_ID, {
          documentType: 'PASSPORT_MAIN_PAGE',
          fileName: 'huge.jpg',
          mimeType: 'image/jpeg',
          fileSize: 11 * 1024 * 1024,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a disallowed/double-extension file name', async () => {
      const { service } = buildService();

      await expect(
        service.requestUploadUrl(DRIVER_ID, {
          documentType: 'PASSPORT_MAIN_PAGE',
          fileName: 'passport.jpg.exe',
          mimeType: 'image/jpeg',
          fileSize: 1_000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('confirmUpload', () => {
    it('moves an UPLOADING document through the pipeline to READY_FOR_REVIEW on success', async () => {
      const { service, prisma, incrementCalls } = buildService();
      prisma.documents.set('doc-1', makeRow());

      const result = await service.confirmUpload(DRIVER_ID, 'doc-1');

      expect(result.status).toBe(DocumentStatus.READY_FOR_REVIEW);
      expect(incrementCalls.map((c) => c[0])).toContain(
        'document_upload_completed_total',
      );
    });

    it('rejects confirming a document that is not owned by the caller', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set('doc-1', makeRow({ driverId: 'other-driver' }));

      await expect(
        service.confirmUpload(DRIVER_ID, 'doc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException for a nonexistent document', async () => {
      const { service } = buildService();

      await expect(
        service.confirmUpload(DRIVER_ID, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects confirming a document that is not awaiting upload', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set(
        'doc-1',
        makeRow({ status: DocumentStatus.READY_FOR_REVIEW }),
      );

      await expect(
        service.confirmUpload(DRIVER_ID, 'doc-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('marks the document FAILED_SECURITY_CHECK and increments the security-failed metric when the pipeline rejects it', async () => {
      const { service, prisma, incrementCalls } = buildService({
        pipeline: {
          process: async () => ({
            outcome: 'FAILED_SECURITY_CHECK',
            reason: 'MALWARE_DETECTED',
          }),
        },
      });
      prisma.documents.set('doc-1', makeRow());

      const result = await service.confirmUpload(DRIVER_ID, 'doc-1');

      expect(result.status).toBe(DocumentStatus.FAILED_SECURITY_CHECK);
      expect(incrementCalls.map((c) => c[0])).toContain(
        'document_security_failed_total',
      );
    });

    it('reverts an APPROVED profile to UNDER_REVIEW when the new version replaces a previously-decided one', async () => {
      const { service, prisma } = buildService({
        versions: {
          recordNewVersion: async () => ({ isReplacement: true }),
        },
      });
      prisma.documents.set('doc-1', makeRow());

      await service.confirmUpload(DRIVER_ID, 'doc-1');

      expect(prisma.profileUpdateManyCalls).toHaveLength(1);
      expect(prisma.profileUpdateManyCalls[0]).toMatchObject({
        where: {
          userId: DRIVER_ID,
          verificationStatus: DriverVerificationStatus.APPROVED,
        },
        data: { verificationStatus: DriverVerificationStatus.UNDER_REVIEW },
      });
    });

    it('does not touch the profile status when the upload is not a replacement', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set('doc-1', makeRow());

      await service.confirmUpload(DRIVER_ID, 'doc-1');

      expect(prisma.profileUpdateManyCalls).toHaveLength(0);
    });

    it('throws when the storage side has no object at the presigned location yet', async () => {
      const { service, prisma } = buildService({
        storage: { confirmDocumentUpload: async () => null },
      });
      prisma.documents.set('doc-1', makeRow());

      await expect(
        service.confirmUpload(DRIVER_ID, 'doc-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getDocument', () => {
    it('never returns a raw storage URL for an unreviewed preview (only a short-lived signed one)', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set(
        'doc-1',
        makeRow({ previewObjectKey: 'quarantine/doc-1-preview.jpg' }),
      );

      const result = await service.getDocument(DRIVER_ID, 'doc-1');

      expect(result.previewUrl).toBe(
        'https://storage.local/quarantine/doc-1-preview.jpg',
      );
    });

    it('returns a null preview URL when no preview has been generated yet', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set('doc-1', makeRow({ previewObjectKey: null }));

      const result = await service.getDocument(DRIVER_ID, 'doc-1');

      expect(result.previewUrl).toBeNull();
    });
  });

  describe('deleteDocument', () => {
    it('rejects deleting an APPROVED document', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set(
        'doc-1',
        makeRow({ status: DocumentStatus.APPROVED }),
      );

      await expect(
        service.deleteDocument(DRIVER_ID, 'doc-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects deleting a READY_FOR_REVIEW document while an open verification case exists', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set(
        'doc-1',
        makeRow({ status: DocumentStatus.READY_FOR_REVIEW }),
      );
      prisma.openVerificationCase = { id: 'case-1' };

      await expect(
        service.deleteDocument(DRIVER_ID, 'doc-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows deleting a READY_FOR_REVIEW document when there is no open case, queuing it for retention deletion', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set(
        'doc-1',
        makeRow({ status: DocumentStatus.READY_FOR_REVIEW }),
      );
      prisma.openVerificationCase = null;

      await service.deleteDocument(DRIVER_ID, 'doc-1');

      expect(prisma.documents.get('doc-1')?.status).toBe(
        DocumentStatus.REVOKED,
      );
      expect(prisma.deletionQueueEntries).toHaveLength(1);
    });

    it('allows deleting a REJECTED document freely (no open-case check applies outside READY_FOR_REVIEW)', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set(
        'doc-1',
        makeRow({ status: DocumentStatus.REJECTED }),
      );
      prisma.openVerificationCase = { id: 'case-1' };

      await service.deleteDocument(DRIVER_ID, 'doc-1');

      expect(prisma.documents.get('doc-1')?.status).toBe(
        DocumentStatus.REVOKED,
      );
    });

    it('rejects deleting a document owned by a different driver', async () => {
      const { service, prisma } = buildService();
      prisma.documents.set('doc-1', makeRow({ driverId: 'someone-else' }));

      await expect(
        service.deleteDocument(DRIVER_ID, 'doc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
