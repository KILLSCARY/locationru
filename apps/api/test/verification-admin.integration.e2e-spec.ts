import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { jest } from '@jest/globals';

import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../src/auth/guards/roles.guard.js';
import { VerificationAdminController } from '../src/verification/verification-admin.controller.js';
import { VerificationAdminService } from '../src/verification/verification-admin.service.js';

const admin: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000030',
  phone: '+79990000030',
  role: 'ADMIN',
  sessionId: '00000000-0000-4000-8000-000000000031',
};

const CASE_ID = 'case-1';
const DOCUMENT_ID = 'doc-1';
const VEHICLE_ID = 'vehicle-1';

describe('Admin verification review endpoints (HTTP layer)', () => {
  let app: INestApplication;
  const verification = {
    listQueue: jest.fn(async () => ({ items: [], total: 0 })),
    getCaseDetail: jest.fn(async () => ({ id: CASE_ID })),
    assign: jest.fn(async () => ({ id: CASE_ID, status: 'ASSIGNED' })),
    startReview: jest.fn(async () => ({ id: CASE_ID, status: 'IN_REVIEW' })),
    approveDocument: jest.fn(async () => ({
      id: DOCUMENT_ID,
      status: 'APPROVED',
    })),
    rejectDocument: jest.fn(async () => ({
      id: DOCUMENT_ID,
      status: 'REJECTED',
    })),
    approveVehicle: jest.fn(async () => ({
      id: VEHICLE_ID,
      status: 'APPROVED',
    })),
    rejectVehicle: jest.fn(async () => ({
      id: VEHICLE_ID,
      status: 'REJECTED',
    })),
    approveDriver: jest.fn(async () => ({ id: CASE_ID, status: 'APPROVED' })),
    rejectDriver: jest.fn(async () => ({ id: CASE_ID, status: 'REJECTED' })),
    requestChanges: jest.fn(async () => ({
      id: CASE_ID,
      status: 'CHANGES_REQUESTED',
    })),
    escalate: jest.fn(async () => ({ id: CASE_ID, priority: 'HIGH' })),
    suspendDriver: jest.fn(async () => ({ status: 'SUSPENDED' })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [VerificationAdminController],
      providers: [
        { provide: VerificationAdminService, useValue: verification },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => { user?: AuthenticatedUser };
          };
        }) => {
          context.switchToHttp().getRequest().user = admin;
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('approves a driver document with no request body needed', async () => {
    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/verification/cases/${CASE_ID}/documents/${DOCUMENT_ID}/approve`,
      )
      .expect(201);

    expect(verification.approveDocument).toHaveBeenCalledWith(
      admin.id,
      CASE_ID,
      'DRIVER',
      DOCUMENT_ID,
    );
  });

  describe('reject-document validation', () => {
    it('rejects a request missing reasonCode before reaching the service', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/admin/verification/cases/${CASE_ID}/documents/${DOCUMENT_ID}/reject`,
        )
        .send({ comment: 'blurry' })
        .expect(400);

      expect(verification.rejectDocument).not.toHaveBeenCalled();
    });

    it('rejects an unknown reasonCode before reaching the service', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/admin/verification/cases/${CASE_ID}/documents/${DOCUMENT_ID}/reject`,
        )
        .send({ reasonCode: 'NOT_A_REAL_REASON' })
        .expect(400);

      expect(verification.rejectDocument).not.toHaveBeenCalled();
    });

    it('accepts a valid reasonCode and delegates to the service', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/admin/verification/cases/${CASE_ID}/documents/${DOCUMENT_ID}/reject`,
        )
        .send({ reasonCode: 'DOCUMENT_UNREADABLE' })
        .expect(201);

      expect(verification.rejectDocument).toHaveBeenCalledWith(
        admin.id,
        CASE_ID,
        'DRIVER',
        DOCUMENT_ID,
        expect.objectContaining({ reasonCode: 'DOCUMENT_UNREADABLE' }),
      );
    });

    it('surfaces a service-level 400 when OTHER is chosen without a comment', async () => {
      verification.rejectDocument.mockRejectedValueOnce(
        new BadRequestException({
          code: 'REJECTION_COMMENT_REQUIRED',
          message: 'comment required for OTHER',
        }),
      );

      await request(app.getHttpServer())
        .post(
          `/api/v1/admin/verification/cases/${CASE_ID}/documents/${DOCUMENT_ID}/reject`,
        )
        .send({ reasonCode: 'OTHER' })
        .expect(400)
        .expect((res) => {
          expect(res.body.code).toBe('REJECTION_COMMENT_REQUIRED');
        });
    });
  });

  describe('case-wide decisions (reject-driver / request-changes)', () => {
    it('rejects an empty reasonCodes array before reaching the service', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/verification/cases/${CASE_ID}/request-changes`)
        .send({ reasonCodes: [] })
        .expect(400);

      expect(verification.requestChanges).not.toHaveBeenCalled();
    });

    it('rejects a reasonCodes array containing an unknown code', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/verification/cases/${CASE_ID}/request-changes`)
        .send({ reasonCodes: ['DOCUMENT_UNREADABLE', 'MADE_UP'] })
        .expect(400);
    });

    it('accepts a valid reasonCodes array for request-changes', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/verification/cases/${CASE_ID}/request-changes`)
        .send({ reasonCodes: ['DOCUMENT_UNREADABLE'] })
        .expect(201);

      expect(verification.requestChanges).toHaveBeenCalledWith(
        admin.id,
        CASE_ID,
        expect.objectContaining({ reasonCodes: ['DOCUMENT_UNREADABLE'] }),
      );
    });

    it('surfaces CASE_NOT_ASSIGNED_TO_YOU as 403 for reject-driver', async () => {
      verification.rejectDriver.mockRejectedValueOnce(
        new ForbiddenException({
          code: 'CASE_NOT_ASSIGNED_TO_YOU',
          message: 'not your case',
        }),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/admin/verification/cases/${CASE_ID}/reject-driver`)
        .send({ reasonCodes: ['DOCUMENT_MISMATCH'] })
        .expect(403)
        .expect((res) => {
          expect(res.body.code).toBe('CASE_NOT_ASSIGNED_TO_YOU');
        });
    });
  });

  it('surfaces DRIVER_NOT_APPROVABLE as 409 for approve-driver', async () => {
    verification.approveDriver.mockRejectedValueOnce(
      new ConflictException({
        code: 'DRIVER_NOT_APPROVABLE',
        message: 'not everything approved yet',
      }),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/admin/verification/cases/${CASE_ID}/approve-driver`)
      .expect(409)
      .expect((res) => {
        expect(res.body.code).toBe('DRIVER_NOT_APPROVABLE');
      });
  });

  it('approves a driver once every document and the vehicle are approved', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/verification/cases/${CASE_ID}/approve-driver`)
      .expect(201)
      .expect((res) => {
        expect(res.body).toMatchObject({ status: 'APPROVED' });
      });
  });

  it('escalates a case with an optional comment', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/verification/cases/${CASE_ID}/escalate`)
      .send({})
      .expect(201);

    expect(verification.escalate).toHaveBeenCalledWith(
      admin.id,
      CASE_ID,
      expect.any(Object),
    );
  });
});
