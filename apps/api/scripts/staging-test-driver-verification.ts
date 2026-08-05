import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import sharp from 'sharp';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { STAGING_SUPER_ADMIN_PHONE } from '../src/staging-tools/staging-test-accounts.js';
import { stagingOtpLookupKey } from '../src/auth/providers/staging-sms.provider.js';

/**
 * Driver-verification staging smoke test (Task 29): the full workflow from
 * the task's own diagram — registration -> profile -> vehicle -> documents
 * -> admin review -> access — driven entirely through real HTTP against a
 * running staging deployment, plus a rejection/replacement round trip.
 *
 * Unlike test/driver-verification-journey.e2e-spec.ts (real services, an
 * in-memory Prisma double, no network), this exercises the actual deployed
 * pipeline end to end: real object storage (a genuine presigned-URL PUT),
 * the real magic-bytes/malware/image-dimension checks (via a real 640x640
 * JPEG synthesized with sharp), and the real Postgres.
 *
 * There is no self-service "become a driver" endpoint (a brand-new phone
 * always registers as PASSENGER — see AuthService.verifyCode) — real driver
 * accounts are provisioned out of band, the same way prisma/seed-staging.ts
 * creates the persistent STAGING_TEST_DRIVER_PHONE account directly via
 * Prisma. That persistent account is already fully APPROVED (seeded with a
 * vehicle and no documents), so it cannot exercise the fill-in-from-scratch
 * flow this script needs. Instead this script creates its own throwaway
 * driver account directly via Prisma (mirroring the seed script), drives it
 * through every HTTP step a real driver would take, and deletes the account
 * (cascading to its profile/vehicle/documents/case) when done.
 *
 * The required document type lists and minimum image dimensions are not
 * exposed by any endpoint (a documented gap — see docs/drivers/documents.md)
 * so they are hardcoded here to match .env.staging.example's defaults.
 *
 * Usage: pnpm staging:test:driver-verification
 * (Run inside the staging docker network — needs DATABASE_URL and REDIS_URL,
 * same as prisma/seed-staging.ts and staging-test-push.ts respectively.)
 */

const API_URL = process.env.STAGING_SMOKE_API_URL ?? 'http://api:3000/api/v1';
const REDIS_URL = process.env.REDIS_URL;
const DATABASE_URL = process.env.DATABASE_URL;

const REQUIRED_DRIVER_DOCUMENT_TYPES = [
  'PASSPORT_MAIN_PAGE',
  'DRIVER_LICENSE_FRONT',
  'DRIVER_LICENSE_BACK',
  'PROFILE_PHOTO',
  'SELFIE_WITH_DOCUMENT',
];
const REQUIRED_VEHICLE_DOCUMENT_TYPES = [
  'VEHICLE_REGISTRATION_FRONT',
  'INSURANCE_POLICY',
  'VEHICLE_PHOTO_FRONT',
  'VEHICLE_PHOTO_BACK',
];
const REQUIRED_CONSENT_TYPES = [
  'PERSONAL_DATA_PROCESSING',
  'DOCUMENT_PROCESSING',
  'TERMS_OF_SERVICE',
  'DRIVER_PARTNER_AGREEMENT',
];

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...data }));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(
      `Driver-verification smoke test assertion failed: ${message}`,
    );
  }
}

async function api<T>(
  token: string | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const data = (text ? JSON.parse(text) : undefined) as T;
  return { status: response.status, data };
}

async function bootstrapSuperAdminToken(redis: Redis): Promise<string> {
  await api(undefined, 'POST', '/auth/request-code', {
    phone: STAGING_SUPER_ADMIN_PHONE,
    deviceId: 'driver-verification-smoke-super-admin',
  });
  const code = await redis.get(stagingOtpLookupKey(STAGING_SUPER_ADMIN_PHONE));
  assert(code, 'SUPER_ADMIN OTP was not found in Redis');
  const { data } = await api<{ accessToken: string }>(
    undefined,
    'POST',
    '/auth/verify-code',
    {
      phone: STAGING_SUPER_ADMIN_PHONE,
      code,
      deviceId: 'driver-verification-smoke-super-admin',
      platform: 'WEB',
    },
  );
  return data.accessToken;
}

async function loginViaOtpViewer(
  superAdminToken: string,
  phone: string,
  deviceId: string,
): Promise<{ accessToken: string; userId: string }> {
  await api(undefined, 'POST', '/auth/request-code', { phone, deviceId });
  const { data: otp } = await api<{ code: string | null }>(
    superAdminToken,
    'GET',
    `/admin/staging/otp/${encodeURIComponent(phone)}`,
  );
  assert(otp.code, `No OTP found for ${phone} via the admin viewer endpoint`);
  const { data: tokens } = await api<{ accessToken: string }>(
    undefined,
    'POST',
    '/auth/verify-code',
    { phone, code: otp.code, deviceId, platform: 'ANDROID' },
  );
  const { data: me } = await api<{ id: string }>(
    tokens.accessToken,
    'GET',
    '/auth/me',
  );
  return { accessToken: tokens.accessToken, userId: me.id };
}

interface UploadUrlResponse {
  documentId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}

async function uploadDriverDocument(
  driverToken: string,
  documentType: string,
  imageBytes: Buffer,
): Promise<string> {
  const { data: uploadUrl } = await api<UploadUrlResponse>(
    driverToken,
    'POST',
    '/drivers/me/documents/upload-url',
    {
      documentType,
      fileName: `${documentType.toLowerCase()}.jpg`,
      mimeType: 'image/jpeg',
      fileSize: imageBytes.length,
    },
  );
  const putResponse = await fetch(uploadUrl.uploadUrl, {
    method: 'PUT',
    headers: uploadUrl.requiredHeaders,
    body: imageBytes as unknown as BodyInit,
  });
  assert(
    putResponse.ok,
    `Presigned PUT for driver document ${documentType} failed: ${putResponse.status}`,
  );
  const { data: confirmed } = await api<{ status: string }>(
    driverToken,
    'POST',
    `/drivers/me/documents/${uploadUrl.documentId}/confirm`,
  );
  assert(
    confirmed.status === 'READY_FOR_REVIEW',
    `Driver document ${documentType} did not reach READY_FOR_REVIEW (got ${confirmed.status})`,
  );
  return uploadUrl.documentId;
}

async function uploadVehicleDocument(
  driverToken: string,
  vehicleId: string,
  documentType: string,
  imageBytes: Buffer,
): Promise<string> {
  const { data: uploadUrl } = await api<UploadUrlResponse>(
    driverToken,
    'POST',
    `/drivers/me/vehicles/${vehicleId}/documents/upload-url`,
    {
      documentType,
      fileName: `${documentType.toLowerCase()}.jpg`,
      mimeType: 'image/jpeg',
      fileSize: imageBytes.length,
    },
  );
  const putResponse = await fetch(uploadUrl.uploadUrl, {
    method: 'PUT',
    headers: uploadUrl.requiredHeaders,
    body: imageBytes as unknown as BodyInit,
  });
  assert(
    putResponse.ok,
    `Presigned PUT for vehicle document ${documentType} failed: ${putResponse.status}`,
  );
  const { data: confirmed } = await api<{ status: string }>(
    driverToken,
    'POST',
    `/drivers/me/vehicles/${vehicleId}/documents/${uploadUrl.documentId}/confirm`,
  );
  assert(
    confirmed.status === 'READY_FOR_REVIEW',
    `Vehicle document ${documentType} did not reach READY_FOR_REVIEW (got ${confirmed.status})`,
  );
  return uploadUrl.documentId;
}

async function main(): Promise<void> {
  if (!REDIS_URL) throw new Error('REDIS_URL is required');
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
  const redis = new Redis(REDIS_URL);
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const throwawayPhone = `+7999${(Date.now() % 10_000_000).toString().padStart(7, '0')}`;
  let throwawayUserId: string | null = null;

  try {
    // 1. Health check.
    const health = await api<{ status: string }>(undefined, 'GET', '/health');
    assert(health.data.status === 'ok', 'API health check failed');
    log('1.health.ok');

    // 2. SUPER_ADMIN bootstrap — also used as the reviewing admin below.
    const superAdminToken = await bootstrapSuperAdminToken(redis);
    log('2.auth.super_admin_ok');

    // 3. Provision a throwaway DRIVER account directly via Prisma — there is
    // no self-service signup-as-driver endpoint (see file header comment).
    const throwawayUser = await prisma.user.create({
      data: { phone: throwawayPhone, role: 'DRIVER', status: 'ACTIVE' },
    });
    throwawayUserId = throwawayUser.id;
    log('3.driver_account.provisioned', { phone: throwawayPhone });

    const driver = await loginViaOtpViewer(
      superAdminToken,
      throwawayPhone,
      'driver-verification-smoke-driver',
    );
    log('4.auth.driver_login_ok', { driverId: driver.userId });

    // 5. Profile is empty until filled in.
    const { data: emptyProfile } = await api<{ profileComplete: boolean }>(
      driver.accessToken,
      'GET',
      '/drivers/me/profile',
    );
    assert(
      emptyProfile.profileComplete === false,
      'A brand-new driver should not already have a complete profile',
    );
    await api(driver.accessToken, 'PUT', '/drivers/me/profile', {
      firstName: 'Смоук',
      lastName: 'Тестовый',
      birthDate: '1990-05-20',
      cityId: 'MOW',
    });
    log('5.profile.filled_in_ok');

    // 6. Vehicle.
    const { data: vehicle } = await api<{
      id: string;
      registrationNumberMasked: string;
    }>(driver.accessToken, 'POST', '/drivers/me/vehicles', {
      brand: 'Lada',
      model: 'Vesta',
      color: 'white',
      productionYear: 2022,
      registrationNumber: `X${Date.now() % 1_000_000}77`,
      category: 'ECONOMY',
      seats: 4,
    });
    assert(vehicle.id, 'Vehicle creation did not return an id');
    log('6.vehicle.created_ok', {
      vehicleId: vehicle.id,
      masked: vehicle.registrationNumberMasked,
    });

    // A real 640x640 JPEG — large enough to clear DOCUMENT_IMAGE_MIN_*_PX
    // and small enough to stay well under DOCUMENT_IMAGE_MAX_BYTES.
    const imageBytes = await sharp({
      create: {
        width: 640,
        height: 640,
        channels: 3,
        background: { r: 120, g: 120, b: 120 },
      },
    })
      .jpeg()
      .toBuffer();

    // 7. Every required driver document, uploaded through a real presigned
    // URL and confirmed through the real processing pipeline.
    const driverDocumentIds: Record<string, string> = {};
    for (const type of REQUIRED_DRIVER_DOCUMENT_TYPES) {
      driverDocumentIds[type] = await uploadDriverDocument(
        driver.accessToken,
        type,
        imageBytes,
      );
    }
    log('7.driver_documents.uploaded_ok', {
      count: REQUIRED_DRIVER_DOCUMENT_TYPES.length,
    });

    // 8. Every required vehicle document.
    const vehicleDocumentIds: Record<string, string> = {};
    for (const type of REQUIRED_VEHICLE_DOCUMENT_TYPES) {
      vehicleDocumentIds[type] = await uploadVehicleDocument(
        driver.accessToken,
        vehicle.id,
        type,
        imageBytes,
      );
    }
    log('8.vehicle_documents.uploaded_ok', {
      count: REQUIRED_VEHICLE_DOCUMENT_TYPES.length,
    });

    // 9. Every required consent.
    for (const consentType of REQUIRED_CONSENT_TYPES) {
      await api(driver.accessToken, 'POST', '/drivers/me/consents', {
        consentType,
        documentVersion: 'v1',
      });
    }
    log('9.consents.recorded_ok');

    // 10. Submit for verification.
    const { data: submitted } = await api<{ caseId: string; status: string }>(
      driver.accessToken,
      'POST',
      '/drivers/me/verification/submit',
    );
    assert(
      submitted.status === 'QUEUED',
      `Expected QUEUED after submit, got ${submitted.status}`,
    );
    const caseId = submitted.caseId;
    log('10.submission.ok', { caseId });

    // 11. Admin assigns to self and starts review.
    await api(
      superAdminToken,
      'POST',
      `/admin/verification/cases/${caseId}/assign`,
      {},
    );
    await api(
      superAdminToken,
      'POST',
      `/admin/verification/cases/${caseId}/start-review`,
    );
    log('11.admin.assigned_and_in_review_ok');

    // 12. Reject one driver document, then have the driver replace it — the
    // rejection/replacement round trip this script exists to smoke-test.
    const rejectedType = REQUIRED_DRIVER_DOCUMENT_TYPES[0]!;
    const { data: rejected } = await api<{ status: string }>(
      superAdminToken,
      'POST',
      `/admin/verification/cases/${caseId}/documents/${driverDocumentIds[rejectedType]}/reject`,
      {
        reasonCode: 'DOCUMENT_UNREADABLE',
        comment: 'Смоук-тест: замена документа',
      },
    );
    assert(
      rejected.status === 'REJECTED',
      `Expected REJECTED, got ${rejected.status}`,
    );
    log('12.admin.rejected_one_document_ok', { type: rejectedType });

    driverDocumentIds[rejectedType] = await uploadDriverDocument(
      driver.accessToken,
      rejectedType,
      imageBytes,
    );
    log('13.driver.replaced_rejected_document_ok', { type: rejectedType });

    // 14. Admin approves every driver document (the replacement included),
    // every vehicle document, the vehicle, then the driver.
    for (const type of REQUIRED_DRIVER_DOCUMENT_TYPES) {
      await api(
        superAdminToken,
        'POST',
        `/admin/verification/cases/${caseId}/documents/${driverDocumentIds[type]}/approve`,
      );
    }
    for (const type of REQUIRED_VEHICLE_DOCUMENT_TYPES) {
      await api(
        superAdminToken,
        'POST',
        `/admin/verification/cases/${caseId}/vehicles/${vehicle.id}/documents/${vehicleDocumentIds[type]}/approve`,
      );
    }
    await api(
      superAdminToken,
      'POST',
      `/admin/verification/cases/${caseId}/vehicles/${vehicle.id}/approve`,
    );
    await api(
      superAdminToken,
      'POST',
      `/admin/verification/cases/${caseId}/approve-driver`,
    );
    log('14.admin.approved_everything_ok');

    // 15. The driver is now APPROVED.
    const { data: finalProfile } = await api<{ verificationStatus: string }>(
      driver.accessToken,
      'GET',
      '/drivers/me/profile',
    );
    assert(
      finalProfile.verificationStatus === 'APPROVED',
      `Expected APPROVED, got ${finalProfile.verificationStatus}`,
    );
    log('15.driver.approved_ok');

    log('driver_verification_smoke_test.passed');
  } finally {
    if (throwawayUserId) {
      // Cascades to DriverProfile/Vehicle/documents/VerificationCase/consents
      // (see schema.prisma) — leaves no residue for repeated runs.
      await prisma.user
        .delete({ where: { id: throwawayUserId } })
        .catch((error: unknown) => {
          console.error(
            'Cleanup of the throwaway driver account failed:',
            error,
          );
        });
    }
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
