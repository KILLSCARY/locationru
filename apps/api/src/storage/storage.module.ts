import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { createObjectStorageProvider } from './object-storage.factory.js';
import { OBJECT_STORAGE_PROVIDER } from './object-storage-provider.interface.js';

@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [
    {
      provide: OBJECT_STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createObjectStorageProvider(config),
    },
    DocumentsService,
  ],
  exports: [OBJECT_STORAGE_PROVIDER, DocumentsService],
})
export class StorageModule {}
