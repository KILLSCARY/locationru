import { Injectable } from '@nestjs/common';

import type {
  FileTypeDetectionResult,
  FileTypeDetector,
} from './file-type-detector.interface.js';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from('%PDF');

/** Explicitly-rejected signatures, even if a caller declared one of the three allowed MIME types — see docs/security/document-processing.md. */
const FORBIDDEN_MAGIC: Array<{ name: string; signature: Buffer }> = [
  { name: 'windows-pe-executable', signature: Buffer.from([0x4d, 0x5a]) },
  { name: 'elf-executable', signature: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
  {
    name: 'zip-or-office-archive',
    signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  },
  { name: 'rar-archive', signature: Buffer.from([0x52, 0x61, 0x72, 0x21]) },
  { name: 'gzip-archive', signature: Buffer.from([0x1f, 0x8b]) },
  {
    name: 'sevenzip-archive',
    signature: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  },
];

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return (
    buffer.length >= signature.length &&
    buffer.subarray(0, signature.length).equals(signature)
  );
}

/** SVG is XML text with no fixed byte signature — detected by scanning the first non-whitespace bytes after stripping an optional UTF-8 BOM. */
function looksLikeSvgOrXml(buffer: Buffer): boolean {
  const withoutBom =
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
      ? buffer.subarray(3)
      : buffer;
  const head = withoutBom.subarray(0, 512).toString('utf8').trimStart();
  return head.startsWith('<?xml') || head.startsWith('<svg');
}

/**
 * The only allowed detector in staging/production (see
 * DOCUMENT_FILE_TYPE_DETECTOR in env.validation.ts). Pure magic-bytes
 * inspection — no native dependency, no external vendor call.
 */
@Injectable()
export class MagicBytesFileTypeDetector implements FileTypeDetector {
  async detect(
    buffer: Buffer,
    declaredMimeType: string,
  ): Promise<FileTypeDetectionResult> {
    if (looksLikeSvgOrXml(buffer)) {
      return { detectedMimeType: null, matchesDeclaredType: false };
    }
    for (const forbidden of FORBIDDEN_MAGIC) {
      if (startsWith(buffer, forbidden.signature)) {
        return { detectedMimeType: null, matchesDeclaredType: false };
      }
    }

    let detectedMimeType: string | null = null;
    if (startsWith(buffer, JPEG_MAGIC)) detectedMimeType = 'image/jpeg';
    else if (startsWith(buffer, PNG_MAGIC)) detectedMimeType = 'image/png';
    else if (startsWith(buffer, PDF_MAGIC))
      detectedMimeType = 'application/pdf';

    return {
      detectedMimeType,
      matchesDeclaredType:
        detectedMimeType !== null && detectedMimeType === declaredMimeType,
    };
  }
}
