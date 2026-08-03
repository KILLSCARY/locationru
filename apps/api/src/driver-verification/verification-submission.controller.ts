import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { VerificationSubmissionService } from './verification-submission.service.js';

@ApiTags('driver-verification')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('DRIVER')
@Controller('drivers/me/verification')
export class VerificationSubmissionController {
  constructor(private readonly submissions: VerificationSubmissionService) {}

  @Post('submit')
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.submissions.submit(user.id);
  }
}
