import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { NotificationInboxResponse } from '@resilient-taxi/contracts';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ListInboxQueryDto } from './dto/list-inbox.dto.js';
import { NotificationInboxService } from './notification-inbox.service.js';
import type { PushApplication } from '../generated/prisma/enums.js';

/** Safe only because @Roles('PASSENGER', 'DRIVER') + RolesGuard already guarantee user.role is one of exactly these two values before a handler runs. */
function roleToPushApplication(
  role: AuthenticatedUser['role'],
): PushApplication {
  return role as PushApplication;
}

/**
 * The in-app inbox is how a client reconciles state after opening the app —
 * push itself is never the source of truth. `application` is always derived
 * from the authenticated role, never a request field.
 */
@ApiTags('notifications')
@Controller('notifications/inbox')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('PASSENGER', 'DRIVER')
@ApiBearerAuth()
export class NotificationInboxController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @Get()
  @ApiOperation({ summary: "List this user's notification inbox" })
  @ApiOkResponse({ description: 'A page of inbox items.' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInboxQueryDto,
  ): Promise<NotificationInboxResponse> {
    return this.inbox.listInbox(user.id, roleToPushApplication(user.role), {
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      unreadOnly: query.unreadOnly === 'true',
    });
  }

  @Post(':id/opened')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report that the user opened this notification (push tap)',
  })
  async opened(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ status: 'ok' }> {
    await this.inbox.markOpened(user.id, id);
    return { status: 'ok' };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a single inbox item as read' })
  async read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ status: 'ok' }> {
    await this.inbox.markRead(user.id, id);
    return { status: 'ok' };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark all of this user's inbox items as read" })
  async readAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ status: 'ok'; count: number }> {
    const { count } = await this.inbox.markAllRead(
      user.id,
      roleToPushApplication(user.role),
    );
    return { status: 'ok', count };
  }
}
