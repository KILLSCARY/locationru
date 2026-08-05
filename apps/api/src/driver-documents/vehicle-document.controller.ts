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
import { RequestVehicleDocumentUploadUrlDto } from './dto/request-vehicle-document-upload-url.dto.js';
import { VehicleDocumentService } from './vehicle-document.service.js';

@ApiTags('vehicle-documents')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('DRIVER')
@Controller('drivers/me/vehicles/:vehicleId/documents')
export class VehicleDocumentController {
  constructor(private readonly documents: VehicleDocumentService) {}

  @Post('upload-url')
  requestUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() input: RequestVehicleDocumentUploadUrlDto,
  ) {
    return this.documents.requestUploadUrl(user.id, vehicleId, input);
  }

  @Post(':documentId/confirm')
  confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.confirmUpload(user.id, vehicleId, documentId);
  }

  @Get()
  listDocuments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.documents.listDocuments(user.id, vehicleId);
  }

  @Delete(':documentId')
  deleteDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.deleteDocument(user.id, vehicleId, documentId);
  }
}
