import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { DriverDocumentService } from './driver-document.service.js';
import { RequestDriverDocumentUploadUrlDto } from './dto/request-document-upload-url.dto.js';

@ApiTags('driver-documents')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('DRIVER')
@Controller('drivers/me/documents')
export class DriverDocumentController {
  constructor(private readonly documents: DriverDocumentService) {}

  @Post('upload-url')
  requestUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: RequestDriverDocumentUploadUrlDto,
  ) {
    return this.documents.requestUploadUrl(user.id, input);
  }

  @Post(':documentId/confirm')
  confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.confirmUpload(user.id, documentId);
  }

  @Get()
  listDocuments(@CurrentUser() user: AuthenticatedUser) {
    return this.documents.listDocuments(user.id);
  }

  @Get(':documentId')
  getDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.getDocument(user.id, documentId);
  }

  @Delete(':documentId')
  deleteDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.deleteDocument(user.id, documentId);
  }
}
