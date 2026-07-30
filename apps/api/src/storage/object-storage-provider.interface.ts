export interface ObjectMetadata {
  sizeBytes: number;
  mimeType: string;
  lastModified: Date;
}

export interface PresignedUrl {
  url: string;
  expiresInSeconds: number;
}

/**
 * Documents (driver/vehicle photos, etc.) never pass through the API
 * process — clients upload and download directly against a presigned URL.
 * `objectKey` is always a random, server-generated key (see
 * DocumentsService.randomObjectKey); an implementation must never derive it
 * from a client-supplied filename.
 */
export interface ObjectStorageProvider {
  createUploadUrl(objectKey: string, mimeType: string): Promise<PresignedUrl>;
  createDownloadUrl(objectKey: string): Promise<PresignedUrl>;
  deleteObject(objectKey: string): Promise<void>;
  objectExists(objectKey: string): Promise<boolean>;
  getObjectMetadata(objectKey: string): Promise<ObjectMetadata | null>;
  /** Used by HealthService's readiness check; must not upload/list objects. */
  checkConnection(): Promise<void>;
}

export const OBJECT_STORAGE_PROVIDER = Symbol('OBJECT_STORAGE_PROVIDER');
