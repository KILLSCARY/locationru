import {
  ConflictException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { jest } from '@jest/globals';

import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../src/auth/guards/roles.guard.js';
import { VerificationSubmissionController } from '../src/driver-verification/verification-submission.controller.js';
import { VerificationSubmissionService } from '../src/driver-verification/verification-submission.service.js';

const driver: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000020',
  phone: '+79990000020',
  role: 'DRIVER',
  sessionId: '00000000-0000-4000-8000-000000000021',
};

describe('POST /drivers/me/verification/submit (HTTP layer)', () => {
  let app: INestApplication;
  const submissions = {
    submit: jest.fn(async () => ({
      caseId: 'case-1',
      status: 'QUEUED',
      submittedAt: new Date().toISOString(),
    })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [VerificationSubmissionController],
      providers: [
        { provide: VerificationSubmissionService, useValue: submissions },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => { user?: AuthenticatedUser };
          };
        }) => {
          context.switchToHttp().getRequest().user = driver;
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

  it('submits for the authenticated driver and returns the created case', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/drivers/me/verification/submit')
      .expect(201)
      .expect((res) => {
        expect(res.body).toMatchObject({ caseId: 'case-1', status: 'QUEUED' });
      });

    expect(submissions.submit).toHaveBeenCalledWith(driver.id);
  });

  it.each([
    ['PROFILE_INCOMPLETE'],
    ['CASE_ALREADY_OPEN'],
    ['REQUIRED_DRIVER_DOCUMENT_NOT_READY'],
    ['NO_ELIGIBLE_VEHICLE'],
    ['CONSENT_MISSING'],
  ])(
    'surfaces the %s pre-submission failure as HTTP 409 with that code',
    async (code) => {
      submissions.submit.mockRejectedValueOnce(
        new ConflictException({ code, message: 'blocked' }),
      );

      await request(app.getHttpServer())
        .post('/api/v1/drivers/me/verification/submit')
        .expect(409)
        .expect((res) => {
          expect(res.body.code).toBe(code);
        });
    },
  );
});
