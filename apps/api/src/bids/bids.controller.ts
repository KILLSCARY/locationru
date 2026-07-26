import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  BidsService,
  type AvailableDriverTrip,
  type DriverBidResponse,
  type PassengerBidResponse,
  type SelectedBidResponse,
} from './bids.service.js';
import { CreateDriverBidDto } from './dto/create-driver-bid.dto.js';

@ApiTags('bids')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Controller()
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  @Get('driver/trips/available')
  @Roles('DRIVER')
  @ApiOperation({
    summary: 'List dispatched trips available to the current driver',
  })
  available(
    @CurrentUser() driver: AuthenticatedUser,
  ): Promise<AvailableDriverTrip[]> {
    return this.bidsService.getAvailableTrips(driver);
  }

  @Post('trips/:tripId/bids')
  @Roles('DRIVER')
  @ApiOperation({
    summary: 'Create a driver bid or accept the passenger price',
  })
  @ApiCreatedResponse({ description: 'Active driver bid created' })
  create(
    @CurrentUser() driver: AuthenticatedUser,
    @Param('tripId') tripId: string,
    @Body() input: CreateDriverBidDto,
  ): Promise<DriverBidResponse> {
    return this.bidsService.create(driver, tripId, input);
  }

  @Delete('trips/:tripId/bids/:bidId')
  @Roles('DRIVER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw the current driver bid' })
  withdraw(
    @CurrentUser() driver: AuthenticatedUser,
    @Param('tripId') tripId: string,
    @Param('bidId') bidId: string,
  ): Promise<DriverBidResponse> {
    return this.bidsService.withdraw(driver, tripId, bidId);
  }

  @Get('trips/:tripId/bids')
  @Roles('PASSENGER')
  @ApiOperation({ summary: 'List active bids for a passenger trip' })
  @ApiOkResponse({ description: 'Active driver bids' })
  listForPassenger(
    @CurrentUser() passenger: AuthenticatedUser,
    @Param('tripId') tripId: string,
  ): Promise<PassengerBidResponse[]> {
    return this.bidsService.listForPassenger(passenger, tripId);
  }

  @Post('trips/:tripId/bids/:bidId/select')
  @Roles('PASSENGER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Select one active driver bid transactionally' })
  select(
    @CurrentUser() passenger: AuthenticatedUser,
    @Param('tripId') tripId: string,
    @Param('bidId') bidId: string,
  ): Promise<SelectedBidResponse> {
    return this.bidsService.select(passenger, tripId, bidId);
  }
}
