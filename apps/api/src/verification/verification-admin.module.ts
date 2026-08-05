import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DriverDocumentsModule } from '../driver-documents/driver-documents.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { VerificationAdminController } from './verification-admin.controller.js';
import { VerificationAdminService } from './verification-admin.service.js';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    DriverDocumentsModule,
    NotificationsModule,
  ],
  controllers: [VerificationAdminController],
  providers: [VerificationAdminService],
})
export class VerificationAdminModule {}
