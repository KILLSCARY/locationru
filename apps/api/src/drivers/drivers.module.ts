import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { DriverController } from './driver.controller.js';
import { DriverService } from './driver.service.js';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [DriverController],
  providers: [DriverService],
  exports: [DriverService],
})
export class DriversModule {}
