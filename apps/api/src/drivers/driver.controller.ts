import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import {
  DriverService,
  type DriverStatusResponse,
  type LocationSubmissionResult,
} from './driver.service.js';
import { BatchDriverLocationDto } from './dto/batch-driver-location.dto.js';
import { DriverLocationDto } from './dto/driver-location.dto.js';
import { GoOnlineDto } from './dto/go-online.dto.js';

@ApiTags('drivers')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('DRIVER')
@Controller('drivers')
export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  @Post('me/online')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set the approved driver online' })
  online(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: GoOnlineDto,
  ): Promise<DriverStatusResponse> {
    return this.driverService.goOnline(user, input);
  }

  @Post('me/offline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set the current driver offline' })
  offline(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DriverStatusResponse> {
    return this.driverService.goOffline(user);
  }

  @Post('me/location')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit one driver location point' })
  location(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: DriverLocationDto,
  ): Promise<LocationSubmissionResult> {
    return this.driverService.submitLocation(user, input);
  }

  @Post('me/location/batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a bounded batch of driver location points' })
  locationBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: BatchDriverLocationDto,
  ): Promise<LocationSubmissionResult> {
    return this.driverService.submitLocationBatch(user, input);
  }

  @Get('me/status')
  @ApiOperation({ summary: 'Get the current driver status and live position' })
  @ApiOkResponse({
    description: 'Current driver availability and latest live position',
  })
  status(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DriverStatusResponse> {
    return this.driverService.getStatus(user);
  }
}
