import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DriverProfileController } from './driver-profile.controller.js';
import { DriverProfileService } from './driver-profile.service.js';

@Module({
  imports: [AuthModule],
  controllers: [DriverProfileController],
  providers: [DriverProfileService],
  exports: [DriverProfileService],
})
export class DriverVerificationModule {}
