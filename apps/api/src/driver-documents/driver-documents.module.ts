import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DocumentProcessingModule } from '../document-processing/document-processing.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentUploadRateLimitService } from './document-upload-rate-limit.service.js';
import { DocumentVersionService } from './document-version.service.js';
import { DriverDocumentController } from './driver-document.controller.js';
import { DriverDocumentService } from './driver-document.service.js';
import { VehicleDocumentController } from './vehicle-document.controller.js';
import { VehicleDocumentService } from './vehicle-document.service.js';

@Module({
  imports: [AuthModule, StorageModule, DocumentProcessingModule],
  controllers: [DriverDocumentController, VehicleDocumentController],
  providers: [
    DriverDocumentService,
    VehicleDocumentService,
    DocumentUploadRateLimitService,
    DocumentVersionService,
  ],
  exports: [
    DriverDocumentService,
    VehicleDocumentService,
    DocumentVersionService,
  ],
})
export class DriverDocumentsModule {}
