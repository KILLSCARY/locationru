import { Injectable } from '@nestjs/common';

import type {
  MovedObject,
  ObjectMetadata,
  ObjectStorageProvider,
  PresignedUrl,
} from './object-storage-provider.interface.js';

/**
 * Used when OBJECT_STORAGE_* is not configured (the common case for local
 * development, which has no need to exercise document uploads). Every
 * method fails loudly and clearly, rather than the app silently pretending
 * uploads work — see docs/staging/configuration.md.
 */
@Injectable()
export class NoopObjectStorageProvider implements ObjectStorageProvider {
  async createUploadUrl(): Promise<PresignedUrl> {
    this.throwNotConfigured();
  }

  async createDownloadUrl(): Promise<PresignedUrl> {
    this.throwNotConfigured();
  }

  async deleteObject(): Promise<void> {
    this.throwNotConfigured();
  }

  async objectExists(): Promise<boolean> {
    this.throwNotConfigured();
  }

  async getObjectMetadata(): Promise<ObjectMetadata | null> {
    this.throwNotConfigured();
  }

  async checkConnection(): Promise<void> {
    this.throwNotConfigured();
  }

  async createDocumentUploadUrl(): Promise<PresignedUrl> {
    this.throwNotConfigured();
  }

  async confirmDocumentUpload(): Promise<ObjectMetadata | null> {
    this.throwNotConfigured();
  }

  async createSecureDownloadUrl(): Promise<PresignedUrl> {
    this.throwNotConfigured();
  }

  async deletePendingDocument(): Promise<void> {
    this.throwNotConfigured();
  }

  async moveToQuarantine(): Promise<MovedObject> {
    this.throwNotConfigured();
  }

  async moveToVerifiedStorage(): Promise<MovedObject> {
    this.throwNotConfigured();
  }

  async getMetadata(): Promise<ObjectMetadata | null> {
    this.throwNotConfigured();
  }

  async downloadObject(): Promise<Buffer> {
    this.throwNotConfigured();
  }

  async uploadObject(): Promise<void> {
    this.throwNotConfigured();
  }

  private throwNotConfigured(): never {
    throw new Error(
      'Object storage is not configured (OBJECT_STORAGE_ENDPOINT is empty); ' +
        'set the OBJECT_STORAGE_* variables to enable document uploads.',
    );
  }
}
