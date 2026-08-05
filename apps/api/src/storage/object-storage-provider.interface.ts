export interface ObjectMetadata {
  sizeBytes: number;
  mimeType: string;
  lastModified: Date;
}

export interface PresignedUrl {
  url: string;
  expiresInSeconds: number;
}

export interface MovedObject {
  newObjectKey: string;
}

/**
 * Documents (driver/vehicle photos, etc.) never pass through the API
 * process — clients upload and download directly against a presigned URL.
 * `objectKey` is always a random, server-generated key (see
 * DocumentsService.randomObjectKey / DriverDocumentStorageService); an
 * implementation must never derive it from a client-supplied filename.
 *
 * The five original methods (createUploadUrl/createDownloadUrl/deleteObject/
 * objectExists/getObjectMetadata) back the generic `documents` module
 * (StoredDocument). The document-verification-pipeline-specific methods
 * below (Task 29) are named to match the task's own vocabulary
 * (createDocumentUploadUrl, confirmDocumentUpload, ...) but most are thin,
 * behavior-identical delegations to the same five — only
 * `moveToQuarantine`/`moveToVerifiedStorage` are genuinely new capability
 * (an object copy + delete between the pending/quarantine/verified logical
 * prefixes, see docs/security/document-storage.md), since nothing before
 * this needed to relocate an object between storage tiers.
 */
export interface ObjectStorageProvider {
  createUploadUrl(objectKey: string, mimeType: string): Promise<PresignedUrl>;
  createDownloadUrl(objectKey: string): Promise<PresignedUrl>;
  deleteObject(objectKey: string): Promise<void>;
  objectExists(objectKey: string): Promise<boolean>;
  getObjectMetadata(objectKey: string): Promise<ObjectMetadata | null>;
  /** Used by HealthService's readiness check; must not upload/list objects. */
  checkConnection(): Promise<void>;

  /** Same as createUploadUrl — `objectKey` is expected to start with `pending/` for a driver/vehicle document. */
  createDocumentUploadUrl(
    objectKey: string,
    mimeType: string,
  ): Promise<PresignedUrl>;
  /** Confirms the object actually landed in storage — same as getObjectMetadata, named for the confirm-upload step. */
  confirmDocumentUpload(objectKey: string): Promise<ObjectMetadata | null>;
  /** Same as createDownloadUrl but accepts an explicit shorter TTL (e.g. the admin "view after access check" short URL — see docs/drivers/documents.md). */
  createSecureDownloadUrl(
    objectKey: string,
    ttlSecondsOverride?: number,
  ): Promise<PresignedUrl>;
  /** Refuses to delete anything outside the `pending/` prefix — defense in depth against deleting an already-reviewed document via the wrong code path. */
  deletePendingDocument(objectKey: string): Promise<void>;
  /** Copies `pending/...` -> `quarantine/...` and deletes the original; returns the new key. */
  moveToQuarantine(objectKey: string): Promise<MovedObject>;
  /** Copies `quarantine/...` -> `verified/...` and deletes the original; returns the new key. */
  moveToVerifiedStorage(objectKey: string): Promise<MovedObject>;
  getMetadata(objectKey: string): Promise<ObjectMetadata | null>;
  /** Reads the object's bytes server-side — used only by DocumentProcessingPipeline (magic-bytes/malware/decode checks need the real content); never exposed to a client, who always uses a presigned URL instead. */
  downloadObject(objectKey: string): Promise<Buffer>;
  /** Uploads processed bytes (a sanitized copy or a preview) server-side — the counterpart to downloadObject, used only by the pipeline. */
  uploadObject(
    objectKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void>;
}

export const OBJECT_STORAGE_PROVIDER = Symbol('OBJECT_STORAGE_PROVIDER');
