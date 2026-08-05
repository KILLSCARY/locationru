import { ConfigService } from '@nestjs/config';

import type { MetricsService } from '../observability/metrics.service.js';
import type { ObjectStorageProvider } from '../storage/object-storage-provider.interface.js';
import { DocumentProcessingPipelineService } from './document-processing-pipeline.service.js';
import type { DocumentPreviewGeneratorService } from './document-preview-generator.service.js';
import type { FileTypeDetector } from './file-type-detector.interface.js';
import type { ImageProcessor } from './image-processor.interface.js';
import type { MalwareScanner } from './malware-scanner.interface.js';
import type { PdfProcessor } from './pdf-processor.interface.js';

const CONFIG = new ConfigService({
  documents: {
    imageMaxBytes: 10 * 1024 * 1024,
    pdfMaxBytes: 15 * 1024 * 1024,
    imageMinWidthPx: 600,
    imageMinHeightPx: 600,
  },
});

function buildService(overrides: {
  storage?: Partial<ObjectStorageProvider>;
  fileTypeDetector?: Partial<FileTypeDetector>;
  malwareScanner?: Partial<MalwareScanner>;
  imageProcessor?: Partial<ImageProcessor>;
  pdfProcessor?: Partial<PdfProcessor>;
  previewGenerator?: Partial<DocumentPreviewGeneratorService>;
  metrics?: Partial<MetricsService>;
}) {
  const storage: Partial<ObjectStorageProvider> = {
    downloadObject: async () => Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]),
    moveToQuarantine: async () => ({ newObjectKey: 'quarantine/x.jpg' }),
    uploadObject: async () => undefined,
    deletePendingDocument: async () => undefined,
    ...overrides.storage,
  };
  const fileTypeDetector: Partial<FileTypeDetector> = {
    detect: async () => ({
      detectedMimeType: 'image/jpeg',
      matchesDeclaredType: true,
    }),
    ...overrides.fileTypeDetector,
  };
  const malwareScanner: Partial<MalwareScanner> = {
    scan: async () => ({ clean: true }),
    ...overrides.malwareScanner,
  };
  const imageProcessor: Partial<ImageProcessor> = {
    process: async () => ({
      valid: true,
      widthPx: 1200,
      heightPx: 900,
      sanitizedBuffer: Buffer.from('sanitized'),
    }),
    ...overrides.imageProcessor,
  };
  const pdfProcessor: Partial<PdfProcessor> = {
    process: async () => ({ valid: true }),
    ...overrides.pdfProcessor,
  };
  const previewGenerator: Partial<DocumentPreviewGeneratorService> = {
    generatePreview: async () => ({
      previewBuffer: Buffer.from('preview'),
      previewMimeType: 'image/jpeg',
    }),
    ...overrides.previewGenerator,
  };
  const incrementCalls: string[] = [];
  const metrics: Partial<MetricsService> = {
    increment: (name: string) => {
      incrementCalls.push(name);
    },
    ...overrides.metrics,
  };

  const service = new DocumentProcessingPipelineService(
    CONFIG,
    storage as ObjectStorageProvider,
    fileTypeDetector as FileTypeDetector,
    malwareScanner as MalwareScanner,
    imageProcessor as ImageProcessor,
    pdfProcessor as PdfProcessor,
    previewGenerator as DocumentPreviewGeneratorService,
    metrics as MetricsService,
  );
  return { service, incrementCalls };
}

const baseDoc = {
  objectKey: 'pending/driver-1/passport.jpg',
  mimeType: 'image/jpeg',
  fileSize: 1_000,
};

describe('DocumentProcessingPipelineService', () => {
  it('accepts a valid image, moves it to quarantine, and generates a preview', async () => {
    const { service } = buildService({});

    const result = await service.process(baseDoc);

    expect(result).toMatchObject({
      outcome: 'READY_FOR_REVIEW',
      quarantineObjectKey: 'quarantine/driver-1/passport.jpg',
      widthPx: 1200,
      heightPx: 900,
    });
  });

  it('accepts a valid PDF and copies the original into quarantine unchanged', async () => {
    const moved: string[] = [];
    const { service } = buildService({
      fileTypeDetector: {
        detect: async () => ({
          detectedMimeType: 'application/pdf',
          matchesDeclaredType: true,
        }),
      },
      storage: {
        moveToQuarantine: async (key: string) => {
          moved.push(key);
          return { newObjectKey: `quarantine/${key}` };
        },
      },
    });

    const result = await service.process({
      ...baseDoc,
      mimeType: 'application/pdf',
    });

    expect(result.outcome).toBe('READY_FOR_REVIEW');
    expect(moved).toEqual(['pending/driver-1/passport.jpg']);
  });

  it('fails with SIZE_MISMATCH for an empty file', async () => {
    const { service } = buildService({
      storage: { downloadObject: async () => Buffer.alloc(0) },
    });

    const result = await service.process(baseDoc);

    expect(result).toEqual({
      outcome: 'FAILED_SECURITY_CHECK',
      reason: 'SIZE_MISMATCH',
    });
  });

  it('fails with SIZE_MISMATCH when the downloaded object exceeds the configured max for its type', async () => {
    const { service } = buildService({
      storage: {
        downloadObject: async () => Buffer.alloc(11 * 1024 * 1024, 1),
      },
    });

    const result = await service.process(baseDoc);

    expect(result).toEqual({
      outcome: 'FAILED_SECURITY_CHECK',
      reason: 'SIZE_MISMATCH',
    });
  });

  it('fails with MIME_TYPE_MISMATCH when the detected bytes disagree with the declared MIME type', async () => {
    const { service } = buildService({
      fileTypeDetector: {
        detect: async () => ({
          detectedMimeType: 'application/pdf',
          matchesDeclaredType: false,
        }),
      },
    });

    const result = await service.process(baseDoc);

    expect(result).toEqual({
      outcome: 'FAILED_SECURITY_CHECK',
      reason: 'MIME_TYPE_MISMATCH',
    });
  });

  it('fails with MALWARE_DETECTED when the scanner flags the file', async () => {
    const { service } = buildService({
      malwareScanner: { scan: async () => ({ clean: false }) },
    });

    const result = await service.process(baseDoc);

    expect(result).toEqual({
      outcome: 'FAILED_SECURITY_CHECK',
      reason: 'MALWARE_DETECTED',
    });
  });

  it('fails with IMAGE_DECODE_FAILED when the image cannot be decoded', async () => {
    const { service } = buildService({
      imageProcessor: {
        process: async () => ({
          valid: false,
          widthPx: 0,
          heightPx: 0,
          sanitizedBuffer: Buffer.alloc(0),
        }),
      },
    });

    const result = await service.process(baseDoc);

    expect(result).toEqual({
      outcome: 'FAILED_SECURITY_CHECK',
      reason: 'IMAGE_DECODE_FAILED',
    });
  });

  it('fails with IMAGE_TOO_SMALL when the decoded image is below the configured minimum dimensions', async () => {
    const { service } = buildService({
      imageProcessor: {
        process: async () => ({
          valid: true,
          widthPx: 100,
          heightPx: 100,
          sanitizedBuffer: Buffer.from('x'),
        }),
      },
    });

    const result = await service.process(baseDoc);

    expect(result).toEqual({
      outcome: 'FAILED_SECURITY_CHECK',
      reason: 'IMAGE_TOO_SMALL',
    });
  });

  it('fails with PDF_STRUCTURE_INVALID for a malformed PDF', async () => {
    const { service } = buildService({
      fileTypeDetector: {
        detect: async () => ({
          detectedMimeType: 'application/pdf',
          matchesDeclaredType: true,
        }),
      },
      pdfProcessor: { process: async () => ({ valid: false }) },
    });

    const result = await service.process({
      ...baseDoc,
      mimeType: 'application/pdf',
    });

    expect(result).toEqual({
      outcome: 'FAILED_SECURITY_CHECK',
      reason: 'PDF_STRUCTURE_INVALID',
    });
  });

  it('fails closed with PROCESSING_ERROR and increments document_processing_failed_total on an unexpected exception', async () => {
    const { service, incrementCalls } = buildService({
      storage: {
        downloadObject: async () => {
          throw new Error('storage unavailable');
        },
      },
    });

    const result = await service.process(baseDoc);

    expect(result).toEqual({
      outcome: 'FAILED_SECURITY_CHECK',
      reason: 'PROCESSING_ERROR',
    });
    expect(incrementCalls).toContain('document_processing_failed_total');
  });
});
