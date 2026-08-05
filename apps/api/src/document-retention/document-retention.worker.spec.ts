import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import {
  DeletionQueueStatus,
  DocumentStatus,
} from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import type { ObjectStorageProvider } from '../storage/object-storage-provider.interface.js';
import { DocumentRetentionWorker } from './document-retention.worker.js';

const CONFIG = new ConfigService({
  app: { environment: 'test' },
  documents: { expirationCheckIntervalMs: 3_600_000 },
});

class InMemoryPrisma {
  queueEntries: Array<Record<string, unknown>> = [];
  driverDocuments: Record<string, Record<string, unknown>> = {};

  readonly documentDeletionQueueEntry = {
    findMany: async ({
      where,
    }: {
      where: { status: DeletionQueueStatus; eligibleAt: { lte: Date } };
    }) =>
      this.queueEntries.filter(
        (entry) =>
          entry.status === where.status &&
          (entry.eligibleAt as Date).getTime() <=
            where.eligibleAt.lte.getTime(),
      ),
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const entry = this.queueEntries.find((e) => e.id === where.id);
      Object.assign(entry as object, data);
      return entry;
    },
  };

  readonly driverDocument = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.driverDocuments[where.id] ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      Object.assign(this.driverDocuments[where.id] as object, data);
      return this.driverDocuments[where.id];
    },
  };

  readonly vehicleDocument = {
    findUnique: async () => null,
    update: async () => ({}),
  };
}

describe('DocumentRetentionWorker', () => {
  let prisma: InMemoryPrisma;
  let metrics: MetricsService;
  let deletedKeys: string[];
  let worker: DocumentRetentionWorker;

  beforeEach(() => {
    prisma = new InMemoryPrisma();
    metrics = new MetricsService();
    deletedKeys = [];
    const fakeStorage = {
      deleteObject: async (objectKey: string) => {
        deletedKeys.push(objectKey);
      },
    } as unknown as ObjectStorageProvider;

    worker = new DocumentRetentionWorker(
      CONFIG,
      prisma as unknown as PrismaService,
      fakeStorage,
      metrics,
    );
  });

  it('deletes storage objects and scrubs PII for a due, non-approved document', async () => {
    prisma.queueEntries.push({
      id: 'queue-1',
      documentType: 'DRIVER',
      documentId: 'doc-1',
      status: DeletionQueueStatus.PENDING,
      eligibleAt: new Date(Date.now() - 1_000),
    });
    prisma.driverDocuments['doc-1'] = {
      id: 'doc-1',
      status: DocumentStatus.REVOKED,
      objectKey: 'verified/doc-1.jpg',
      previewObjectKey: 'verified/doc-1-preview.jpg',
      documentNumberEncrypted: 'cipher',
      documentNumberHash: 'hash',
      documentNumberLastFour: '1234',
    };

    await worker.runSweep();

    expect(deletedKeys).toEqual([
      'verified/doc-1.jpg',
      'verified/doc-1-preview.jpg',
    ]);
    expect(prisma.driverDocuments['doc-1'].documentNumberEncrypted).toBeNull();
    expect(prisma.driverDocuments['doc-1'].documentNumberHash).toBeNull();
    expect(prisma.queueEntries[0].status).toBe(DeletionQueueStatus.DELETED);
  });

  it('never processes an entry still on legal hold', async () => {
    prisma.queueEntries.push({
      id: 'queue-2',
      documentType: 'DRIVER',
      documentId: 'doc-2',
      status: DeletionQueueStatus.LEGAL_HOLD,
      eligibleAt: new Date(Date.now() - 1_000),
    });

    await worker.runSweep();

    expect(deletedKeys).toHaveLength(0);
    expect(prisma.queueEntries[0].status).toBe(DeletionQueueStatus.LEGAL_HOLD);
  });

  it('skips deletion and just marks done if the document was re-approved', async () => {
    prisma.queueEntries.push({
      id: 'queue-3',
      documentType: 'DRIVER',
      documentId: 'doc-3',
      status: DeletionQueueStatus.PENDING,
      eligibleAt: new Date(Date.now() - 1_000),
    });
    prisma.driverDocuments['doc-3'] = {
      id: 'doc-3',
      status: DocumentStatus.APPROVED,
      objectKey: 'verified/doc-3.jpg',
      previewObjectKey: null,
    };

    await worker.runSweep();

    expect(deletedKeys).toHaveLength(0);
    expect(prisma.queueEntries[0].status).toBe(DeletionQueueStatus.DELETED);
  });
});
