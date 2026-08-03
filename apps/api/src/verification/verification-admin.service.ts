import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { DocumentVersionService } from '../driver-documents/document-version.service.js';
import {
  DocumentRejectionReasonCode,
  DocumentStatus,
  DriverVerificationStatus,
  NotificationType,
  type Prisma,
  VehicleVerificationStatus,
  VerificationCaseDecision,
  VerificationCasePriority,
  VerificationCaseStatus,
} from '../generated/prisma/client.js';
import { MetricsService } from '../observability/metrics.service.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  OBJECT_STORAGE_PROVIDER,
  type ObjectStorageProvider,
} from '../storage/object-storage-provider.interface.js';
import type { AssignCaseDto } from './dto/assign-case.dto.js';
import type { CaseDecisionDto } from './dto/case-decision.dto.js';
import type { EscalateCaseDto } from './dto/escalate-case.dto.js';
import type { RejectDocumentDto } from './dto/reject-document.dto.js';
import type { SuspendDriverDto } from './dto/suspend-driver.dto.js';

const QUEUE_STATUSES = [
  VerificationCaseStatus.CREATED,
  VerificationCaseStatus.QUEUED,
  VerificationCaseStatus.ASSIGNED,
  VerificationCaseStatus.IN_REVIEW,
  VerificationCaseStatus.ESCALATED,
];

const PREVIEW_URL_TTL_SECONDS = 300;

interface PageQuery {
  page?: string;
  pageSize?: string;
  status?: string;
}

/**
 * The admin side of Task 29 section 14 — a driver's own document/vehicle/
 * profile endpoints never let them approve themselves; every state change
 * here funnels through a VerificationCase a human admin is working. There is
 * no automatic approval path anywhere in this service.
 */
@Injectable()
export class VerificationAdminService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly documentVersions: DocumentVersionService,
    private readonly metrics: MetricsService,
    private readonly notifications: NotificationService,
    private readonly notificationOutbox: NotificationOutboxService,
    @Inject(OBJECT_STORAGE_PROVIDER)
    private readonly storage: ObjectStorageProvider,
  ) {}

  async listQueue(query: PageQuery) {
    const pagination = this.pagination(query);
    const where = query.status
      ? { status: query.status as VerificationCaseStatus }
      : { status: { in: QUEUE_STATUSES } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.verificationCase.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        skip: pagination.skip,
        take: pagination.pageSize,
        include: {
          driver: {
            select: {
              firstName: true,
              lastName: true,
              cityId: true,
              user: { select: { phone: true } },
            },
          },
          assignedAdmin: { select: { id: true, phone: true } },
        },
      }),
      this.prisma.verificationCase.count({ where }),
    ]);
    return this.page(items, total, pagination);
  }

  async getCaseDetail(caseId: string) {
    const verificationCase = await this.requireCase(caseId);
    const [driverDocuments, vehicles] = await Promise.all([
      this.prisma.driverDocument.findMany({
        where: { driverId: verificationCase.driverId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vehicle.findMany({
        where: { driverId: verificationCase.driverId },
        include: {
          documents: { orderBy: { createdAt: 'desc' } },
        },
      }),
    ]);

    const driverDocumentsWithPreview = await Promise.all(
      driverDocuments.map((document) => this.withPreviewUrl(document)),
    );
    const vehiclesWithPreview = await Promise.all(
      vehicles.map(async (vehicle) => ({
        ...vehicle,
        documents: await Promise.all(
          vehicle.documents.map((document) => this.withPreviewUrl(document)),
        ),
      })),
    );

    return {
      case: verificationCase,
      driverDocuments: driverDocumentsWithPreview,
      vehicles: vehiclesWithPreview,
    };
  }

  async assign(
    adminId: string,
    caseId: string,
    input: AssignCaseDto,
  ): Promise<void> {
    const verificationCase = await this.requireCase(caseId);
    this.assertNotTerminal(verificationCase.status);

    const assigneeAdminId = input.assigneeAdminId ?? adminId;
    await this.prisma.$transaction(async (tx) => {
      await tx.verificationCase.update({
        where: { id: caseId },
        data: {
          assignedAdminId: assigneeAdminId,
          assignedAt: new Date(),
          status:
            verificationCase.status === VerificationCaseStatus.CREATED ||
            verificationCase.status === VerificationCaseStatus.QUEUED
              ? VerificationCaseStatus.ASSIGNED
              : verificationCase.status,
        },
      });
      await this.audit(
        tx,
        adminId,
        'VERIFICATION_CASE_ASSIGNED',
        'VerificationCase',
        caseId,
        {
          assigneeAdminId,
        },
      );
    });
  }

  async startReview(adminId: string, caseId: string): Promise<void> {
    const verificationCase = await this.requireCase(caseId);
    this.assertAssignedTo(verificationCase, adminId);
    if (verificationCase.status !== VerificationCaseStatus.ASSIGNED) {
      throw new ConflictException({
        code: 'CASE_NOT_ASSIGNED',
        message: 'Only an assigned case can move to review',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.verificationCase.update({
        where: { id: caseId },
        data: {
          status: VerificationCaseStatus.IN_REVIEW,
          reviewedAt: new Date(),
        },
      });
      await tx.driverProfile.update({
        where: { userId: verificationCase.driverId },
        data: { verificationStatus: DriverVerificationStatus.UNDER_REVIEW },
      });
      const vehicleId = this.snapshotVehicleId(verificationCase);
      if (vehicleId) {
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { verificationStatus: VehicleVerificationStatus.UNDER_REVIEW },
        });
      }
      await this.audit(
        tx,
        adminId,
        'VERIFICATION_CASE_REVIEW_STARTED',
        'VerificationCase',
        caseId,
        {},
      );
    });
  }

  async approveDocument(
    adminId: string,
    caseId: string,
    documentKind: 'DRIVER' | 'VEHICLE',
    documentId: string,
  ): Promise<void> {
    const verificationCase = await this.requireCase(caseId);
    this.assertAssignedTo(verificationCase, adminId);

    if (documentKind === 'DRIVER') {
      const document = await this.requireDriverDocument(
        verificationCase.driverId,
        documentId,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.driverDocument.update({
          where: { id: documentId },
          data: {
            status: DocumentStatus.APPROVED,
            reviewedBy: adminId,
            reviewedAt: new Date(),
            rejectionReasonCode: null,
            rejectionComment: null,
          },
        });
        await this.documentVersions.activateVersion(
          `driver:${verificationCase.driverId}:${document.type}`,
          { driverDocumentId: documentId },
        );
        await this.audit(
          tx,
          adminId,
          'DRIVER_DOCUMENT_APPROVED',
          'DriverDocument',
          documentId,
          {},
        );
      });
    } else {
      const document = await this.requireVehicleDocument(
        verificationCase.driverId,
        documentId,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.vehicleDocument.update({
          where: { id: documentId },
          data: {
            status: DocumentStatus.APPROVED,
            reviewedBy: adminId,
            reviewedAt: new Date(),
            rejectionReasonCode: null,
            rejectionComment: null,
          },
        });
        await this.documentVersions.activateVersion(
          `vehicle:${document.vehicleId}:${document.type}`,
          { vehicleDocumentId: documentId },
        );
        await this.audit(
          tx,
          adminId,
          'VEHICLE_DOCUMENT_APPROVED',
          'VehicleDocument',
          documentId,
          {},
        );
      });
    }
  }

  async rejectDocument(
    adminId: string,
    caseId: string,
    documentKind: 'DRIVER' | 'VEHICLE',
    documentId: string,
    input: RejectDocumentDto,
  ): Promise<void> {
    const verificationCase = await this.requireCase(caseId);
    this.assertAssignedTo(verificationCase, adminId);
    this.assertCommentRequiredForOther([input.reasonCode], input.comment);

    if (documentKind === 'DRIVER') {
      await this.requireDriverDocument(verificationCase.driverId, documentId);
      await this.prisma.$transaction(async (tx) => {
        await tx.driverDocument.update({
          where: { id: documentId },
          data: {
            status: DocumentStatus.REJECTED,
            reviewedBy: adminId,
            reviewedAt: new Date(),
            rejectionReasonCode: input.reasonCode,
            rejectionComment: input.comment ?? null,
          },
        });
        await this.audit(
          tx,
          adminId,
          'DRIVER_DOCUMENT_REJECTED',
          'DriverDocument',
          documentId,
          {
            reasonCode: input.reasonCode,
            internalComment: input.internalComment ?? null,
          },
        );
      });
    } else {
      await this.requireVehicleDocument(verificationCase.driverId, documentId);
      await this.prisma.$transaction(async (tx) => {
        await tx.vehicleDocument.update({
          where: { id: documentId },
          data: {
            status: DocumentStatus.REJECTED,
            reviewedBy: adminId,
            reviewedAt: new Date(),
            rejectionReasonCode: input.reasonCode,
            rejectionComment: input.comment ?? null,
          },
        });
        await this.audit(
          tx,
          adminId,
          'VEHICLE_DOCUMENT_REJECTED',
          'VehicleDocument',
          documentId,
          {
            reasonCode: input.reasonCode,
            internalComment: input.internalComment ?? null,
          },
        );
      });
    }
  }

  async approveVehicle(
    adminId: string,
    caseId: string,
    vehicleId: string,
  ): Promise<void> {
    const verificationCase = await this.requireCase(caseId);
    this.assertAssignedTo(verificationCase, adminId);
    await this.requireOwnedVehicle(verificationCase.driverId, vehicleId);

    const requiredTypes = this.config.getOrThrow<string[]>(
      'driverVerification.requiredVehicleDocumentTypes',
    );
    const approvedDocs = await this.prisma.vehicleDocument.findMany({
      where: {
        vehicleId,
        type: { in: requiredTypes as never[] },
        status: DocumentStatus.APPROVED,
      },
      select: { type: true },
    });
    const approvedTypes = new Set(approvedDocs.map((doc) => doc.type));
    const missing = requiredTypes.filter(
      (type) => !approvedTypes.has(type as never),
    );
    if (missing.length > 0) {
      throw new ConflictException({
        code: 'VEHICLE_DOCUMENTS_NOT_ALL_APPROVED',
        message: 'All required vehicle documents must be approved first',
        missingDocumentTypes: missing,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          verificationStatus: VehicleVerificationStatus.APPROVED,
          approvedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        adminId,
        'VEHICLE_APPROVED',
        'Vehicle',
        vehicleId,
        {},
      );
    });
  }

  async rejectVehicle(
    adminId: string,
    caseId: string,
    vehicleId: string,
    input: CaseDecisionDto,
  ): Promise<void> {
    const verificationCase = await this.requireCase(caseId);
    this.assertAssignedTo(verificationCase, adminId);
    await this.requireOwnedVehicle(verificationCase.driverId, vehicleId);
    this.assertCommentRequiredForOther(input.reasonCodes, input.comment);

    await this.prisma.$transaction(async (tx) => {
      await tx.vehicle.update({
        where: { id: vehicleId },
        data: {
          verificationStatus: VehicleVerificationStatus.REJECTED,
          rejectedAt: new Date(),
        },
      });
      await this.audit(tx, adminId, 'VEHICLE_REJECTED', 'Vehicle', vehicleId, {
        reasonCodes: input.reasonCodes,
        comment: input.comment ?? null,
        internalComment: input.internalComment ?? null,
      });
    });
  }

  async approveDriver(adminId: string, caseId: string): Promise<void> {
    const verificationCase = await this.requireCase(caseId);
    this.assertAssignedTo(verificationCase, adminId);
    if (verificationCase.status !== VerificationCaseStatus.IN_REVIEW) {
      throw new ConflictException({
        code: 'CASE_NOT_IN_REVIEW',
        message: 'The case must be in review before it can be approved',
      });
    }

    const requiredDriverTypes = this.config.getOrThrow<string[]>(
      'driverVerification.requiredDriverDocumentTypes',
    );
    const approvedDriverDocs = await this.prisma.driverDocument.findMany({
      where: {
        driverId: verificationCase.driverId,
        type: { in: requiredDriverTypes as never[] },
        status: DocumentStatus.APPROVED,
      },
      select: { type: true },
    });
    const approvedTypes = new Set(approvedDriverDocs.map((doc) => doc.type));
    const missingDriverDocs = requiredDriverTypes.filter(
      (type) => !approvedTypes.has(type as never),
    );

    const vehicleId = this.snapshotVehicleId(verificationCase);
    const vehicle = vehicleId
      ? await this.prisma.vehicle.findUnique({ where: { id: vehicleId } })
      : null;
    const vehicleApproved =
      vehicle?.verificationStatus === VehicleVerificationStatus.APPROVED;

    if (missingDriverDocs.length > 0 || !vehicleApproved) {
      throw new ConflictException({
        code: 'DRIVER_NOT_APPROVABLE',
        message:
          'All required driver documents and the submitted vehicle must be approved first',
        missingDriverDocumentTypes: missingDriverDocs,
        vehicleApproved,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.driverProfile.update({
        where: { userId: verificationCase.driverId },
        data: {
          verificationStatus: DriverVerificationStatus.APPROVED,
          approvedAt: new Date(),
        },
      });
      await tx.verificationCase.update({
        where: { id: caseId },
        data: {
          status: VerificationCaseStatus.APPROVED,
          decision: VerificationCaseDecision.APPROVED,
          completedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        adminId,
        'DRIVER_VERIFICATION_APPROVED',
        'DriverProfile',
        verificationCase.driverId,
        {},
      );
    });

    this.metrics.increment(
      'driver_verification_approved_total',
      'VerificationCase decisions that resulted in driver approval',
    );
    await this.notifyDriver(
      verificationCase.driverId,
      caseId,
      NotificationType.DRIVER_ACCOUNT_APPROVED,
    );
  }

  async rejectDriver(
    adminId: string,
    caseId: string,
    input: CaseDecisionDto,
  ): Promise<void> {
    const verificationCase = await this.requireCase(caseId);
    this.assertAssignedTo(verificationCase, adminId);
    this.assertCommentRequiredForOther(input.reasonCodes, input.comment);
    if (verificationCase.status !== VerificationCaseStatus.IN_REVIEW) {
      throw new ConflictException({
        code: 'CASE_NOT_IN_REVIEW',
        message: 'The case must be in review before it can be rejected',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.driverProfile.update({
        where: { userId: verificationCase.driverId },
        data: {
          verificationStatus: DriverVerificationStatus.REJECTED,
          rejectedAt: new Date(),
        },
      });
      await tx.verificationCase.update({
        where: { id: caseId },
        data: {
          status: VerificationCaseStatus.REJECTED,
          decision: VerificationCaseDecision.REJECTED,
          decisionReasonCodes: input.reasonCodes,
          publicComment: input.comment ?? null,
          internalComment: input.internalComment ?? null,
          completedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        adminId,
        'DRIVER_VERIFICATION_REJECTED',
        'DriverProfile',
        verificationCase.driverId,
        {
          reasonCodes: input.reasonCodes,
        },
      );
    });

    this.metrics.increment(
      'driver_verification_rejected_total',
      'VerificationCase decisions that resulted in driver rejection',
    );
    await this.notifyDriver(
      verificationCase.driverId,
      caseId,
      NotificationType.DRIVER_ACCOUNT_REJECTED,
    );
  }

  async requestChanges(
    adminId: string,
    caseId: string,
    input: CaseDecisionDto,
  ): Promise<void> {
    const verificationCase = await this.requireCase(caseId);
    this.assertAssignedTo(verificationCase, adminId);
    this.assertCommentRequiredForOther(input.reasonCodes, input.comment);
    if (verificationCase.status !== VerificationCaseStatus.IN_REVIEW) {
      throw new ConflictException({
        code: 'CASE_NOT_IN_REVIEW',
        message: 'The case must be in review before requesting changes',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.driverProfile.update({
        where: { userId: verificationCase.driverId },
        data: {
          verificationStatus: DriverVerificationStatus.CHANGES_REQUESTED,
        },
      });
      await tx.verificationCase.update({
        where: { id: caseId },
        data: {
          status: VerificationCaseStatus.CHANGES_REQUESTED,
          decision: VerificationCaseDecision.CHANGES_REQUESTED,
          decisionReasonCodes: input.reasonCodes,
          publicComment: input.comment ?? null,
          internalComment: input.internalComment ?? null,
        },
      });
      await this.audit(
        tx,
        adminId,
        'DRIVER_VERIFICATION_CHANGES_REQUESTED',
        'DriverProfile',
        verificationCase.driverId,
        {
          reasonCodes: input.reasonCodes,
        },
      );
    });

    this.metrics.increment(
      'driver_verification_changes_requested_total',
      'VerificationCase decisions that sent the driver back for changes',
    );
    // No dedicated push NotificationType exists for CHANGES_REQUESTED (only
    // DRIVER_ACCOUNT_APPROVED/REJECTED are provisioned) — the driver still
    // sees the new status and comment via GET drivers/me/profile. Adding a
    // push type is a schema change, deferred — see the final Task 29 report.
  }

  async escalate(
    adminId: string,
    caseId: string,
    input: EscalateCaseDto,
  ): Promise<void> {
    const verificationCase = await this.requireCase(caseId);
    this.assertNotTerminal(verificationCase.status);

    await this.prisma.$transaction(async (tx) => {
      await tx.verificationCase.update({
        where: { id: caseId },
        data: {
          status: VerificationCaseStatus.ESCALATED,
          priority: VerificationCasePriority.HIGH,
        },
      });
      await this.audit(
        tx,
        adminId,
        'VERIFICATION_CASE_ESCALATED',
        'VerificationCase',
        caseId,
        {
          comment: input.comment ?? null,
        },
      );
    });
  }

  async suspendDriver(
    adminId: string,
    driverId: string,
    input: SuspendDriverDto,
  ): Promise<void> {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: driverId },
    });
    if (!profile) {
      throw new NotFoundException({
        code: 'DRIVER_PROFILE_NOT_FOUND',
        message: 'Driver profile was not found',
      });
    }
    if (profile.verificationStatus !== DriverVerificationStatus.APPROVED) {
      throw new ConflictException({
        code: 'DRIVER_NOT_ACTIVE',
        message: 'Only an approved driver can be suspended',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.driverProfile.update({
        where: { userId: driverId },
        data: {
          verificationStatus: DriverVerificationStatus.SUSPENDED,
          suspendedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        adminId,
        'DRIVER_SUSPENDED',
        'DriverProfile',
        driverId,
        {
          comment: input.comment,
        },
      );
    });
  }

  private snapshotVehicleId(verificationCase: {
    submittedSnapshot: unknown;
  }): string | null {
    const snapshot = verificationCase.submittedSnapshot as
      | { vehicleId?: string }
      | null
      | undefined;
    return snapshot?.vehicleId ?? null;
  }

  private assertCommentRequiredForOther(
    reasonCodes: DocumentRejectionReasonCode[],
    comment: string | undefined,
  ): void {
    if (
      reasonCodes.includes(DocumentRejectionReasonCode.OTHER) &&
      !comment?.trim()
    ) {
      throw new BadRequestException({
        code: 'COMMENT_REQUIRED_FOR_OTHER',
        message: 'A comment is required when using the OTHER reason code',
      });
    }
  }

  private assertNotTerminal(status: VerificationCaseStatus): void {
    const terminal: VerificationCaseStatus[] = [
      VerificationCaseStatus.APPROVED,
      VerificationCaseStatus.REJECTED,
      VerificationCaseStatus.CANCELLED,
    ];
    if (terminal.includes(status)) {
      throw new ConflictException({
        code: 'CASE_ALREADY_CLOSED',
        message: 'This verification case is already closed',
      });
    }
  }

  private assertAssignedTo(
    verificationCase: { assignedAdminId: string | null },
    adminId: string,
  ): void {
    if (verificationCase.assignedAdminId !== adminId) {
      throw new ForbiddenException({
        code: 'CASE_NOT_ASSIGNED_TO_YOU',
        message: 'Assign this case to yourself before acting on it',
      });
    }
  }

  private async requireCase(caseId: string) {
    const verificationCase = await this.prisma.verificationCase.findUnique({
      where: { id: caseId },
    });
    if (!verificationCase) {
      throw new NotFoundException({
        code: 'VERIFICATION_CASE_NOT_FOUND',
        message: 'Verification case was not found',
      });
    }
    return verificationCase;
  }

  private async requireDriverDocument(driverId: string, documentId: string) {
    const document = await this.prisma.driverDocument.findUnique({
      where: { id: documentId },
    });
    if (!document || document.driverId !== driverId) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Driver document was not found for this case',
      });
    }
    if (document.status !== DocumentStatus.READY_FOR_REVIEW) {
      throw new ConflictException({
        code: 'DOCUMENT_NOT_REVIEWABLE',
        message: 'Only a document awaiting review can be decided',
      });
    }
    return document;
  }

  private async requireVehicleDocument(driverId: string, documentId: string) {
    const document = await this.prisma.vehicleDocument.findUnique({
      where: { id: documentId },
      include: { vehicle: { select: { driverId: true } } },
    });
    if (!document || document.vehicle.driverId !== driverId) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Vehicle document was not found for this case',
      });
    }
    if (document.status !== DocumentStatus.READY_FOR_REVIEW) {
      throw new ConflictException({
        code: 'DOCUMENT_NOT_REVIEWABLE',
        message: 'Only a document awaiting review can be decided',
      });
    }
    return document;
  }

  private async requireOwnedVehicle(driverId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });
    if (!vehicle || vehicle.driverId !== driverId) {
      throw new NotFoundException({
        code: 'VEHICLE_NOT_FOUND',
        message: 'Vehicle was not found for this case',
      });
    }
    return vehicle;
  }

  private async withPreviewUrl<T extends { previewObjectKey: string | null }>(
    document: T,
  ): Promise<T & { previewUrl: string | null }> {
    if (!document.previewObjectKey) {
      return { ...document, previewUrl: null };
    }
    const preview = await this.storage.createSecureDownloadUrl(
      document.previewObjectKey,
      PREVIEW_URL_TTL_SECONDS,
    );
    return { ...document, previewUrl: preview.url };
  }

  private async notifyDriver(
    driverId: string,
    caseId: string,
    type: NotificationType,
  ): Promise<void> {
    const draft = this.notifications.createDraft({
      userId: driverId,
      type,
      application: 'DRIVER' as never,
      entityType: 'VERIFICATION_CASE',
      entityId: caseId,
      idempotencyKey: `verification-case-decision:${caseId}:${type}`,
      templateParams: {},
    });
    await this.notificationOutbox.enqueue(this.prisma, draft);
  }

  private async audit(
    tx: Pick<Prisma.TransactionClient, 'adminAuditLog'>,
    adminId: string,
    action: string,
    targetType: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetType,
        targetId,
        payload: payload as Prisma.InputJsonObject,
      },
    });
  }

  private pagination(query: PageQuery) {
    const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(query.pageSize ?? '20', 10) || 20),
    );
    return { page, pageSize, skip: (page - 1) * pageSize };
  }

  private page<T>(
    items: T[],
    total: number,
    pagination: { page: number; pageSize: number },
  ) {
    return {
      items,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }
}
