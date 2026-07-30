import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { AdminService } from './admin.service.js';
import { ReviewDto } from './dto/review.dto.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      role?: string;
      status?: string;
      search?: string;
    },
  ) {
    return this.adminService.listUsers(query);
  }

  @Post('users/:userId/block')
  blockUser(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
  ) {
    return this.adminService.blockUser(admin.id, userId);
  }

  @Get('drivers')
  listDrivers(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      verificationStatus?: string;
      status?: string;
    },
  ) {
    return this.adminService.listDrivers(query);
  }

  @Post('drivers/:driverId/review')
  reviewDriver(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('driverId') driverId: string,
    @Body() body: ReviewDto,
  ) {
    return this.adminService.reviewDriver(admin.id, driverId, body.decision);
  }

  @Post('vehicles/:vehicleId/review')
  reviewVehicle(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('vehicleId') vehicleId: string,
    @Body() body: ReviewDto,
  ) {
    return this.adminService.reviewVehicle(admin.id, vehicleId, body.decision);
  }

  @Get('trips')
  listTrips(
    @Query() query: { page?: string; pageSize?: string; status?: string },
  ) {
    return this.adminService.listTrips(query);
  }

  @Get('trips/:tripId')
  getTripDetails(@Param('tripId') tripId: string) {
    return this.adminService.getTripDetails(tripId);
  }

  @Get('payments')
  listPayments(
    @Query() query: { page?: string; pageSize?: string; status?: string },
  ) {
    return this.adminService.listPayments(query);
  }

  @Get('audit')
  listAudit(@Query() query: { page?: string; pageSize?: string }) {
    return this.adminService.listAudit(query);
  }
}
