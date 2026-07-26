import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateTripDto } from './dto/create-trip.dto.js';
import { TripService, type PassengerTripDetails } from './trip.service.js';
import type { TripTransitionResult } from './trip-state-machine.service.js';

@ApiTags('trips')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('PASSENGER')
@Controller('trips')
export class TripController {
  constructor(private readonly tripService: TripService) {}

  @Post()
  @ApiOperation({ summary: 'Create a passenger trip draft' })
  @ApiCreatedResponse({
    description: 'Trip draft created or replayed by idempotency key',
  })
  create(
    @CurrentUser() passenger: AuthenticatedUser,
    @Body() input: CreateTripDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<{ id: string; status: string; version: number }> {
    return this.tripService.create(passenger, input, idempotencyKey);
  }

  @Get(':tripId')
  @ApiOperation({ summary: 'Get a passenger trip' })
  @ApiOkResponse({ description: 'Passenger trip details' })
  getById(
    @CurrentUser() passenger: AuthenticatedUser,
    @Param('tripId') tripId: string,
  ): Promise<PassengerTripDetails> {
    return this.tripService.getById(passenger, tripId);
  }

  @Post(':tripId/start-search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start driver search for a trip draft' })
  startSearch(
    @CurrentUser() passenger: AuthenticatedUser,
    @Param('tripId') tripId: string,
  ): Promise<TripTransitionResult> {
    return this.tripService.startSearch(passenger, tripId);
  }

  @Post(':tripId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a passenger trip idempotently' })
  cancel(
    @CurrentUser() passenger: AuthenticatedUser,
    @Param('tripId') tripId: string,
  ): Promise<TripTransitionResult> {
    return this.tripService.cancel(passenger, tripId);
  }
}
