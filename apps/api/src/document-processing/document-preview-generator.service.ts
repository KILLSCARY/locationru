import { Inject, Injectable } from '@nestjs/common';

import type { GeneratedPreview } from './document-preview-generator.interface.js';
import {
  IMAGE_PROCESSOR,
  type ImageProcessor,
} from './image-processor.interface.js';
import { PDF_PROCESSOR, type PdfProcessor } from './pdf-processor.interface.js';

@Injectable()
export class DocumentPreviewGeneratorService {
  constructor(
    @Inject(IMAGE_PROCESSOR) private readonly imageProcessor: ImageProcessor,
    @Inject(PDF_PROCESSOR) private readonly pdfProcessor: PdfProcessor,
  ) {}

  async generatePreview(
    sanitizedBuffer: Buffer,
    mimeType: string,
  ): Promise<GeneratedPreview> {
    if (mimeType === 'application/pdf') {
      const { previewBuffer } =
        await this.pdfProcessor.createPreview(sanitizedBuffer);
      return { previewBuffer, previewMimeType: 'application/pdf' };
    }
    const { previewBuffer, mimeType: previewMimeType } =
      await this.imageProcessor.createPreview(sanitizedBuffer, mimeType);
    return { previewBuffer, previewMimeType };
  }
}
