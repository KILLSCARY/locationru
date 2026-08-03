import { BadRequestException } from '@nestjs/common';

/**
 * Never used to derive the storage object key (that's always a random UUID)
 * — this only sanitizes the value kept for the audit trail
 * (fileNameSanitized) and rejects filenames that look like an attempt to
 * disguise an executable/archive/SVG as one of the three allowed document
 * types (a "double extension" like `photo.jpg.exe`). The real safety net is
 * the magic-bytes check in DocumentProcessingPipelineService — this is a
 * cheap, early rejection, not the authoritative one.
 */
const DANGEROUS_EXTENSION_PATTERN =
  /\.(exe|sh|bat|cmd|com|scr|jar|js|vbs|vbe|ps1|msi|dll|apk|zip|rar|7z|tar|gz|svg)(\.|$)/i;

export function sanitizeAndValidateFileName(rawFileName: string): string {
  const basename = rawFileName.split(/[\\/]/).pop() ?? '';
  const cleaned = basename
    .replace(/[^\w.\- Ѐ-ӿ]/gu, '')
    .trim()
    .slice(0, 255);

  if (!cleaned) {
    throw new BadRequestException({
      code: 'INVALID_FILE_NAME',
      message: 'File name is empty after sanitization',
    });
  }
  if (DANGEROUS_EXTENSION_PATTERN.test(cleaned)) {
    throw new BadRequestException({
      code: 'DISALLOWED_FILE_NAME',
      message: 'File name has a disallowed or double extension',
    });
  }
  return cleaned;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

export function extensionForMimeType(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType] ?? 'bin';
}
