import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { BoardingCodeDto } from './dto/boarding-code.dto.js';
import { TripLifecycleService } from './trip-lifecycle.service.js';

@ApiTags('trip-lifecycle')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Controller()
export class TripLifecycleController {
  constructor(private readonly lifecycle: TripLifecycleService) {}

  @Post('driver/trips/:tripId/confirm-departure')
  @Roles('DRIVER')
  confirmDeparture(
    @CurrentUser() driver: AuthenticatedUser,
    @Param('tripId') tripId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.lifecycle.confirmDeparture(driver, tripId, key ?? '');
  }

  @Post('trips/:tripId/payment/authorize')
  @Roles('PASSENGER')
  authorizePayment(
    @CurrentUser() passenger: AuthenticatedUser,
    @Param('tripId') tripId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.lifecycle.authorizePayment(passenger, tripId, key ?? '');
  }

  @Post('driver/trips/:tripId/en-route')
  @Roles('DRIVER')
  startEnRoute(
    @CurrentUser() driver: AuthenticatedUser,
    @Param('tripId') tripId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.lifecycle.startEnRoute(driver, tripId, key ?? '');
  }

  @Post('driver/trips/:tripId/arrived')
  @Roles('DRIVER')
  arrive(
    @CurrentUser() driver: AuthenticatedUser,
    @Param('tripId') tripId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.lifecycle.arrive(driver, tripId, key ?? '');
  }

  @Get('trips/:tripId/boarding-code')
  @Roles('PASSENGER')
  issueBoardingCode(
    @CurrentUser() passenger: AuthenticatedUser,
    @Param('tripId') tripId: string,
  ) {
    return this.lifecycle.issueBoardingCode(passenger, tripId);
  }

  @Post('driver/trips/:tripId/start')
  @Roles('DRIVER')
  startTrip(
    @CurrentUser() driver: AuthenticatedUser,
    @Param('tripId') tripId: string,
    @Body() input: BoardingCodeDto,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.lifecycle.startTrip(driver, tripId, input.code, key ?? '');
  }

  @Post('driver/trips/:tripId/complete')
  @Roles('DRIVER')
  @HttpCode(200)
  completeTrip(
    @CurrentUser() driver: AuthenticatedUser,
    @Param('tripId') tripId: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.lifecycle.completeTrip(driver, tripId, key ?? '');
  }
}
