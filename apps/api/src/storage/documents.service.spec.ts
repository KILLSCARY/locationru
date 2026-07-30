import { ConfigService } from '@nestjs/config';

import type { ObjectStorageProvider } from './object-storage-provider.interface.js';
import { DocumentsService } from './documents.service.js';

class FakePrisma {
  public readonly documents = new Map<string, Record<string, unknown>>();
  private counter = 0;

  storedDocument = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = `doc-${++this.counter}`;
      const record = { id, sizeBytes: null, ...data };
      this.documents.set(id, record);
      return record;
    },
    findUnique: async ({ where: { id } }: { where: { id: string } }) =>
      this.documents.get(id) ?? null,
    update: async ({
      where: { id },
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const existing = this.documents.get(id);
      const updated = { ...existing, ...data };
      this.documents.set(id, updated);
      return updated;
    },
  };
}

function makeService(overrides: Partial<ObjectStorageProvider> = {}) {
  const config = new ConfigService({
    objectStorage: {
      maxUploadBytes: 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png'],
    },
  });
  const prisma = new FakePrisma();
  const storage: ObjectStorageProvider = {
    createUploadUrl: async () => ({
      url: 'https://upload.example',
      expiresInSeconds: 300,
    }),
    createDownloadUrl: async () => ({
      url: 'https://download.example',
      expiresInSeconds: 300,
    }),
    deleteObject: async () => undefined,
    objectExists: async () => true,
    getObjectMetadata: async () => ({
      sizeBytes: 512,
      mimeType: 'image/jpeg',
      lastModified: new Date(),
    }),
    checkConnection: async () => undefined,
    ...overrides,
  };
  const service = new DocumentsService(config, prisma as never, storage);
  return { service, prisma, storage };
}

describe('DocumentsService', () => {
  it('rejects an upload request for a disallowed MIME type', async () => {
    const { service } = makeService();
    await expect(
      service.requestUpload('owner-1', {
        mimeType: 'application/x-msdownload',
        sizeBytes: 100,
      }),
    ).rejects.toThrow('is not an allowed document type');
  });

  it('rejects an upload request over the size limit', async () => {
    const { service } = makeService();
    await expect(
      service.requestUpload('owner-1', {
        mimeType: 'image/jpeg',
        sizeBytes: 10_000,
      }),
    ).rejects.toThrow('exceeds the');
  });

  it('never derives the object key from the client filename', async () => {
    const { service, prisma } = makeService();
    await service.requestUpload('owner-1', {
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      originalFilename: '../../etc/passwd.jpg',
    });
    const [document] = prisma.documents.values();
    expect(document!.objectKey).not.toContain('passwd');
    expect(document!.objectKey).not.toContain('..');
    expect(document!.originalFilename).toBe('../../etc/passwd.jpg');
  });

  it('refuses to hand out a download URL to a non-owner', async () => {
    const { service } = makeService();
    const { documentId } = await service.requestUpload('owner-1', {
      mimeType: 'image/jpeg',
      sizeBytes: 100,
    });
    await expect(
      service.requestDownload('someone-else', documentId),
    ).rejects.toThrow('You do not own this document');
  });

  it('refuses a download before the upload is confirmed', async () => {
    const { service } = makeService();
    const { documentId } = await service.requestUpload('owner-1', {
      mimeType: 'image/jpeg',
      sizeBytes: 100,
    });
    await expect(
      service.requestDownload('owner-1', documentId),
    ).rejects.toThrow('has not finished uploading');
  });

  it('confirms an upload only once the object actually exists in storage', async () => {
    const { service } = makeService({ getObjectMetadata: async () => null });
    const { documentId } = await service.requestUpload('owner-1', {
      mimeType: 'image/jpeg',
      sizeBytes: 100,
    });
    await expect(service.confirmUpload('owner-1', documentId)).rejects.toThrow(
      'No object was found',
    );
  });

  it('allows a download once the upload is confirmed', async () => {
    const { service } = makeService();
    const { documentId } = await service.requestUpload('owner-1', {
      mimeType: 'image/jpeg',
      sizeBytes: 100,
    });
    await service.confirmUpload('owner-1', documentId);
    const download = await service.requestDownload('owner-1', documentId);
    expect(download.url).toBe('https://download.example');
  });
});
