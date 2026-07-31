import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { NotificationPreferencesResponse } from '@resilient-taxi/contracts';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';
import { NotificationPreferenceService } from './notification-preference.service.js';
import type { PushApplication } from '../generated/prisma/enums.js';

/** Safe only because @Roles('PASSENGER', 'DRIVER') + RolesGuard already guarantee user.role is one of exactly these two values before a handler runs. */
function roleToPushApplication(
  role: AuthenticatedUser['role'],
): PushApplication {
  return role as PushApplication;
}

/**
 * Preferences are always keyed by the authenticated user's own role-derived
 * application, never a client-supplied field — same convention as
 * DeviceTokenController.
 */
@ApiTags('notifications')
@Controller('notifications/preferences')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('PASSENGER', 'DRIVER')
@ApiBearerAuth()
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferenceService) {}

  @Get()
  @ApiOperation({ summary: 'Get this user’s notification preferences' })
  @ApiOkResponse({ description: 'Per-category push preferences.' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferencesResponse> {
    return this.preferences.getPreferences(
      user.id,
      roleToPushApplication(user.role),
    );
  }

  @Put()
  @ApiOperation({ summary: 'Update this user’s notification preferences' })
  @ApiOkResponse({ description: 'The updated per-category push preferences.' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponse> {
    return this.preferences.updatePreferences(
      user.id,
      roleToPushApplication(user.role),
      input,
    );
  }
}
