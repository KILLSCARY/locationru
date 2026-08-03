import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { DocumentRetentionAdminService } from './document-retention-admin.service.js';
import { PlaceLegalHoldDto } from './dto/place-legal-hold.dto.js';

@ApiTags('admin-document-retention')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/document-retention')
export class DocumentRetentionAdminController {
  constructor(private readonly retention: DocumentRetentionAdminService) {}

  @Get('queue')
  listQueue(@Query() query: { page?: string; pageSize?: string }) {
    return this.retention.listQueue(query);
  }

  @Post(':queueEntryId/legal-hold')
  placeLegalHold(
    @Param('queueEntryId') queueEntryId: string,
    @Body() input: PlaceLegalHoldDto,
  ) {
    return this.retention.placeLegalHold(queueEntryId, input.reason);
  }

  @Delete(':queueEntryId/legal-hold')
  liftLegalHold(@Param('queueEntryId') queueEntryId: string) {
    return this.retention.liftLegalHold(queueEntryId);
  }
}
