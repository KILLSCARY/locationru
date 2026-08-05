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
import { AssignCaseDto } from './dto/assign-case.dto.js';
import { CaseDecisionDto } from './dto/case-decision.dto.js';
import { EscalateCaseDto } from './dto/escalate-case.dto.js';
import { RejectDocumentDto } from './dto/reject-document.dto.js';
import { SuspendDriverDto } from './dto/suspend-driver.dto.js';
import { VerificationAdminService } from './verification-admin.service.js';

@ApiTags('admin-verification')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/verification')
export class VerificationAdminController {
  constructor(private readonly verification: VerificationAdminService) {}

  @Get('cases')
  listQueue(
    @Query() query: { page?: string; pageSize?: string; status?: string },
  ) {
    return this.verification.listQueue(query);
  }

  @Get('cases/:caseId')
  getCaseDetail(@Param('caseId') caseId: string) {
    return this.verification.getCaseDetail(caseId);
  }

  @Post('cases/:caseId/assign')
  assign(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() input: AssignCaseDto,
  ) {
    return this.verification.assign(admin.id, caseId, input);
  }

  @Post('cases/:caseId/start-review')
  startReview(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
  ) {
    return this.verification.startReview(admin.id, caseId);
  }

  @Post('cases/:caseId/documents/:documentId/approve')
  approveDriverDocument(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.verification.approveDocument(
      admin.id,
      caseId,
      'DRIVER',
      documentId,
    );
  }

  @Post('cases/:caseId/documents/:documentId/reject')
  rejectDriverDocument(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Param('documentId') documentId: string,
    @Body() input: RejectDocumentDto,
  ) {
    return this.verification.rejectDocument(
      admin.id,
      caseId,
      'DRIVER',
      documentId,
      input,
    );
  }

  @Post('cases/:caseId/vehicles/:vehicleId/documents/:documentId/approve')
  approveVehicleDocument(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.verification.approveDocument(
      admin.id,
      caseId,
      'VEHICLE',
      documentId,
    );
  }

  @Post('cases/:caseId/vehicles/:vehicleId/documents/:documentId/reject')
  rejectVehicleDocument(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Param('documentId') documentId: string,
    @Body() input: RejectDocumentDto,
  ) {
    return this.verification.rejectDocument(
      admin.id,
      caseId,
      'VEHICLE',
      documentId,
      input,
    );
  }

  @Post('cases/:caseId/vehicles/:vehicleId/approve')
  approveVehicle(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    return this.verification.approveVehicle(admin.id, caseId, vehicleId);
  }

  @Post('cases/:caseId/vehicles/:vehicleId/reject')
  rejectVehicle(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Param('vehicleId') vehicleId: string,
    @Body() input: CaseDecisionDto,
  ) {
    return this.verification.rejectVehicle(admin.id, caseId, vehicleId, input);
  }

  @Post('cases/:caseId/approve-driver')
  approveDriver(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
  ) {
    return this.verification.approveDriver(admin.id, caseId);
  }

  @Post('cases/:caseId/reject-driver')
  rejectDriver(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() input: CaseDecisionDto,
  ) {
    return this.verification.rejectDriver(admin.id, caseId, input);
  }

  @Post('cases/:caseId/request-changes')
  requestChanges(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() input: CaseDecisionDto,
  ) {
    return this.verification.requestChanges(admin.id, caseId, input);
  }

  @Post('cases/:caseId/escalate')
  escalate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() input: EscalateCaseDto,
  ) {
    return this.verification.escalate(admin.id, caseId, input);
  }

  @Post('drivers/:driverId/suspend')
  suspendDriver(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('driverId') driverId: string,
    @Body() input: SuspendDriverDto,
  ) {
    return this.verification.suspendDriver(admin.id, driverId, input);
  }
}
