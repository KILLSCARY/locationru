import { ConfigService } from '@nestjs/config';

import { NoopObjectStorageProvider } from './noop-object-storage.provider.js';
import type { ObjectStorageProvider } from './object-storage-provider.interface.js';
import { S3ObjectStorageProvider } from './s3-object-storage.provider.js';

export function createObjectStorageProvider(
  config: ConfigService,
): ObjectStorageProvider {
  const endpoint = config.get<string>('objectStorage.endpoint') ?? '';
  if (!endpoint) {
    return new NoopObjectStorageProvider();
  }
  return new S3ObjectStorageProvider(config);
}
