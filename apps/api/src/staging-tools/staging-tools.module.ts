import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { StagingOnlyGuard } from './staging-only.guard.js';
import { StagingToolsController } from './staging-tools.controller.js';
import { StagingToolsService } from './staging-tools.service.js';

@Module({
  imports: [AuthModule, PaymentsModule, RealtimeModule, NotificationsModule],
  controllers: [StagingToolsController],
  providers: [StagingToolsService, StagingOnlyGuard],
})
export class StagingToolsModule {}
