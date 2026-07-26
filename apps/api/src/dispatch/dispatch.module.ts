import { Module } from '@nestjs/common';

import { DispatchService } from './dispatch.service.js';

@Module({
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
