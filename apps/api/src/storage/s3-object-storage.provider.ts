import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  MovedObject,
  ObjectMetadata,
  ObjectStorageProvider,
  PresignedUrl,
} from './object-storage-provider.interface.js';

@Injectable()
export class S3ObjectStorageProvider implements ObjectStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly uploadUrlTtlSeconds: number;
  private readonly downloadUrlTtlSeconds: number;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('objectStorage.bucket');
    this.uploadUrlTtlSeconds = config.getOrThrow<number>(
      'objectStorage.uploadUrlTtlSeconds',
    );
    this.downloadUrlTtlSeconds = config.getOrThrow<number>(
      'objectStorage.downloadUrlTtlSeconds',
    );
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('objectStorage.endpoint'),
      region: config.getOrThrow<string>('objectStorage.region'),
      forcePathStyle: config.getOrThrow<boolean>(
        'objectStorage.forcePathStyle',
      ),
      credentials: {
        accessKeyId: config.getOrThrow<string>('objectStorage.accessKey'),
        secretAccessKey: config.getOrThrow<string>('objectStorage.secretKey'),
      },
    });
  }

  async createUploadUrl(
    objectKey: string,
    mimeType: string,
  ): Promise<PresignedUrl> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: mimeType,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.uploadUrlTtlSeconds,
    });
    return { url, expiresInSeconds: this.uploadUrlTtlSeconds };
  }

  async createDownloadUrl(objectKey: string): Promise<PresignedUrl> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.downloadUrlTtlSeconds,
    });
    return { url, expiresInSeconds: this.downloadUrlTtlSeconds };
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }

  async objectExists(objectKey: string): Promise<boolean> {
    return (await this.getObjectMetadata(objectKey)) !== null;
  }

  async getObjectMetadata(objectKey: string): Promise<ObjectMetadata | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return {
        sizeBytes: result.ContentLength ?? 0,
        mimeType: result.ContentType ?? 'application/octet-stream',
        lastModified: result.LastModified ?? new Date(0),
      };
    } catch (error) {
      if (error instanceof NotFound) return null;
      throw error;
    }
  }

  async checkConnection(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  createDocumentUploadUrl(
    objectKey: string,
    mimeType: string,
  ): Promise<PresignedUrl> {
    return this.createUploadUrl(objectKey, mimeType);
  }

  confirmDocumentUpload(objectKey: string): Promise<ObjectMetadata | null> {
    return this.getObjectMetadata(objectKey);
  }

  async createSecureDownloadUrl(
    objectKey: string,
    ttlSecondsOverride?: number,
  ): Promise<PresignedUrl> {
    const expiresIn = ttlSecondsOverride ?? this.downloadUrlTtlSeconds;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return { url, expiresInSeconds: expiresIn };
  }

  async deletePendingDocument(objectKey: string): Promise<void> {
    if (!objectKey.startsWith('pending/')) {
      throw new Error(
        `deletePendingDocument refused a non-pending key: ${objectKey}`,
      );
    }
    await this.deleteObject(objectKey);
  }

  moveToQuarantine(objectKey: string): Promise<MovedObject> {
    return this.moveObject(objectKey, 'pending/', 'quarantine/');
  }

  moveToVerifiedStorage(objectKey: string): Promise<MovedObject> {
    return this.moveObject(objectKey, 'quarantine/', 'verified/');
  }

  getMetadata(objectKey: string): Promise<ObjectMetadata | null> {
    return this.getObjectMetadata(objectKey);
  }

  async downloadObject(objectKey: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!result.Body) return Buffer.alloc(0);
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async uploadObject(
    objectKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  }

  private async moveObject(
    objectKey: string,
    expectedFromPrefix: string,
    toPrefix: string,
  ): Promise<MovedObject> {
    if (!objectKey.startsWith(expectedFromPrefix)) {
      throw new Error(
        `Cannot move "${objectKey}" to ${toPrefix} — it is not under ${expectedFromPrefix}`,
      );
    }
    const newObjectKey = toPrefix + objectKey.slice(expectedFromPrefix.length);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${objectKey}`,
        Key: newObjectKey,
      }),
    );
    await this.deleteObject(objectKey);
    return { newObjectKey };
  }
}
