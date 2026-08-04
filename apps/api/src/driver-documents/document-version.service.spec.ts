import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { DocumentVersionStatus } from '../generated/prisma/client.js';
import {
  DocumentVersionService,
  type DocumentVersionRef,
} from './document-version.service.js';

interface Row {
  id: string;
  documentFamily: string;
  versionNumber: number;
  status: DocumentVersionStatus;
  driverDocumentId?: string;
  vehicleDocumentId?: string;
  supersededAt: Date | null;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(
    ([key, value]) => (row as Record<string, unknown>)[key] === value,
  );
}

class FakeDocumentVersionPrisma {
  rows: Row[] = [];
  private nextId = 1;

  documentVersion = {
    count: async ({ where }: { where: Record<string, unknown> }) =>
      this.rows.filter((row) => matches(row, where)).length,
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: Record<string, unknown>;
      orderBy?: { versionNumber: 'asc' | 'desc' };
    }) => {
      let found = this.rows.filter((row) => matches(row, where));
      if (orderBy?.versionNumber === 'desc') {
        found = [...found].sort((a, b) => b.versionNumber - a.versionNumber);
      }
      return found[0] ?? null;
    },
    create: async ({ data }: { data: Omit<Row, 'id' | 'supersededAt'> }) => {
      const row: Row = { id: `v${this.nextId++}`, supersededAt: null, ...data };
      this.rows.push(row);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<Row>;
    }) => {
      let count = 0;
      for (const row of this.rows) {
        if (matches(row, where)) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<Row>;
    }) => {
      const row = this.rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error('row not found in fake');
      Object.assign(row, data);
      return row;
    },
  };

  async $transaction<T>(
    callback: (transaction: this) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }
}

function toPrismaLike(fake: FakeDocumentVersionPrisma): PrismaService {
  return fake as unknown as PrismaService;
}

describe('DocumentVersionService', () => {
  let prisma: FakeDocumentVersionPrisma;
  let service: DocumentVersionService;
  const family = 'driver:driver-1:PASSPORT_MAIN_PAGE';

  beforeEach(() => {
    prisma = new FakeDocumentVersionPrisma();
    service = new DocumentVersionService(toPrismaLike(prisma));
  });

  describe('recordNewVersion', () => {
    it('marks the first upload for a family ACTIVE and reports it as not a replacement', async () => {
      const result = await service.recordNewVersion(family, {
        driverDocumentId: 'doc-1',
      });

      expect(result).toEqual({ isReplacement: false });
      expect(prisma.rows).toHaveLength(1);
      expect(prisma.rows[0]).toMatchObject({
        versionNumber: 1,
        status: DocumentVersionStatus.ACTIVE,
        driverDocumentId: 'doc-1',
      });
    });

    it('marks a second upload PENDING_REVIEW and reports it as a replacement when an ACTIVE version already exists', async () => {
      await service.recordNewVersion(family, { driverDocumentId: 'doc-1' });

      const result = await service.recordNewVersion(family, {
        driverDocumentId: 'doc-2',
      });

      expect(result).toEqual({ isReplacement: true });
      const second = prisma.rows.find(
        (row) => row.driverDocumentId === 'doc-2',
      );
      expect(second).toMatchObject({
        versionNumber: 2,
        status: DocumentVersionStatus.PENDING_REVIEW,
      });
      // The prior ACTIVE version is untouched by a pending re-upload.
      const first = prisma.rows.find((row) => row.driverDocumentId === 'doc-1');
      expect(first?.status).toBe(DocumentVersionStatus.ACTIVE);
    });

    it('numbers versions sequentially by total prior count, independent of current status', async () => {
      await service.recordNewVersion(family, { driverDocumentId: 'doc-1' });
      await service.recordNewVersion(family, { driverDocumentId: 'doc-2' });
      // Simulate doc-2 being rejected without ever becoming ACTIVE.
      const rejected = prisma.rows.find(
        (row) => row.driverDocumentId === 'doc-2',
      )!;
      rejected.status = DocumentVersionStatus.SUPERSEDED;

      const result = await service.recordNewVersion(family, {
        driverDocumentId: 'doc-3',
      });

      expect(result).toEqual({ isReplacement: true });
      const third = prisma.rows.find((row) => row.driverDocumentId === 'doc-3');
      expect(third?.versionNumber).toBe(3);
    });

    it('tracks separate families independently', async () => {
      const otherFamily = 'vehicle:vehicle-1:VEHICLE_REGISTRATION';
      await service.recordNewVersion(family, { driverDocumentId: 'doc-1' });

      const result = await service.recordNewVersion(otherFamily, {
        vehicleDocumentId: 'veh-doc-1',
      });

      expect(result).toEqual({ isReplacement: false });
      const row = prisma.rows.find(
        (candidate) => candidate.documentFamily === otherFamily,
      );
      expect(row).toMatchObject({ versionNumber: 1 });
    });
  });

  describe('activateVersion', () => {
    it('supersedes the previously ACTIVE version and activates the target', async () => {
      await service.recordNewVersion(family, { driverDocumentId: 'doc-1' });
      await service.recordNewVersion(family, { driverDocumentId: 'doc-2' });

      await service.activateVersion(family, { driverDocumentId: 'doc-2' });

      const first = prisma.rows.find((row) => row.driverDocumentId === 'doc-1');
      const second = prisma.rows.find(
        (row) => row.driverDocumentId === 'doc-2',
      );
      expect(first?.status).toBe(DocumentVersionStatus.SUPERSEDED);
      expect(first?.supersededAt).toBeInstanceOf(Date);
      expect(second?.status).toBe(DocumentVersionStatus.ACTIVE);
    });

    it('activates the latest matching version when multiple rows share a ref (picks by versionNumber desc)', async () => {
      prisma.rows.push(
        {
          id: 'v10',
          documentFamily: family,
          versionNumber: 1,
          status: DocumentVersionStatus.SUPERSEDED,
          driverDocumentId: 'doc-1',
          supersededAt: new Date(),
        },
        {
          id: 'v11',
          documentFamily: family,
          versionNumber: 2,
          status: DocumentVersionStatus.PENDING_REVIEW,
          driverDocumentId: 'doc-1',
          supersededAt: null,
        },
      );

      await service.activateVersion(family, { driverDocumentId: 'doc-1' });

      const activated = prisma.rows.find((row) => row.id === 'v11');
      expect(activated?.status).toBe(DocumentVersionStatus.ACTIVE);
    });

    it('throws DOCUMENT_VERSION_NOT_FOUND when no version matches the given ref', async () => {
      const ref: DocumentVersionRef = { driverDocumentId: 'missing-doc' };

      await expect(service.activateVersion(family, ref)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getActiveDocumentId', () => {
    it('returns the ACTIVE version ids for a family', async () => {
      await service.recordNewVersion(family, { driverDocumentId: 'doc-1' });

      const result = await service.getActiveDocumentId(family);

      expect(result).toMatchObject({ driverDocumentId: 'doc-1' });
    });

    it('returns null when the family has no ACTIVE version', async () => {
      const result = await service.getActiveDocumentId('driver:x:UNKNOWN');

      expect(result).toBeNull();
    });
  });
});
