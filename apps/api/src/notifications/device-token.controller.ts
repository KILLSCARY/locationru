import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { DeviceTokenRateLimitService } from './device-token-rate-limit.service.js';
import {
  DeviceTokenService,
  type PublicDevicePushToken,
} from './device-token.service.js';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto.js';
import type { PushApplication } from '../generated/prisma/enums.js';

/** Safe only because @Roles('PASSENGER', 'DRIVER') + RolesGuard already guarantee user.role is one of exactly these two values before a handler runs. */
function roleToPushApplication(
  role: AuthenticatedUser['role'],
): PushApplication {
  return role as PushApplication;
}

/**
 * Only PASSENGER/DRIVER accounts register push tokens — application is
 * always derived from the authenticated role, never taken from the request
 * body, so this also enforces "a DRIVER-token only for a DRIVER account and
 * vice versa" without any separate check.
 */
@ApiTags('notifications')
@Controller('notifications/devices')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('PASSENGER', 'DRIVER')
@ApiBearerAuth()
export class DeviceTokenController {
  constructor(
    private readonly deviceTokenService: DeviceTokenService,
    private readonly rateLimit: DeviceTokenRateLimitService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Register this device for push notifications' })
  @ApiOkResponse({ description: 'The registered device token record.' })
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: RegisterDeviceTokenDto,
  ): Promise<PublicDevicePushToken> {
    await this.rateLimit.checkRegisterDevice(user.id);
    return this.deviceTokenService.registerDevice({
      userId: user.id,
      deviceSessionId: user.sessionId,
      deviceId: input.deviceId,
      application: roleToPushApplication(user.role),
      platform: input.platform,
      rawToken: input.pushToken,
      ...(input.appVersion ? { appVersion: input.appVersion } : {}),
      ...(input.osVersion ? { osVersion: input.osVersion } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      notificationsPermission: input.notificationsPermission,
    });
  }

  @Post('refresh')
  @ApiOperation({
    summary:
      "Replace this device's push token (e.g. after a provider-issued token refresh)",
  })
  @ApiOkResponse({ description: 'The new device token record.' })
  async refresh(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: RegisterDeviceTokenDto,
  ): Promise<PublicDevicePushToken> {
    await this.rateLimit.checkRegisterDevice(user.id);
    return this.deviceTokenService.refreshDevice({
      userId: user.id,
      deviceSessionId: user.sessionId,
      deviceId: input.deviceId,
      application: roleToPushApplication(user.role),
      platform: input.platform,
      rawToken: input.pushToken,
      ...(input.appVersion ? { appVersion: input.appVersion } : {}),
      ...(input.osVersion ? { osVersion: input.osVersion } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      notificationsPermission: input.notificationsPermission,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a device token (e.g. on logout)' })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ status: 'ok' }> {
    await this.deviceTokenService.revokeDevice(user.id, id);
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: "List this user's active registered devices" })
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PublicDevicePushToken[]> {
    return this.deviceTokenService.listDevices(user.id);
  }
}
