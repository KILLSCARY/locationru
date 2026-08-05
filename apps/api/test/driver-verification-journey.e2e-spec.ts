import { randomUUID } from 'node:crypto';

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../src/auth/guards/roles.guard.js';
import { DocumentVersionService } from '../src/driver-documents/document-version.service.js';
import { DriverDocumentController } from '../src/driver-documents/driver-document.controller.js';
import { DriverDocumentService } from '../src/driver-documents/driver-document.service.js';
import { VehicleDocumentController } from '../src/driver-documents/vehicle-document.controller.js';
import { VehicleDocumentService } from '../src/driver-documents/vehicle-document.service.js';
import { DriverConsentController } from '../src/driver-verification/driver-consent.controller.js';
import { DriverConsentService } from '../src/driver-verification/driver-consent.service.js';
import type { DriverDuplicateDetectionService } from '../src/driver-verification/driver-duplicate-detection.service.js';
import { DriverProfileController } from '../src/driver-verification/driver-profile.controller.js';
import { DriverProfileService } from '../src/driver-verification/driver-profile.service.js';
import { VerificationSubmissionController } from '../src/driver-verification/verification-submission.controller.js';
import { VerificationSubmissionService } from '../src/driver-verification/verification-submission.service.js';
import { DriverDataCryptoService } from '../src/drivers/infrastructure/driver-data-crypto.service.js';
import {
  DocumentStatus,
  DocumentVersionStatus,
  DriverVerificationStatus,
  VehicleVerificationStatus,
} from '../src/generated/prisma/client.js';
import type { NotificationOutboxService } from '../src/notifications/notification-outbox.service.js';
import type { NotificationService } from '../src/notifications/notification.service.js';
import { MetricsService } from '../src/observability/metrics.service.js';
import type { ObjectStorageProvider } from '../src/storage/object-storage-provider.interface.js';
import { VehicleController } from '../src/vehicles/vehicle.controller.js';
import { VehicleService } from '../src/vehicles/vehicle.service.js';
import { VerificationAdminController } from '../src/verification/verification-admin.controller.js';
import { VerificationAdminService } from '../src/verification/verification-admin.service.js';

/**
 * A genuine end-to-end run of Task 29's whole workflow (registration diagram
 * in section 1): fill profile -> add vehicle -> upload+confirm every
 * required document -> give every required consent -> submit -> admin
 * assigns/reviews/approves everything -> driver is APPROVED. Unlike
 * test/*.integration.e2e-spec.ts (which mock the service layer to test the
 * HTTP/DTO boundary), this wires the REAL services from Tasks 90-94 together
 * against one shared in-memory Prisma double, so it actually proves the
 * pieces cooperate — e.g. that DriverDocumentService's `recordNewVersion`
 * writes rows VerificationSubmissionService's `readyDocumentsByFamily`
 * later reads correctly.
 *
 * Deliberately faked (each already has its own dedicated unit-test
 * coverage, and re-verifying it here would only add flakiness):
 * object storage (in-memory Map, no real network), the document-processing
 * pipeline (always returns READY_FOR_REVIEW — magic-bytes/malware/image
 * checks are covered by document-processing-pipeline.service.spec.ts and
 * magic-bytes-file-type-detector.spec.ts), the upload rate limiter (no
 * Redis here), and duplicate detection (always NO_MATCH — covered by
 * driver-duplicate-detection.service.spec.ts). DriverDataCryptoService and
 * MetricsService are the real, dependency-free implementations.
 */

const REQUIRED_DRIVER_TYPES = [
  'PASSPORT_MAIN_PAGE',
  'DRIVER_LICENSE_FRONT',
  'DRIVER_LICENSE_BACK',
  'PROFILE_PHOTO',
  'SELFIE_WITH_DOCUMENT',
];
const REQUIRED_VEHICLE_TYPES = [
  'VEHICLE_REGISTRATION_FRONT',
  'INSURANCE_POLICY',
  'VEHICLE_PHOTO_FRONT',
  'VEHICLE_PHOTO_BACK',
];
const REQUIRED_CONSENTS = [
  'PERSONAL_DATA_PROCESSING',
  'DOCUMENT_PROCESSING',
  'TERMS_OF_SERVICE',
  'DRIVER_PARTNER_AGREEMENT',
];

const driver: AuthenticatedUser = {
  id: randomUUID(),
  phone: '+79990000099',
  role: 'DRIVER',
  sessionId: randomUUID(),
};
const admin: AuthenticatedUser = {
  id: randomUUID(),
  phone: '+79990000098',
  role: 'ADMIN',
  sessionId: randomUUID(),
};

type Row = Record<string, unknown>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'in' in (value as object)) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    if (value && typeof value === 'object' && 'not' in (value as object)) {
      return row[key] !== (value as { not: unknown }).not;
    }
    return row[key] === value;
  });
}

class InMemoryPrisma {
  users = new Map<string, Row>();
  driverProfiles = new Map<string, Row>();
  vehicles = new Map<string, Row>();
  driverDocuments = new Map<string, Row>();
  vehicleDocuments = new Map<string, Row>();
  documentVersions = new Map<string, Row>();
  verificationCases = new Map<string, Row>();
  driverConsents: Row[] = [];
  adminAuditLogs: Row[] = [];

  constructor(users: AuthenticatedUser[]) {
    for (const user of users) {
      this.users.set(user.id, {
        id: user.id,
        phone: user.phone,
        role: user.role,
      });
    }
  }

  user = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.users.get(where.id) ?? null,
  };

  driverProfile = {
    findUnique: async ({ where }: { where: { userId: string } }) =>
      this.driverProfiles.get(where.userId) ?? null,
    update: async ({
      where,
      data,
    }: {
      where: { userId: string };
      data: Row;
    }) => {
      const row = this.driverProfiles.get(where.userId);
      if (!row) throw new Error('driverProfile not found in fake');
      Object.assign(row, data);
      return row;
    },
    create: async ({ data }: { data: Row }) => {
      const row = { version: 0, ...data };
      this.driverProfiles.set(data.userId as string, row);
      return row;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const row of this.driverProfiles.values()) {
        if (matches(row, where)) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };

  vehicle = {
    findMany: async ({ where }: { where: Row }) =>
      [...this.vehicles.values()].filter((v) => matches(v, where)),
    findUnique: async ({ where }: { where: Row }) => {
      if ('id' in where) return this.vehicles.get(where.id as string) ?? null;
      const key = Object.keys(where)[0] as string;
      return (
        [...this.vehicles.values()].find((v) => v[key] === where[key]) ?? null
      );
    },
    count: async ({ where }: { where: Row }) =>
      [...this.vehicles.values()].filter((v) => matches(v, where)).length,
    create: async ({ data }: { data: Row }) => {
      const id = randomUUID();
      const row = {
        id,
        status: 'INACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 0,
        ...data,
      };
      this.vehicles.set(id, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = this.vehicles.get(where.id);
      if (!row) throw new Error('vehicle not found in fake');
      const { version, ...rest } = data as {
        version?: { increment: number };
      } & Row;
      Object.assign(row, rest);
      if (version)
        row.version = ((row.version as number) ?? 0) + version.increment;
      return row;
    },
  };

  driverDocument = {
    findFirst: async ({ where }: { where: Row }) =>
      [...this.driverDocuments.values()].find((d) => matches(d, where)) ?? null,
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.driverDocuments.get(where.id) ?? null,
    findMany: async ({ where }: { where: Row }) =>
      [...this.driverDocuments.values()].filter((d) => matches(d, where)),
    create: async ({ data }: { data: Row }) => {
      const id = randomUUID();
      const row = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
      this.driverDocuments.set(id, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = this.driverDocuments.get(where.id);
      if (!row) throw new Error('driverDocument not found in fake');
      const { version, ...rest } = data as {
        version?: { increment: number };
      } & Row;
      Object.assign(row, rest);
      if (version)
        row.version = ((row.version as number) ?? 0) + version.increment;
      return row;
    },
  };

  vehicleDocument = {
    findFirst: async ({ where }: { where: Row }) =>
      [...this.vehicleDocuments.values()].find((d) => matches(d, where)) ??
      null,
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.vehicleDocuments.get(where.id);
      if (!row) return null;
      const vehicle = this.vehicles.get(row.vehicleId as string);
      return { ...row, vehicle: { driverId: vehicle?.driverId } };
    },
    findMany: async ({ where }: { where: Row }) =>
      [...this.vehicleDocuments.values()].filter((d) => matches(d, where)),
    create: async ({ data }: { data: Row }) => {
      const id = randomUUID();
      const row = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
      this.vehicleDocuments.set(id, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = this.vehicleDocuments.get(where.id);
      if (!row) throw new Error('vehicleDocument not found in fake');
      const { version, ...rest } = data as {
        version?: { increment: number };
      } & Row;
      Object.assign(row, rest);
      if (version)
        row.version = ((row.version as number) ?? 0) + version.increment;
      return row;
    },
  };

  documentVersion = {
    count: async ({ where }: { where: Row }) =>
      [...this.documentVersions.values()].filter((v) => matches(v, where))
        .length,
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: Row;
      orderBy?: { versionNumber: 'asc' | 'desc' };
    }) => {
      let found = [...this.documentVersions.values()].filter((v) =>
        matches(v, where),
      );
      if (orderBy?.versionNumber === 'desc') {
        found = found.sort(
          (a, b) => (b.versionNumber as number) - (a.versionNumber as number),
        );
      }
      return found[0] ?? null;
    },
    findMany: async ({ where }: { where: Row }) => {
      const found = [...this.documentVersions.values()].filter((v) =>
        matches(v, where),
      );
      return found.map((version) => ({
        ...version,
        driverDocument: version.driverDocumentId
          ? (this.driverDocuments.get(version.driverDocumentId as string) ??
            null)
          : null,
        vehicleDocument: version.vehicleDocumentId
          ? (this.vehicleDocuments.get(version.vehicleDocumentId as string) ??
            null)
          : null,
      }));
    },
    create: async ({ data }: { data: Row }) => {
      const id = randomUUID();
      const row = { id, supersededAt: null, ...data };
      this.documentVersions.set(id, row);
      return row;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const row of this.documentVersions.values()) {
        if (matches(row, where)) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = this.documentVersions.get(where.id);
      if (!row) throw new Error('documentVersion not found in fake');
      Object.assign(row, data);
      return row;
    },
  };

  verificationCase = {
    findFirst: async ({ where }: { where: Row }) =>
      [...this.verificationCases.values()].find((c) => matches(c, where)) ??
      null,
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.verificationCases.get(where.id) ?? null,
    count: async ({ where }: { where: Row }) =>
      [...this.verificationCases.values()].filter((c) => matches(c, where))
        .length,
    create: async ({ data }: { data: Row }) => {
      const id = randomUUID();
      const row = {
        id,
        assignedAdminId: null,
        createdAt: new Date(),
        ...data,
      };
      this.verificationCases.set(id, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = this.verificationCases.get(where.id);
      if (!row) throw new Error('verificationCase not found in fake');
      Object.assign(row, data);
      return row;
    },
  };

  driverConsent = {
    create: async ({ data }: { data: Row }) => {
      const row = {
        id: randomUUID(),
        acceptedAt: new Date(),
        revokedAt: null,
        ...data,
      };
      this.driverConsents.push(row);
      return row;
    },
    findMany: async ({ where }: { where: Row }) =>
      this.driverConsents.filter((c) => matches(c, where)),
  };

  adminAuditLog = {
    create: async ({ data }: { data: Row }) => {
      this.adminAuditLogs.push(data);
      return data;
    },
  };

  async $transaction<T>(arg: ((tx: this) => Promise<T>) | Promise<T>[]) {
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg(this);
  }
}

class InMemoryObjectStorage implements Partial<ObjectStorageProvider> {
  objects = new Map<string, { bytes: Buffer; mimeType: string }>();

  async createDocumentUploadUrl(objectKey: string, mimeType: string) {
    this.objects.set(objectKey, {
      bytes: Buffer.from('placeholder'),
      mimeType,
    });
    return { url: `https://storage.local/${objectKey}`, expiresInSeconds: 300 };
  }

  async confirmDocumentUpload(objectKey: string) {
    const object = this.objects.get(objectKey);
    if (!object) return null;
    return {
      sizeBytes: object.bytes.length,
      mimeType: object.mimeType,
      lastModified: new Date(),
    };
  }

  async createSecureDownloadUrl(objectKey: string) {
    return { url: `https://storage.local/${objectKey}`, expiresInSeconds: 60 };
  }
}

/** Picks the acting user by URL — every admin route lives under /admin/, so this needs no extra header plumbing in the requests below. */
function roleRoutingGuard(
  driverUser: AuthenticatedUser,
  adminUser: AuthenticatedUser,
) {
  return {
    canActivate: (context: {
      switchToHttp: () => {
        getRequest: () => {
          user?: AuthenticatedUser;
          originalUrl?: string;
          url?: string;
        };
      };
    }) => {
      const httpRequest = context.switchToHttp().getRequest();
      const url = httpRequest.originalUrl ?? httpRequest.url ?? '';
      httpRequest.user = url.includes('/admin/') ? adminUser : driverUser;
      return true;
    },
  };
}

describe('Driver verification: full journey (Task 29)', () => {
  let app: INestApplication;
  let prisma: InMemoryPrisma;
  let documentVersions: DocumentVersionService;
  let notifyCalls: unknown[];
  const config = new ConfigService({
    driverVerification: {
      minimumAge: 18,
      maxActiveVehicles: 3,
      requiredDriverDocumentTypes: REQUIRED_DRIVER_TYPES,
      requiredVehicleDocumentTypes: REQUIRED_VEHICLE_TYPES,
      dataEncryptionKey: Buffer.alloc(32, 9).toString('base64'),
      dataHashSecret: 'test-hash-secret-that-is-at-least-32-characters',
    },
    documents: {
      imageMaxBytes: 10 * 1024 * 1024,
      pdfMaxBytes: 15 * 1024 * 1024,
      pendingRetentionHours: 24,
    },
    auth: { otpHashSecret: 'test-otp-hash-secret-32-characters!' },
  });

  beforeAll(async () => {
    prisma = new InMemoryPrisma([driver, admin]);
    const storage =
      new InMemoryObjectStorage() as unknown as ObjectStorageProvider;
    const crypto = new DriverDataCryptoService(config);
    documentVersions = new DocumentVersionService(prisma as never);
    const rateLimit = { checkRequestUploadUrl: async () => undefined } as never;
    const pipeline = {
      process: async () => ({
        outcome: 'READY_FOR_REVIEW',
        quarantineObjectKey: 'quarantine/x',
        previewObjectKey: 'quarantine/x-preview',
      }),
    } as never;
    const metrics = new MetricsService();
    const duplicateDetection = {
      checkForDuplicates: async () => ({
        result: 'NO_MATCH',
        matches: [],
        checkedAt: new Date().toISOString(),
      }),
    } as unknown as DriverDuplicateDetectionService;
    notifyCalls = [];
    const notifications = {
      createDraft: (input: unknown) => input,
    } as unknown as NotificationService;
    const notificationOutbox = {
      enqueue: async (_client: unknown, draft: unknown) => {
        notifyCalls.push(draft);
      },
    } as unknown as NotificationOutboxService;

    const profiles = new DriverProfileService(config, prisma as never);
    const vehicles = new VehicleService(config, prisma as never, crypto);
    const consents = new DriverConsentService(config, prisma as never);
    const driverDocuments = new DriverDocumentService(
      config,
      prisma as never,
      storage,
      pipeline,
      metrics,
      rateLimit,
      documentVersions,
    );
    const vehicleDocuments = new VehicleDocumentService(
      config,
      prisma as never,
      storage,
      pipeline,
      metrics,
      rateLimit,
      documentVersions,
    );
    const submissions = new VerificationSubmissionService(
      config,
      prisma as never,
      consents,
      duplicateDetection,
      metrics,
    );
    const verificationAdmin = new VerificationAdminService(
      config,
      prisma as never,
      documentVersions,
      metrics,
      notifications,
      notificationOutbox,
      storage,
    );

    const module = await Test.createTestingModule({
      controllers: [
        DriverProfileController,
        VehicleController,
        DriverDocumentController,
        VehicleDocumentController,
        DriverConsentController,
        VerificationSubmissionController,
        VerificationAdminController,
      ],
      providers: [
        { provide: DriverProfileService, useValue: profiles },
        { provide: VehicleService, useValue: vehicles },
        { provide: DriverDocumentService, useValue: driverDocuments },
        { provide: VehicleDocumentService, useValue: vehicleDocuments },
        { provide: DriverConsentService, useValue: consents },
        { provide: VerificationSubmissionService, useValue: submissions },
        { provide: VerificationAdminService, useValue: verificationAdmin },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue(roleRoutingGuard(driver, admin))
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

  const http = () => request(app.getHttpServer());
  const asDriver = http;
  const asAdmin = http;

  let vehicleId: string;
  let caseId: string;
  const driverDocumentIds: Record<string, string> = {};
  const vehicleDocumentIds: Record<string, string> = {};

  async function uploadAndConfirmDriverDocument(type: string) {
    const created = await asDriver()
      .post('/api/v1/drivers/me/documents/upload-url')
      .send({
        documentType: type,
        fileName: `${type}.jpg`,
        mimeType: 'image/jpeg',
        fileSize: 1_000,
      })
      .expect(201);
    const documentId = created.body.documentId as string;
    driverDocumentIds[type] = documentId;

    await asDriver()
      .post(`/api/v1/drivers/me/documents/${documentId}/confirm`)
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe(DocumentStatus.READY_FOR_REVIEW);
      });
  }

  async function uploadAndConfirmVehicleDocument(type: string) {
    const created = await asDriver()
      .post(`/api/v1/drivers/me/vehicles/${vehicleId}/documents/upload-url`)
      .send({
        documentType: type,
        fileName: `${type}.jpg`,
        mimeType: 'image/jpeg',
        fileSize: 1_000,
      })
      .expect(201);
    const documentId = created.body.documentId as string;
    vehicleDocumentIds[type] = documentId;

    await asDriver()
      .post(
        `/api/v1/drivers/me/vehicles/${vehicleId}/documents/${documentId}/confirm`,
      )
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe(DocumentStatus.READY_FOR_REVIEW);
      });
  }

  it('1. fills in the driver profile', async () => {
    await asDriver()
      .put('/api/v1/drivers/me/profile')
      .send({
        firstName: 'Иван',
        lastName: 'Иванов',
        birthDate: '1990-05-20',
        cityId: 'msk',
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.verificationStatus).toBe(
          DriverVerificationStatus.PROFILE_INCOMPLETE,
        );
      });
  });

  it('2. adds a vehicle', async () => {
    const created = await asDriver()
      .post('/api/v1/drivers/me/vehicles')
      .send({
        brand: 'Toyota',
        model: 'Camry',
        color: 'Black',
        productionYear: 2020,
        registrationNumber: 'A123BC77',
        vin: '1HGCM82633A123456',
        category: 'ECONOMY',
        seats: 4,
      })
      .expect(201);
    vehicleId = created.body.id as string;
    // Allow-list masking (Task 29 section 22) — the raw plate never leaves the wire.
    expect(created.body.registrationNumberMasked).toBe('••BC77');
    expect(created.body.registrationNumber).toBeUndefined();
  });

  it('3. uploads and confirms every required driver document', async () => {
    for (const type of REQUIRED_DRIVER_TYPES) {
      await uploadAndConfirmDriverDocument(type);
    }
  });

  it('4. uploads and confirms every required vehicle document', async () => {
    for (const type of REQUIRED_VEHICLE_TYPES) {
      await uploadAndConfirmVehicleDocument(type);
    }
  });

  it('5. gives every required consent', async () => {
    for (const consentType of REQUIRED_CONSENTS) {
      await asDriver()
        .post('/api/v1/drivers/me/consents')
        .send({ consentType, documentVersion: 'v1' })
        .expect(201);
    }
  });

  it('6. submits for verification, opening a QUEUED case', async () => {
    const result = await asDriver()
      .post('/api/v1/drivers/me/verification/submit')
      .expect(201);
    caseId = result.body.caseId as string;
    expect(result.body.status).toBe('QUEUED');

    const profile = prisma.driverProfiles.get(driver.id);
    expect(profile?.verificationStatus).toBe(
      DriverVerificationStatus.DOCUMENTS_SUBMITTED,
    );
  });

  it('7. a second submission is refused while the case is open', async () => {
    await asDriver()
      .post('/api/v1/drivers/me/verification/submit')
      .expect(409)
      .expect((res) => {
        expect(res.body.blockingReasons).toContain('CASE_ALREADY_OPEN');
      });
  });

  it('8. admin assigns the case to themself and starts review', async () => {
    await asAdmin()
      .post(`/api/v1/admin/verification/cases/${caseId}/assign`)
      .send({})
      .expect(201);
    await asAdmin()
      .post(`/api/v1/admin/verification/cases/${caseId}/start-review`)
      .expect(201);

    expect(prisma.verificationCases.get(caseId)?.status).toBe('IN_REVIEW');
  });

  it('9. admin approves every driver document', async () => {
    for (const type of REQUIRED_DRIVER_TYPES) {
      await asAdmin()
        .post(
          `/api/v1/admin/verification/cases/${caseId}/documents/${driverDocumentIds[type]}/approve`,
        )
        .expect(201);
    }
    for (const type of REQUIRED_DRIVER_TYPES) {
      expect(prisma.driverDocuments.get(driverDocumentIds[type])?.status).toBe(
        DocumentStatus.APPROVED,
      );
    }
  });

  it('10. admin approves every vehicle document, then the vehicle', async () => {
    for (const type of REQUIRED_VEHICLE_TYPES) {
      await asAdmin()
        .post(
          `/api/v1/admin/verification/cases/${caseId}/vehicles/${vehicleId}/documents/${vehicleDocumentIds[type]}/approve`,
        )
        .expect(201);
    }
    await asAdmin()
      .post(
        `/api/v1/admin/verification/cases/${caseId}/vehicles/${vehicleId}/approve`,
      )
      .expect(201);

    expect(prisma.vehicles.get(vehicleId)?.verificationStatus).toBe(
      VehicleVerificationStatus.APPROVED,
    );
  });

  it('11. admin approves the driver, completing the journey', async () => {
    await asAdmin()
      .post(`/api/v1/admin/verification/cases/${caseId}/approve-driver`)
      .expect(201);

    expect(prisma.driverProfiles.get(driver.id)?.verificationStatus).toBe(
      DriverVerificationStatus.APPROVED,
    );
    expect(prisma.verificationCases.get(caseId)?.status).toBe('APPROVED');
    expect(notifyCalls).toHaveLength(1);
  });
});

describe('Driver verification: rejection + replacement scenario (Task 29)', () => {
  let app: INestApplication;
  let prisma: InMemoryPrisma;
  const config = new ConfigService({
    driverVerification: {
      minimumAge: 18,
      maxActiveVehicles: 3,
      requiredDriverDocumentTypes: ['PASSPORT_MAIN_PAGE'],
      requiredVehicleDocumentTypes: ['VEHICLE_REGISTRATION_FRONT'],
      dataEncryptionKey: Buffer.alloc(32, 3).toString('base64'),
      dataHashSecret: 'another-test-hash-secret-32-characters!',
    },
    documents: {
      imageMaxBytes: 10 * 1024 * 1024,
      pdfMaxBytes: 15 * 1024 * 1024,
      pendingRetentionHours: 24,
    },
    auth: { otpHashSecret: 'test-otp-hash-secret-32-characters!' },
  });
  const rejectionDriver: AuthenticatedUser = {
    id: randomUUID(),
    phone: '+79990000097',
    role: 'DRIVER',
    sessionId: randomUUID(),
  };
  const rejectionAdmin: AuthenticatedUser = {
    id: randomUUID(),
    phone: '+79990000096',
    role: 'ADMIN',
    sessionId: randomUUID(),
  };

  let vehicleId: string;
  let caseId: string;
  let documentId: string;

  beforeAll(async () => {
    prisma = new InMemoryPrisma([rejectionDriver, rejectionAdmin]);
    const storage =
      new InMemoryObjectStorage() as unknown as ObjectStorageProvider;
    const crypto = new DriverDataCryptoService(config);
    const documentVersions = new DocumentVersionService(prisma as never);
    const rateLimit = { checkRequestUploadUrl: async () => undefined } as never;
    const pipeline = {
      process: async () => ({
        outcome: 'READY_FOR_REVIEW',
        quarantineObjectKey: 'quarantine/x',
        previewObjectKey: 'quarantine/x-preview',
      }),
    } as never;
    const metrics = new MetricsService();
    const duplicateDetection = {
      checkForDuplicates: async () => ({
        result: 'NO_MATCH',
        matches: [],
        checkedAt: new Date().toISOString(),
      }),
    } as unknown as DriverDuplicateDetectionService;
    const notifications = {
      createDraft: (input: unknown) => input,
    } as unknown as NotificationService;
    const notificationOutbox = {
      enqueue: async () => undefined,
    } as unknown as NotificationOutboxService;

    const profiles = new DriverProfileService(config, prisma as never);
    const vehicles = new VehicleService(config, prisma as never, crypto);
    const consents = new DriverConsentService(config, prisma as never);
    const driverDocuments = new DriverDocumentService(
      config,
      prisma as never,
      storage,
      pipeline,
      metrics,
      rateLimit,
      documentVersions,
    );
    const vehicleDocuments = new VehicleDocumentService(
      config,
      prisma as never,
      storage,
      pipeline,
      metrics,
      rateLimit,
      documentVersions,
    );
    const submissions = new VerificationSubmissionService(
      config,
      prisma as never,
      consents,
      duplicateDetection,
      metrics,
    );
    const verificationAdmin = new VerificationAdminService(
      config,
      prisma as never,
      documentVersions,
      metrics,
      notifications,
      notificationOutbox,
      storage,
    );

    const module = await Test.createTestingModule({
      controllers: [
        DriverProfileController,
        VehicleController,
        DriverDocumentController,
        VehicleDocumentController,
        DriverConsentController,
        VerificationSubmissionController,
        VerificationAdminController,
      ],
      providers: [
        { provide: DriverProfileService, useValue: profiles },
        { provide: VehicleService, useValue: vehicles },
        { provide: DriverDocumentService, useValue: driverDocuments },
        { provide: VehicleDocumentService, useValue: vehicleDocuments },
        { provide: DriverConsentService, useValue: consents },
        { provide: VerificationSubmissionService, useValue: submissions },
        { provide: VerificationAdminService, useValue: verificationAdmin },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue(roleRoutingGuard(rejectionDriver, rejectionAdmin))
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

    // Fast-track profile/vehicle/documents/consent/submit so the test can
    // focus on the reject -> replace -> resubmit -> approve path.
    await request(app.getHttpServer())
      .put('/api/v1/drivers/me/profile')
      .send({
        firstName: 'Пётр',
        lastName: 'Петров',
        birthDate: '1985-01-01',
        cityId: 'msk',
      })
      .expect(200);
    const vehicleResponse = await request(app.getHttpServer())
      .post('/api/v1/drivers/me/vehicles')
      .send({
        brand: 'Kia',
        model: 'Rio',
        color: 'White',
        productionYear: 2019,
        registrationNumber: 'B456CD77',
        category: 'ECONOMY',
        seats: 4,
      })
      .expect(201);
    vehicleId = vehicleResponse.body.id;

    const docResponse = await request(app.getHttpServer())
      .post('/api/v1/drivers/me/documents/upload-url')
      .send({
        documentType: 'PASSPORT_MAIN_PAGE',
        fileName: 'passport.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1_000,
      })
      .expect(201);
    documentId = docResponse.body.documentId;
    await request(app.getHttpServer())
      .post(`/api/v1/drivers/me/documents/${documentId}/confirm`)
      .expect(201);

    const vehicleDocResponse = await request(app.getHttpServer())
      .post(`/api/v1/drivers/me/vehicles/${vehicleId}/documents/upload-url`)
      .send({
        documentType: 'VEHICLE_REGISTRATION_FRONT',
        fileName: 'sts.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1_000,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/api/v1/drivers/me/vehicles/${vehicleId}/documents/${vehicleDocResponse.body.documentId}/confirm`,
      )
      .expect(201);

    for (const consentType of REQUIRED_CONSENTS) {
      await request(app.getHttpServer())
        .post('/api/v1/drivers/me/consents')
        .send({ consentType, documentVersion: 'v1' })
        .expect(201);
    }

    const submitResponse = await request(app.getHttpServer())
      .post('/api/v1/drivers/me/verification/submit')
      .expect(201);
    caseId = submitResponse.body.caseId;

    prisma.verificationCases.get(caseId)!.assignedAdminId = rejectionAdmin.id;
    prisma.verificationCases.get(caseId)!.status = 'IN_REVIEW';
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects the driver document with a named reason', async () => {
    prisma.driverDocuments.get(documentId)!.status =
      DocumentStatus.READY_FOR_REVIEW;

    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/verification/cases/${caseId}/documents/${documentId}/reject`,
      )
      .send({ reasonCode: 'DOCUMENT_UNREADABLE', comment: 'Плохое качество' })
      .expect(201);

    expect(prisma.driverDocuments.get(documentId)?.status).toBe(
      DocumentStatus.REJECTED,
    );
  });

  it('the driver re-uploads a replacement, which is flagged and starts a new pending version', async () => {
    const replacement = await request(app.getHttpServer())
      .post('/api/v1/drivers/me/documents/upload-url')
      .send({
        documentType: 'PASSPORT_MAIN_PAGE',
        fileName: 'passport-v2.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1_000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(
        `/api/v1/drivers/me/documents/${replacement.body.documentId}/confirm`,
      )
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe(DocumentStatus.READY_FOR_REVIEW);
      });

    const versions = [...prisma.documentVersions.values()].filter(
      (v) =>
        v.documentFamily === `driver:${rejectionDriver.id}:PASSPORT_MAIN_PAGE`,
    );
    expect(versions).toHaveLength(2);
    expect(versions[1]?.status).toBe(DocumentVersionStatus.PENDING_REVIEW);
    expect(versions[1]?.versionNumber).toBe(2);

    documentId = replacement.body.documentId;
  });

  it('admin approves the replacement, activating it and superseding the rejected original', async () => {
    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/verification/cases/${caseId}/documents/${documentId}/approve`,
      )
      .expect(201);

    const activeVersion = [...prisma.documentVersions.values()].find(
      (v) =>
        v.documentFamily ===
          `driver:${rejectionDriver.id}:PASSPORT_MAIN_PAGE` &&
        v.status === DocumentVersionStatus.ACTIVE,
    );
    expect(activeVersion?.driverDocumentId).toBe(documentId);
    expect(prisma.driverDocuments.get(documentId)?.status).toBe(
      DocumentStatus.APPROVED,
    );
  });

  it('admin then approves the vehicle document, the vehicle, and the driver', async () => {
    const vehicleDocs = [...prisma.vehicleDocuments.values()].filter(
      (d) => d.vehicleId === vehicleId,
    );
    for (const doc of vehicleDocs) {
      await request(app.getHttpServer())
        .post(
          `/api/v1/admin/verification/cases/${caseId}/vehicles/${vehicleId}/documents/${doc.id}/approve`,
        )
        .expect(201);
    }
    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/verification/cases/${caseId}/vehicles/${vehicleId}/approve`,
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/verification/cases/${caseId}/approve-driver`)
      .expect(201);

    expect(
      prisma.driverProfiles.get(rejectionDriver.id)?.verificationStatus,
    ).toBe(DriverVerificationStatus.APPROVED);
  });
});
