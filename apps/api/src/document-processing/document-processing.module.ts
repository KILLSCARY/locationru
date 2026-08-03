import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { StorageModule } from '../storage/storage.module.js';
import { DevelopmentFileTypeDetector } from './development-file-type-detector.js';
import { DevelopmentMalwareScanner } from './development-malware-scanner.js';
import { DocumentPreviewGeneratorService } from './document-preview-generator.service.js';
import { DocumentProcessingPipelineService } from './document-processing-pipeline.service.js';
import { ExternalMalwareScanner } from './external-malware-scanner.js';
import { FILE_TYPE_DETECTOR } from './file-type-detector.interface.js';
import { IMAGE_PROCESSOR } from './image-processor.interface.js';
import { MagicBytesFileTypeDetector } from './magic-bytes-file-type-detector.js';
import { MALWARE_SCANNER } from './malware-scanner.interface.js';
import { PdfLibPdfProcessor } from './pdf-lib-pdf-processor.js';
import { PDF_PROCESSOR } from './pdf-processor.interface.js';
import { SharpImageProcessor } from './sharp-image-processor.js';

@Module({
  imports: [StorageModule],
  providers: [
    DevelopmentFileTypeDetector,
    MagicBytesFileTypeDetector,
    DevelopmentMalwareScanner,
    ExternalMalwareScanner,
    SharpImageProcessor,
    PdfLibPdfProcessor,
    {
      provide: FILE_TYPE_DETECTOR,
      useFactory: (
        config: ConfigService,
        development: DevelopmentFileTypeDetector,
        magicBytes: MagicBytesFileTypeDetector,
      ) =>
        config.getOrThrow<string>('documents.fileTypeDetector') ===
        'magic-bytes'
          ? magicBytes
          : development,
      inject: [
        ConfigService,
        DevelopmentFileTypeDetector,
        MagicBytesFileTypeDetector,
      ],
    },
    {
      provide: MALWARE_SCANNER,
      useFactory: (
        config: ConfigService,
        development: DevelopmentMalwareScanner,
        external: ExternalMalwareScanner,
      ) =>
        config.getOrThrow<string>('documents.malwareScanner') === 'development'
          ? development
          : external,
      inject: [
        ConfigService,
        DevelopmentMalwareScanner,
        ExternalMalwareScanner,
      ],
    },
    { provide: IMAGE_PROCESSOR, useExisting: SharpImageProcessor },
    { provide: PDF_PROCESSOR, useExisting: PdfLibPdfProcessor },
    DocumentPreviewGeneratorService,
    DocumentProcessingPipelineService,
  ],
  exports: [DocumentProcessingPipelineService],
})
export class DocumentProcessingModule {}
