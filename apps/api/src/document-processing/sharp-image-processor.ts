import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

import type {
  ImagePreviewResult,
  ImageProcessingResult,
  ImageProcessor,
} from './image-processor.interface.js';

const PREVIEW_MAX_DIMENSION_PX = 800;

/**
 * The only place image bytes are actually decoded/re-encoded. Real (not a
 * dev/prod split) — sharp is a pure library call, no external vendor or
 * network dependency, so there is no unsafe "development" variant to guard
 * against here, unlike the malware scanner.
 */
@Injectable()
export class SharpImageProcessor implements ImageProcessor {
  async process(
    buffer: Buffer,
    mimeType: string,
  ): Promise<ImageProcessingResult> {
    try {
      const image = sharp(buffer, { failOn: 'error' });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height) {
        return {
          valid: false,
          widthPx: 0,
          heightPx: 0,
          sanitizedBuffer: Buffer.alloc(0),
        };
      }

      // .rotate() with no args reads the EXIF Orientation tag and physically
      // re-orients the pixels; not calling .withMetadata() afterwards means
      // sharp drops every other EXIF field (GPS, device model, serial, ...)
      // from the re-encoded output — see docs/security/document-storage.md.
      const oriented = image.rotate();
      const sanitizedBuffer =
        mimeType === 'image/png'
          ? await oriented.png().toBuffer()
          : await oriented.jpeg({ quality: 92 }).toBuffer();
      const orientedMetadata = await sharp(sanitizedBuffer).metadata();

      return {
        valid: true,
        widthPx: orientedMetadata.width ?? metadata.width,
        heightPx: orientedMetadata.height ?? metadata.height,
        sanitizedBuffer,
      };
    } catch {
      return {
        valid: false,
        widthPx: 0,
        heightPx: 0,
        sanitizedBuffer: Buffer.alloc(0),
      };
    }
  }

  async createPreview(
    sanitizedBuffer: Buffer,
    mimeType: string,
  ): Promise<ImagePreviewResult> {
    const resized = sharp(sanitizedBuffer).resize({
      width: PREVIEW_MAX_DIMENSION_PX,
      height: PREVIEW_MAX_DIMENSION_PX,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const previewBuffer =
      mimeType === 'image/png'
        ? await resized.png().toBuffer()
        : await resized.jpeg({ quality: 80 }).toBuffer();
    return { previewBuffer, mimeType };
  }
}
