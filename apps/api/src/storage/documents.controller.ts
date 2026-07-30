import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { DocumentsService } from './documents.service.js';
import { RequestUploadDto } from './dto/request-upload.dto.js';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('upload-url')
  requestUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RequestUploadDto,
  ) {
    return this.documents.requestUpload(user.id, body);
  }

  @Post(':documentId/confirm-upload')
  confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
  ) {
    return this.documents.confirmUpload(user.id, documentId);
  }

  @Post(':documentId/download-url')
  requestDownload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
  ) {
    return this.documents.requestDownload(user.id, documentId);
  }

  @Delete(':documentId')
  deleteDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
  ) {
    return this.documents.deleteDocument(user.id, documentId);
  }
}
