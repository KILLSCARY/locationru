import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  OBJECT_STORAGE_PROVIDER,
  type ObjectStorageProvider,
} from '../storage/object-storage-provider.interface.js';
import { DocumentPreviewGeneratorService } from './document-preview-generator.service.js';
import {
  FILE_TYPE_DETECTOR,
  type FileTypeDetector,
} from './file-type-detector.interface.js';
import {
  IMAGE_PROCESSOR,
  type ImageProcessor,
} from './image-processor.interface.js';
import {
  MALWARE_SCANNER,
  type MalwareScanner,
} from './malware-scanner.interface.js';
import { PDF_PROCESSOR, type PdfProcessor } from './pdf-processor.interface.js';

export interface ProcessableDocument {
  objectKey: string;
  mimeType: string;
  fileSize: number;
}

export type ProcessingFailureReason =
  | 'SIZE_MISMATCH'
  | 'MIME_TYPE_MISMATCH'
  | 'MALWARE_DETECTED'
  | 'IMAGE_DECODE_FAILED'
  | 'IMAGE_TOO_SMALL'
  | 'PDF_STRUCTURE_INVALID';

export type ProcessingOutcome =
  | {
      outcome: 'READY_FOR_REVIEW';
      quarantineObjectKey: string;
      previewObjectKey: string;
      widthPx?: number;
      heightPx?: number;
    }
  | { outcome: 'FAILED_SECURITY_CHECK'; reason: ProcessingFailureReason };

/**
 * The Task 29 section 8 pipeline: upload-confirmed -> metadata validation ->
 * magic-bytes validation -> file-size validation -> malware scan -> image
 * decode test / PDF structure validation -> EXIF cleanup -> preview
 * generation -> move to quarantine -> READY_FOR_REVIEW. Every failure exit
 * maps to `FAILED_SECURITY_CHECK` (the closest DocumentStatus value) — the
 * specific `reason` is for logs/metrics only, never persisted verbatim on
 * the document row (see docs/security/document-processing.md) since the
 * uploader is never told exactly which check tripped, only "отклонён" with
 * a generic reason.
 */
@Injectable()
export class DocumentProcessingPipelineService {
  private readonly logger = new Logger(DocumentProcessingPipelineService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(OBJECT_STORAGE_PROVIDER)
    private readonly storage: ObjectStorageProvider,
    @Inject(FILE_TYPE_DETECTOR)
    private readonly fileTypeDetector: FileTypeDetector,
    @Inject(MALWARE_SCANNER) private readonly malwareScanner: MalwareScanner,
    @Inject(IMAGE_PROCESSOR) private readonly imageProcessor: ImageProcessor,
    @Inject(PDF_PROCESSOR) private readonly pdfProcessor: PdfProcessor,
    private readonly previewGenerator: DocumentPreviewGeneratorService,
  ) {}

  async process(document: ProcessableDocument): Promise<ProcessingOutcome> {
    const fail = (reason: ProcessingFailureReason): ProcessingOutcome => {
      this.logger.warn({
        event: 'document_processing.failed',
        objectKey: document.objectKey,
        reason,
      });
      return { outcome: 'FAILED_SECURITY_CHECK', reason };
    };

    const buffer = await this.storage.downloadObject(document.objectKey);

    const maxBytes =
      document.mimeType === 'application/pdf'
        ? this.config.getOrThrow<number>('documents.pdfMaxBytes')
        : this.config.getOrThrow<number>('documents.imageMaxBytes');
    if (buffer.length === 0 || buffer.length > maxBytes) {
      return fail('SIZE_MISMATCH');
    }

    const detection = await this.fileTypeDetector.detect(
      buffer,
      document.mimeType,
    );
    if (!detection.matchesDeclaredType) {
      return fail('MIME_TYPE_MISMATCH');
    }

    const scan = await this.malwareScanner.scan(buffer);
    if (!scan.clean) {
      return fail('MALWARE_DETECTED');
    }

    let sanitizedBuffer = buffer;
    let widthPx: number | undefined;
    let heightPx: number | undefined;

    if (document.mimeType === 'application/pdf') {
      const pdfResult = await this.pdfProcessor.process(buffer);
      if (!pdfResult.valid) return fail('PDF_STRUCTURE_INVALID');
    } else {
      const imageResult = await this.imageProcessor.process(
        buffer,
        document.mimeType,
      );
      if (!imageResult.valid) return fail('IMAGE_DECODE_FAILED');

      const minWidth = this.config.getOrThrow<number>(
        'documents.imageMinWidthPx',
      );
      const minHeight = this.config.getOrThrow<number>(
        'documents.imageMinHeightPx',
      );
      if (imageResult.widthPx < minWidth || imageResult.heightPx < minHeight) {
        return fail('IMAGE_TOO_SMALL');
      }

      sanitizedBuffer = imageResult.sanitizedBuffer;
      widthPx = imageResult.widthPx;
      heightPx = imageResult.heightPx;
    }

    const preview = await this.previewGenerator.generatePreview(
      sanitizedBuffer,
      document.mimeType,
    );

    const quarantineObjectKey = this.toQuarantineKey(document.objectKey);
    const previewObjectKey = this.toPreviewKey(quarantineObjectKey);

    if (document.mimeType === 'application/pdf') {
      // No content transform is applied to a PDF's own bytes — only a
      // separate first-page preview is generated — so the original upload
      // moves from pending/ to quarantine/ unchanged (copy + delete).
      await this.storage.moveToQuarantine(document.objectKey);
    } else {
      // The sanitized (EXIF-stripped, orientation-normalized) buffer differs
      // from what the client actually uploaded, so it is written directly
      // to the quarantine key rather than copying the untouched pending
      // object — the pending original (with its EXIF intact) is then
      // discarded, never promoted anywhere.
      await this.storage.uploadObject(
        quarantineObjectKey,
        sanitizedBuffer,
        document.mimeType,
      );
      await this.storage.deletePendingDocument(document.objectKey);
    }
    await this.storage.uploadObject(
      previewObjectKey,
      preview.previewBuffer,
      preview.previewMimeType,
    );

    return {
      outcome: 'READY_FOR_REVIEW',
      quarantineObjectKey,
      previewObjectKey,
      ...(widthPx !== undefined ? { widthPx } : {}),
      ...(heightPx !== undefined ? { heightPx } : {}),
    };
  }

  private toQuarantineKey(pendingObjectKey: string): string {
    if (!pendingObjectKey.startsWith('pending/')) {
      throw new Error(
        `Expected a pending/ object key, got: ${pendingObjectKey}`,
      );
    }
    return `quarantine/${pendingObjectKey.slice('pending/'.length)}`;
  }

  private toPreviewKey(objectKey: string): string {
    const lastDot = objectKey.lastIndexOf('.');
    if (lastDot === -1) return `${objectKey}-preview`;
    return `${objectKey.slice(0, lastDot)}-preview${objectKey.slice(lastDot)}`;
  }
}
