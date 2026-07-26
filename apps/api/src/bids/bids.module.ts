import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { BidsController } from './bids.controller.js';
import { BidsService } from './bids.service.js';

@Module({
  imports: [AuthModule, FinanceModule, RealtimeModule],
  controllers: [BidsController],
  providers: [BidsService],
  exports: [BidsService],
})
export class BidsModule {}
