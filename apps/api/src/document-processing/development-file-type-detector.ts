import { Injectable } from '@nestjs/common';

import type {
  FileTypeDetectionResult,
  FileTypeDetector,
} from './file-type-detector.interface.js';

/** Trusts the declared MIME type outright — local development only, never selected in staging/production (see env.validation.ts). */
@Injectable()
export class DevelopmentFileTypeDetector implements FileTypeDetector {
  async detect(
    _buffer: Buffer,
    declaredMimeType: string,
  ): Promise<FileTypeDetectionResult> {
    return { detectedMimeType: declaredMimeType, matchesDeclaredType: true };
  }
}
