import { Module } from '@nestjs/common';

import { DriversModule } from '../drivers/drivers.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DocumentExpirationWorker } from './document-expiration.worker.js';

@Module({
  imports: [DriversModule, NotificationsModule],
  providers: [DocumentExpirationWorker],
  exports: [DocumentExpirationWorker],
})
export class DocumentExpirationModule {}
