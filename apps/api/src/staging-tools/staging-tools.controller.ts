import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { SetPaymentScenarioDto } from './dto/set-payment-scenario.dto.js';
import { SimulateWebhookDto } from './dto/simulate-webhook.dto.js';
import { StagingOnlyGuard } from './staging-only.guard.js';
import { StagingToolsService } from './staging-tools.service.js';

/**
 * Every route here exists only when APP_ENV=staging (StagingOnlyGuard) and
 * only for SUPER_ADMIN (RolesGuard + @Roles). Excluded from Swagger
 * entirely — these are internal test tools, not part of the public API
 * surface, in every environment including staging itself.
 */
@ApiExcludeController()
@UseGuards(AccessTokenGuard, RolesGuard, StagingOnlyGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/staging')
export class StagingToolsController {
  constructor(private readonly stagingTools: StagingToolsService) {}

  @Get('otp/:phone')
  viewOtp(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('phone') phone: string,
  ) {
    return this.stagingTools.viewOtp(admin.id, phone);
  }

  @Put('payments/:tripId/scenario')
  setPaymentScenario(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('tripId') tripId: string,
    @Body() body: SetPaymentScenarioDto,
  ) {
    return this.stagingTools.setPaymentScenario(admin.id, tripId, body.scenario);
  }

  @Delete('payments/:tripId/scenario')
  clearPaymentScenario(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('tripId') tripId: string,
  ) {
    return this.stagingTools.clearPaymentScenario(admin.id, tripId);
  }

  @Post('payments/webhook-simulate')
  simulateWebhook(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: SimulateWebhookDto,
  ) {
    return this.stagingTools.simulateWebhook(admin.id, body);
  }

  @Get('outbox')
  listOutbox(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.stagingTools.listOutbox(
      Number.isInteger(parsed) && parsed > 0 ? parsed : 50,
    );
  }

  @Post('outbox/:eventId/retry')
  retryOutboxEvent(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('eventId') eventId: string,
  ) {
    return this.stagingTools.retryOutboxEvent(admin.id, eventId);
  }

  @Post('reset-test-data')
  resetTestData(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: { confirm?: boolean },
  ) {
    return this.stagingTools.resetTestData(admin.id, body?.confirm === true);
  }
}
