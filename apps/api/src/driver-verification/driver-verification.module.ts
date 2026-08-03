import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DriverConsentController } from './driver-consent.controller.js';
import { DriverConsentService } from './driver-consent.service.js';
import { DriverProfileController } from './driver-profile.controller.js';
import { DriverProfileService } from './driver-profile.service.js';
import { VerificationSubmissionController } from './verification-submission.controller.js';
import { VerificationSubmissionService } from './verification-submission.service.js';

@Module({
  imports: [AuthModule],
  controllers: [
    DriverProfileController,
    DriverConsentController,
    VerificationSubmissionController,
  ],
  providers: [
    DriverProfileService,
    DriverConsentService,
    VerificationSubmissionService,
  ],
  exports: [DriverProfileService, DriverConsentService],
})
export class DriverVerificationModule {}
