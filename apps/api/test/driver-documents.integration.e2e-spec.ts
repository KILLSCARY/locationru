import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { jest } from '@jest/globals';

import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../src/auth/guards/roles.guard.js';
import { DriverDocumentController } from '../src/driver-documents/driver-document.controller.js';
import { DriverDocumentService } from '../src/driver-documents/driver-document.service.js';

const driver: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000010',
  phone: '+79990000010',
  role: 'DRIVER',
  sessionId: '00000000-0000-4000-8000-000000000011',
};

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

describe('Driver document upload/confirm/list/get/delete (HTTP layer)', () => {
  let app: INestApplication;
  const documentService = {
    requestUploadUrl: jest.fn(async () => ({
      documentId: DOCUMENT_ID,
      uploadUrl: 'https://storage.local/upload',
      expiresAt: new Date().toISOString(),
      requiredHeaders: { 'Content-Type': 'image/jpeg' },
    })),
    confirmUpload: jest.fn(async () => ({
      id: DOCUMENT_ID,
      status: 'READY_FOR_REVIEW',
    })),
    listDocuments: jest.fn(async () => [
      { id: DOCUMENT_ID, status: 'READY_FOR_REVIEW' },
    ]),
    getDocument: jest.fn(async () => ({
      id: DOCUMENT_ID,
      status: 'READY_FOR_REVIEW',
      previewUrl: null,
    })),
    deleteDocument: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DriverDocumentController],
      providers: [
        { provide: DriverDocumentService, useValue: documentService },
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

  function validUploadRequest() {
    return {
      documentType: 'PASSPORT_MAIN_PAGE',
      fileName: 'passport.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1_000,
    };
  }

  describe('POST /drivers/me/documents/upload-url', () => {
    it('accepts a valid upload request and delegates to the service', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/drivers/me/documents/upload-url')
        .send(validUploadRequest())
        .expect(201)
        .expect((res) => {
          expect(res.body.documentId).toBe(DOCUMENT_ID);
        });

      expect(documentService.requestUploadUrl).toHaveBeenCalledWith(
        driver.id,
        expect.objectContaining({ mimeType: 'image/jpeg' }),
      );
    });

    it('rejects an unknown document type before reaching the service', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/drivers/me/documents/upload-url')
        .send({ ...validUploadRequest(), documentType: 'NOT_A_REAL_TYPE' })
        .expect(400);

      expect(documentService.requestUploadUrl).not.toHaveBeenCalled();
    });

    it('rejects a disallowed MIME type before reaching the service', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/drivers/me/documents/upload-url')
        .send({ ...validUploadRequest(), mimeType: 'application/zip' })
        .expect(400);

      expect(documentService.requestUploadUrl).not.toHaveBeenCalled();
    });

    it('rejects a non-positive declared file size before reaching the service', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/drivers/me/documents/upload-url')
        .send({ ...validUploadRequest(), fileSize: 0 })
        .expect(400);

      expect(documentService.requestUploadUrl).not.toHaveBeenCalled();
    });

    it('surfaces a service-level size rejection as 400', async () => {
      documentService.requestUploadUrl.mockRejectedValueOnce(
        new BadRequestException({
          code: 'DOCUMENT_TOO_LARGE',
          message: 'too large',
        }),
      );

      await request(app.getHttpServer())
        .post('/api/v1/drivers/me/documents/upload-url')
        .send(validUploadRequest())
        .expect(400)
        .expect((res) => {
          expect(res.body.code).toBe('DOCUMENT_TOO_LARGE');
        });
    });
  });

  describe('POST /drivers/me/documents/:documentId/confirm', () => {
    it('confirms an upload for a UUID-shaped document id', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/drivers/me/documents/${DOCUMENT_ID}/confirm`)
        .expect(201);

      expect(documentService.confirmUpload).toHaveBeenCalledWith(
        driver.id,
        DOCUMENT_ID,
      );
    });

    it('rejects a non-UUID document id before reaching the service', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/drivers/me/documents/not-a-uuid/confirm')
        .expect(400);

      expect(documentService.confirmUpload).not.toHaveBeenCalled();
    });

    it('surfaces an ownership violation from the service as 403', async () => {
      documentService.confirmUpload.mockRejectedValueOnce(
        new ForbiddenException({
          code: 'DOCUMENT_ACCESS_DENIED',
          message: 'not yours',
        }),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/drivers/me/documents/${DOCUMENT_ID}/confirm`)
        .expect(403)
        .expect((res) => {
          expect(res.body.code).toBe('DOCUMENT_ACCESS_DENIED');
        });
    });

    it('surfaces a not-found document as 404', async () => {
      documentService.confirmUpload.mockRejectedValueOnce(
        new NotFoundException({
          code: 'DOCUMENT_NOT_FOUND',
          message: 'missing',
        }),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/drivers/me/documents/${DOCUMENT_ID}/confirm`)
        .expect(404);
    });
  });

  describe('GET /drivers/me/documents', () => {
    it('lists the caller’s own documents', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/drivers/me/documents')
        .expect(200)
        .expect([{ id: DOCUMENT_ID, status: 'READY_FOR_REVIEW' }]);

      expect(documentService.listDocuments).toHaveBeenCalledWith(driver.id);
    });
  });

  describe('GET /drivers/me/documents/:documentId', () => {
    it('never leaks a raw storage URL — only the service-provided previewUrl field', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/drivers/me/documents/${DOCUMENT_ID}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({
            id: DOCUMENT_ID,
            status: 'READY_FOR_REVIEW',
            previewUrl: null,
          });
        });
    });
  });

  describe('DELETE /drivers/me/documents/:documentId', () => {
    it('deletes an owned, deletable document', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/drivers/me/documents/${DOCUMENT_ID}`)
        .expect(200);

      expect(documentService.deleteDocument).toHaveBeenCalledWith(
        driver.id,
        DOCUMENT_ID,
      );
    });

    it('surfaces a 409 when the document is locked under an open review', async () => {
      documentService.deleteDocument.mockRejectedValueOnce(
        new ConflictException({
          code: 'DOCUMENT_LOCKED_UNDER_REVIEW',
          message: 'locked',
        }),
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/drivers/me/documents/${DOCUMENT_ID}`)
        .expect(409)
        .expect((res) => {
          expect(res.body.code).toBe('DOCUMENT_LOCKED_UNDER_REVIEW');
        });
    });
  });
});
