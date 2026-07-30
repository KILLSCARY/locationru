import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { StoredDocumentStatus } from '../generated/prisma/enums.js';
import {
  OBJECT_STORAGE_PROVIDER,
  type ObjectStorageProvider,
} from './object-storage-provider.interface.js';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

@Injectable()
export class DocumentsService {
  private readonly maxUploadBytes: number;
  private readonly allowedMimeTypes: string[];

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE_PROVIDER)
    private readonly storage: ObjectStorageProvider,
  ) {
    this.maxUploadBytes = config.getOrThrow<number>(
      'objectStorage.maxUploadBytes',
    );
    this.allowedMimeTypes = config.getOrThrow<string[]>(
      'objectStorage.allowedMimeTypes',
    );
  }

  async requestUpload(
    ownerId: string,
    input: { mimeType: string; sizeBytes: number; originalFilename?: string },
  ) {
    if (!this.allowedMimeTypes.includes(input.mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MIME_TYPE',
        message: `"${input.mimeType}" is not an allowed document type`,
      });
    }
    if (input.sizeBytes > this.maxUploadBytes) {
      throw new BadRequestException({
        code: 'DOCUMENT_TOO_LARGE',
        message: `Document exceeds the ${this.maxUploadBytes}-byte limit`,
      });
    }

    // Never derived from the client-supplied filename — that value is kept
    // only as metadata (originalFilename) for the audit trail.
    const objectKey = this.randomObjectKey(ownerId, input.mimeType);
    const document = await this.prisma.storedDocument.create({
      data: {
        ownerId,
        objectKey,
        mimeType: input.mimeType,
        status: StoredDocumentStatus.PENDING_UPLOAD,
        ...(input.originalFilename
          ? { originalFilename: input.originalFilename.slice(0, 255) }
          : {}),
      },
    });

    const { url, expiresInSeconds } = await this.storage.createUploadUrl(
      objectKey,
      input.mimeType,
    );

    return {
      documentId: document.id,
      uploadUrl: url,
      expiresInSeconds,
    };
  }

  /** Confirms the object actually landed in storage before flipping status. */
  async confirmUpload(userId: string, documentId: string) {
    const document = await this.requireOwnedDocument(userId, documentId);
    const metadata = await this.storage.getObjectMetadata(document.objectKey);
    if (!metadata) {
      throw new BadRequestException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'No object was found at the presigned upload location yet',
      });
    }

    return this.prisma.storedDocument.update({
      where: { id: documentId },
      data: {
        status: StoredDocumentStatus.UPLOADED,
        sizeBytes: metadata.sizeBytes,
      },
    });
  }

  async requestDownload(userId: string, documentId: string) {
    const document = await this.requireOwnedDocument(userId, documentId);
    if (document.status !== StoredDocumentStatus.UPLOADED) {
      throw new BadRequestException({
        code: 'DOCUMENT_NOT_UPLOADED',
        message: 'This document has not finished uploading yet',
      });
    }
    return this.storage.createDownloadUrl(document.objectKey);
  }

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    const document = await this.requireOwnedDocument(userId, documentId);
    await this.storage.deleteObject(document.objectKey);
    await this.prisma.storedDocument.update({
      where: { id: documentId },
      data: { status: StoredDocumentStatus.DELETED },
    });
  }

  private async requireOwnedDocument(userId: string, documentId: string) {
    const document = await this.prisma.storedDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document was not found',
      });
    }
    if (document.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'DOCUMENT_ACCESS_DENIED',
        message: 'You do not own this document',
      });
    }
    return document;
  }

  private randomObjectKey(ownerId: string, mimeType: string): string {
    const extension = MIME_EXTENSIONS[mimeType] ?? 'bin';
    return `documents/${ownerId}/${randomUUID()}.${extension}`;
  }
}
