import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentRetentionAdminController } from './document-retention-admin.controller.js';
import { DocumentRetentionAdminService } from './document-retention-admin.service.js';
import { DocumentRetentionWorker } from './document-retention.worker.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [DocumentRetentionAdminController],
  providers: [DocumentRetentionAdminService, DocumentRetentionWorker],
  exports: [DocumentRetentionAdminService, DocumentRetentionWorker],
})
export class DocumentRetentionModule {}
