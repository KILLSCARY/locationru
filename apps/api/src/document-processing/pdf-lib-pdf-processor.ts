import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';

import type {
  PdfPreviewResult,
  PdfProcessingResult,
  PdfProcessor,
} from './pdf-processor.interface.js';

/** The only place a PDF is actually parsed. Real (not a dev/prod split) — pdf-lib is a pure-JS library, no external vendor. */
@Injectable()
export class PdfLibPdfProcessor implements PdfProcessor {
  constructor(private readonly config: ConfigService) {}

  async process(buffer: Buffer): Promise<PdfProcessingResult> {
    try {
      const document = await PDFDocument.load(buffer, {
        updateMetadata: false,
      });
      const pageCount = document.getPageCount();
      const maxPages = this.config.getOrThrow<number>('documents.pdfMaxPages');
      if (pageCount < 1 || pageCount > maxPages) {
        return { valid: false, pageCount };
      }
      return { valid: true, pageCount };
    } catch {
      return { valid: false, pageCount: 0 };
    }
  }

  async createPreview(buffer: Buffer): Promise<PdfPreviewResult> {
    const source = await PDFDocument.load(buffer, { updateMetadata: false });
    const preview = await PDFDocument.create();
    const [firstPage] = await preview.copyPages(source, [0]);
    preview.addPage(firstPage);
    const previewBuffer = Buffer.from(await preview.save());
    return { previewBuffer };
  }
}
