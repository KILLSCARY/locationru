import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import {
  DeletionQueueStatus,
  DocumentStatus,
} from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import {
  OBJECT_STORAGE_PROVIDER,
  type ObjectStorageProvider,
} from '../storage/object-storage-provider.interface.js';

const BATCH_SIZE = 50;

/**
 * Task 29 section 24. Nothing is ever deleted the moment a driver asks —
 * `DocumentDeletionQueueEntry.eligibleAt` is the only gate, and its value is
 * computed entirely from `DOCUMENT_PENDING_RETENTION_HOURS` (config), never
 * from a legal judgment made in this code — see
 * docs/decisions/driver-legal-requirements.md for the open legal questions
 * this still needs a lawyer to confirm. A row parked in LEGAL_HOLD is never
 * picked up here regardless of how long ago eligibleAt passed; only an
 * admin lifting the hold (DocumentRetentionAdminService.liftLegalHold)
 * returns it to PENDING.
 */
@Injectable()
export class DocumentRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentRetentionWorker.name);
  private pollTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE_PROVIDER)
    private readonly storage: ObjectStorageProvider,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    if (this.config.getOrThrow<string>('app.environment') === 'test') return;
    const intervalMs = this.config.getOrThrow<number>(
      'documents.expirationCheckIntervalMs',
    );
    this.pollTimer = setInterval(() => {
      void this.runSweep().catch((error: unknown) => {
        this.logger.error({ event: 'documents.retention_sweep_failed', error });
      });
    }, intervalMs);
    this.pollTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  isRunning(): boolean {
    if (this.config.getOrThrow<string>('app.environment') === 'test') {
      return true;
    }
    return this.pollTimer !== undefined;
  }

  async runSweep(): Promise<void> {
    const due = await this.prisma.documentDeletionQueueEntry.findMany({
      where: {
        status: DeletionQueueStatus.PENDING,
        eligibleAt: { lte: new Date() },
      },
      orderBy: { eligibleAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const entry of due) {
      try {
        await this.processEntry(entry);
      } catch (error) {
        this.logger.error({
          event: 'documents.retention_entry_failed',
          queueEntryId: entry.id,
          error,
        });
      }
    }
  }

  private async processEntry(entry: {
    id: string;
    documentType: string;
    documentId: string;
  }): Promise<void> {
    if (entry.documentType === 'DRIVER') {
      const document = await this.prisma.driverDocument.findUnique({
        where: { id: entry.documentId },
      });
      if (!document || document.status === DocumentStatus.APPROVED) {
        // Nothing left to delete, or it was re-approved after the delete
        // request was queued (should not happen, kept as a safety net) —
        // either way this entry is done.
        await this.markDeleted(entry.id);
        return;
      }
      await this.deleteObjects(document.objectKey, document.previewObjectKey);
      await this.prisma.driverDocument.update({
        where: { id: entry.documentId },
        data: {
          documentNumberEncrypted: null,
          documentNumberHash: null,
          documentNumberLastFour: null,
        },
      });
    } else {
      const document = await this.prisma.vehicleDocument.findUnique({
        where: { id: entry.documentId },
      });
      if (!document || document.status === DocumentStatus.APPROVED) {
        await this.markDeleted(entry.id);
        return;
      }
      await this.deleteObjects(document.objectKey, document.previewObjectKey);
      await this.prisma.vehicleDocument.update({
        where: { id: entry.documentId },
        data: {
          documentNumberEncrypted: null,
          documentNumberHash: null,
          documentNumberLastFour: null,
        },
      });
    }

    await this.markDeleted(entry.id);
    this.metrics.increment(
      'document_retention_deleted_total',
      'Documents whose storage objects and PII fields were erased past their retention period',
      { documentKind: entry.documentType.toLowerCase() },
    );
  }

  private async deleteObjects(
    objectKey: string,
    previewObjectKey: string | null,
  ): Promise<void> {
    await this.storage.deleteObject(objectKey);
    if (previewObjectKey) {
      await this.storage.deleteObject(previewObjectKey);
    }
  }

  private async markDeleted(queueEntryId: string): Promise<void> {
    await this.prisma.documentDeletionQueueEntry.update({
      where: { id: queueEntryId },
      data: { status: DeletionQueueStatus.DELETED, processedAt: new Date() },
    });
  }
}
