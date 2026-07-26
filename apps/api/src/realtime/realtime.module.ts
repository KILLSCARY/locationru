import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RealtimeAuthorizationService } from './realtime-authorization.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeOutboxService } from './realtime-outbox.service.js';

@Module({
  imports: [AuthModule],
  providers: [
    RealtimeAuthorizationService,
    RealtimeOutboxService,
    RealtimeGateway,
  ],
  exports: [RealtimeOutboxService],
})
export class RealtimeModule {}
