import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { DriverController } from './driver.controller.js';
import { DriverEligibilityService } from './driver-eligibility.service.js';
import { DriverService } from './driver.service.js';
import { DriverDataCryptoService } from './infrastructure/driver-data-crypto.service.js';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [DriverController],
  providers: [DriverService, DriverEligibilityService, DriverDataCryptoService],
  exports: [DriverService, DriverEligibilityService, DriverDataCryptoService],
})
export class DriversModule {}
