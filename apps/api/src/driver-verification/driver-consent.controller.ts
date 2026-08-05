import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { DriverConsentService } from './driver-consent.service.js';
import { RecordConsentDto } from './dto/record-consent.dto.js';

@ApiTags('driver-verification')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('DRIVER')
@Controller('drivers/me/consents')
export class DriverConsentController {
  constructor(private readonly consents: DriverConsentService) {}

  @Get()
  listMyConsents(@CurrentUser() user: AuthenticatedUser) {
    return this.consents.listMyConsents(user.id);
  }

  @Post()
  recordConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: RecordConsentDto,
    @Req() request: Request,
  ) {
    return this.consents.recordConsent(user.id, input, {
      ...(request.ip ? { ip: request.ip } : {}),
    });
  }
}
