import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { DocumentVersionStatus } from '../generated/prisma/client.js';

export interface DocumentVersionRef {
  driverDocumentId?: string;
  vehicleDocumentId?: string;
}

/**
 * Task 29 section 11: a re-upload never mutates an approved DriverDocument/
 * VehicleDocument row — it creates a new one, and this service tracks which
 * one of a family's rows is the currently-effective ("ACTIVE") version. An
 * approved document stays ACTIVE until whichever version replaces it is
 * itself approved (`activateVersion`); a rejected replacement never touches
 * the still-ACTIVE prior version (see docs/drivers/documents.md).
 */
@Injectable()
export class DocumentVersionService {
  constructor(private readonly prisma: PrismaService) {}

  async recordNewVersion(documentFamily: string, ref: DocumentVersionRef) {
    const existingCount = await this.prisma.documentVersion.count({
      where: { documentFamily },
    });
    const hasActive = await this.prisma.documentVersion.findFirst({
      where: { documentFamily, status: DocumentVersionStatus.ACTIVE },
      select: { id: true },
    });

    return this.prisma.documentVersion.create({
      data: {
        documentFamily,
        versionNumber: existingCount + 1,
        status: hasActive
          ? DocumentVersionStatus.PENDING_REVIEW
          : DocumentVersionStatus.ACTIVE,
        ...ref,
      },
    });
  }

  /** Called by the admin approve workflow — makes `ref`'s version ACTIVE and supersedes whatever was previously ACTIVE in the same family. */
  async activateVersion(
    documentFamily: string,
    ref: DocumentVersionRef,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.documentVersion.updateMany({
        where: { documentFamily, status: DocumentVersionStatus.ACTIVE },
        data: {
          status: DocumentVersionStatus.SUPERSEDED,
          supersededAt: new Date(),
        },
      });

      const target = await transaction.documentVersion.findFirst({
        where: { documentFamily, ...ref },
        orderBy: { versionNumber: 'desc' },
      });
      if (!target) {
        throw new NotFoundException({
          code: 'DOCUMENT_VERSION_NOT_FOUND',
          message: 'No version record found for this document',
        });
      }
      await transaction.documentVersion.update({
        where: { id: target.id },
        data: { status: DocumentVersionStatus.ACTIVE },
      });
    });
  }

  async getActiveDocumentId(documentFamily: string): Promise<{
    driverDocumentId: string | null;
    vehicleDocumentId: string | null;
  } | null> {
    const active = await this.prisma.documentVersion.findFirst({
      where: { documentFamily, status: DocumentVersionStatus.ACTIVE },
      select: { driverDocumentId: true, vehicleDocumentId: true },
    });
    return active ?? null;
  }
}
