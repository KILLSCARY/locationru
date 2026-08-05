import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { AdminService } from './admin.service.js';

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

  // Driver/vehicle document review now lives entirely in the verification
  // module (POST/GET .../admin/verification/*) — see
  // src/verification/verification-admin.controller.ts and
  // docs/drivers/verification.md. The old single-step "APPROVED"/"REJECTED"
  // review endpoints are removed rather than kept alongside it: this app has
  // never shipped to a real user base, so there is no external client
  // depending on the old shape to preserve.

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

  @Get('notifications/push-stats')
  getPushStats() {
    return this.adminService.getPushStats();
  }

  @Get('notifications/dead-letter')
  listDeadLetterPush(@Query() query: { page?: string; pageSize?: string }) {
    return this.adminService.listDeadLetterPush(query);
  }

  @Post('notifications/dead-letter/:eventId/retry')
  retryDeadLetterPush(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('eventId') eventId: string,
  ) {
    return this.adminService.retryDeadLetterPush(admin.id, eventId);
  }
}
