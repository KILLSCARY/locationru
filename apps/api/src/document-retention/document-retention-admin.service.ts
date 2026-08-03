import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { DeletionQueueStatus } from '../generated/prisma/client.js';

interface PageQuery {
  page?: string;
  pageSize?: string;
}

/**
 * Admin-facing view of the deletion queue plus the only way a PENDING entry
 * ever becomes LEGAL_HOLD (or is released back to PENDING) — Task 29
 * section 24 is explicit that no code here decides *whether* a legal hold
 * is warranted, only that the mechanism exists for an admin/legal team to
 * apply one.
 */
@Injectable()
export class DocumentRetentionAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listQueue(query: PageQuery) {
    const pagination = this.pagination(query);
    const where = {
      status: {
        in: [DeletionQueueStatus.PENDING, DeletionQueueStatus.LEGAL_HOLD],
      },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.documentDeletionQueueEntry.findMany({
        where,
        orderBy: { eligibleAt: 'asc' },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.documentDeletionQueueEntry.count({ where }),
    ]);
    return {
      items,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  async placeLegalHold(queueEntryId: string, reason: string): Promise<void> {
    const entry = await this.requireEntry(queueEntryId);
    if (entry.status !== DeletionQueueStatus.PENDING) {
      throw new ConflictException({
        code: 'QUEUE_ENTRY_NOT_PENDING',
        message: 'Only a still-pending deletion can be placed on legal hold',
      });
    }
    await this.prisma.documentDeletionQueueEntry.update({
      where: { id: queueEntryId },
      data: { status: DeletionQueueStatus.LEGAL_HOLD, legalHoldReason: reason },
    });
  }

  async liftLegalHold(queueEntryId: string): Promise<void> {
    const entry = await this.requireEntry(queueEntryId);
    if (entry.status !== DeletionQueueStatus.LEGAL_HOLD) {
      throw new ConflictException({
        code: 'QUEUE_ENTRY_NOT_ON_HOLD',
        message: 'This entry is not currently on legal hold',
      });
    }
    await this.prisma.documentDeletionQueueEntry.update({
      where: { id: queueEntryId },
      data: { status: DeletionQueueStatus.PENDING, legalHoldReason: null },
    });
  }

  private async requireEntry(queueEntryId: string) {
    const entry = await this.prisma.documentDeletionQueueEntry.findUnique({
      where: { id: queueEntryId },
    });
    if (!entry) {
      throw new NotFoundException({
        code: 'QUEUE_ENTRY_NOT_FOUND',
        message: 'Deletion queue entry was not found',
      });
    }
    return entry;
  }

  private pagination(query: PageQuery) {
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(query.pageSize ?? '20', 10) || 20),
    );
    return { page, pageSize, skip: (page - 1) * pageSize };
  }
}
