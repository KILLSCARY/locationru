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
import { AdminAuthService } from './admin-auth.service.js';
import { CreateAuthBlockDto } from './dto/create-auth-block.dto.js';

@ApiTags('admin-auth')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Get('security-events')
  listSecurityEvents(
    @Query() query: { page?: string; pageSize?: string; type?: string },
  ) {
    return this.adminAuthService.listSecurityEvents(query);
  }

  @Get('blocks')
  listBlocks(
    @Query() query: { page?: string; pageSize?: string; activeOnly?: string },
  ) {
    return this.adminAuthService.listAuthBlocks(query);
  }

  @Post('blocks')
  createBlock(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: CreateAuthBlockDto,
  ) {
    return this.adminAuthService.createBlock(admin.id, dto);
  }

  @Post('blocks/:id/unblock')
  unblock(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string) {
    return this.adminAuthService.unblock(admin.id, id);
  }

  @Get('sms-balance')
  getSmsBalance() {
    return this.adminAuthService.getSmsBalance();
  }
}
