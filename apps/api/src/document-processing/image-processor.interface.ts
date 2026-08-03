export interface ImageProcessingResult {
  /** False if the buffer doesn't actually decode as a real image (the "image decode test" from Task 29 section 8). */
  valid: boolean;
  widthPx: number;
  heightPx: number;
  /** Orientation-normalized, EXIF-stripped (no GPS/device/serial metadata) — see docs/security/document-storage.md. Empty when `valid` is false. */
  sanitizedBuffer: Buffer;
}

export interface ImagePreviewResult {
  previewBuffer: Buffer;
  mimeType: string;
}

export interface ImageProcessor {
  process(buffer: Buffer, mimeType: string): Promise<ImageProcessingResult>;
  createPreview(
    sanitizedBuffer: Buffer,
    mimeType: string,
  ): Promise<ImagePreviewResult>;
}

export const IMAGE_PROCESSOR = Symbol('IMAGE_PROCESSOR');
