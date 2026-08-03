import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UpdateDriverProfileDto } from './dto/update-driver-profile.dto.js';
import { DriverProfileService } from './driver-profile.service.js';

@ApiTags('driver-verification')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('DRIVER')
@Controller('drivers/me/profile')
export class DriverProfileController {
  constructor(private readonly profiles: DriverProfileService) {}

  @Get()
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.getMyProfile(user.id);
  }

  @Put()
  upsertProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdateDriverProfileDto,
  ) {
    return this.profiles.upsertProfile(user.id, input);
  }
}
