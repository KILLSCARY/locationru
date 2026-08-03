import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { io, type Socket } from 'socket.io-client';

import { DriverDataCryptoService } from '../src/drivers/infrastructure/driver-data-crypto.service.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  STAGING_SUPER_ADMIN_PHONE,
  STAGING_TEST_DRIVER_PHONE,
  STAGING_TEST_PASSENGER_PHONE,
  STAGING_TEST_VEHICLE_REGISTRATION_NUMBER,
} from '../src/staging-tools/staging-test-accounts.js';
import { stagingOtpLookupKey } from '../src/auth/providers/staging-sms.provider.js';

/**
 * End-to-end smoke test against a running staging deployment: the full
 * trip lifecycle over real HTTP, a realtime WebSocket delivery, an
 * object-storage upload round-trip, and an audit-log check. Exits
 * non-zero on any failure — this is what `pnpm staging:deploy` gates a
 * deploy on before calling it done.
 *
 * Runs inside the docker network (see scripts/staging/smoke.sh, which
 * launches this via the `migrate` service's image) so it can reach
 * Postgres/Redis/MinIO directly and the api/admin-web services by their
 * internal DNS names, without needing the public domain's DNS/TLS to be
 * live yet.
 *
 * Known gap this script works around, not specific to staging: nothing
 * in the codebase currently calls DispatchService.findCandidates outside
 * its own unit test — there is no wired trigger (cron, event hook, or
 * endpoint) for the dispatch-matching engine yet. The existing dev
 * simulator (scripts/simulate-trip.ts) works around this the same way:
 * by writing the DispatchAttempt/DispatchAttemptLog rows directly via
 * Prisma. See docs/staging/smoke-tests.md.
 */

const API_URL = process.env.STAGING_SMOKE_API_URL ?? 'http://api:3000/api/v1';
const WS_URL = process.env.STAGING_SMOKE_WS_URL ?? 'http://api:3000';
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

const PICKUP = { latitude: 59.9326, longitude: 30.3506 };
const DESTINATION = { latitude: 59.8003, longitude: 30.2625 };

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...data }));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Smoke test assertion failed: ${message}`);
}

async function api<T>(
  token: string | undefined,
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  return parsed as T;
}

async function checkHealth(): Promise<void> {
  for (const path of ['/health', '/health/live', '/health/ready']) {
    const result = await api<{ status: string }>(undefined, 'GET', path);
    assert(result.status === 'ok', `${path} reported status=${result.status}`);
  }
  log('health.ok');
}

/**
 * The SUPER_ADMIN's very first login is a genuine bootstrap problem: the
 * documented OTP-viewer endpoint (GET /admin/staging/otp/:phone) itself
 * requires a SUPER_ADMIN access token, and there is no other SUPER_ADMIN
 * yet to view it for them. Resolved here by reading the OTP directly out
 * of Redis — the same level of trust as running `docker compose exec`
 * against this deployment, which whoever runs this smoke test already
 * has. Every other account's OTP is fetched through the real endpoint
 * below, which this also exercises and proves works.
 */
async function bootstrapSuperAdminToken(redis: Redis): Promise<string> {
  await api(undefined, 'POST', '/auth/request-code', {
    phone: STAGING_SUPER_ADMIN_PHONE,
  });
  const code = await redis.get(stagingOtpLookupKey(STAGING_SUPER_ADMIN_PHONE));
  assert(code, 'SUPER_ADMIN OTP was not found in Redis');
  const tokens = await api<{ accessToken: string }>(
    undefined,
    'POST',
    '/auth/verify-code',
    {
      phone: STAGING_SUPER_ADMIN_PHONE,
      code,
      deviceId: 'smoke-test-super-admin',
      platform: 'WEB',
    },
  );
  return tokens.accessToken;
}

async function loginViaOtpViewer(
  superAdminToken: string,
  phone: string,
  deviceId: string,
  platform: 'ANDROID' | 'WEB',
): Promise<string> {
  await api(undefined, 'POST', '/auth/request-code', { phone });
  const { code } = await api<{ code: string | null }>(
    superAdminToken,
    'GET',
    `/admin/staging/otp/${encodeURIComponent(phone)}`,
  );
  assert(code, `No OTP found for ${phone} via the admin viewer endpoint`);
  const tokens = await api<{ accessToken: string }>(
    undefined,
    'POST',
    '/auth/verify-code',
    { phone, code, deviceId, platform },
  );
  return tokens.accessToken;
}

async function seedDispatchMatch(
  prisma: PrismaClient,
  tripId: string,
  driverId: string,
): Promise<void> {
  const attempt = await prisma.dispatchAttempt.create({
    data: { tripId, radiusMeters: 2_000, candidateCount: 1 },
  });
  await prisma.dispatchAttemptLog.create({
    data: {
      attemptId: attempt.id,
      driverId,
      rank: 1,
      distanceMeters: 500,
      estimatedPickupSeconds: 60,
    },
  });
}

async function checkObjectStorage(token: string): Promise<void> {
  const uploadRequest = await api<{
    documentId: string;
    uploadUrl: string;
  }>(token, 'POST', '/documents/upload-url', {
    mimeType: 'image/jpeg',
    sizeBytes: 4,
  });

  const content = Buffer.from('test');
  const uploadResponse = await fetch(uploadRequest.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: content,
  });
  assert(
    uploadResponse.ok,
    `Presigned upload PUT failed: ${uploadResponse.status}`,
  );

  await api(
    token,
    'POST',
    `/documents/${uploadRequest.documentId}/confirm-upload`,
  );

  const downloadRequest = await api<{ downloadUrl: string }>(
    token,
    'POST',
    `/documents/${uploadRequest.documentId}/download-url`,
  );
  const downloadResponse = await fetch(downloadRequest.downloadUrl);
  assert(downloadResponse.ok, 'Presigned download GET failed');
  const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
  assert(
    downloaded.equals(content),
    'Downloaded object content did not match what was uploaded',
  );

  log('object_storage.ok', { documentId: uploadRequest.documentId });
}

function connectRealtimeClient(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${WS_URL}/realtime`, {
      auth: { token },
      transports: ['websocket'],
    });
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Timed out waiting for realtime.ready'));
    }, 10_000);
    socket.once('realtime.ready', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('connect_error', (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForEvent(
  socket: Socket,
  eventName: string,
  timeoutMs = 10_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for realtime event "${eventName}"`));
    }, timeoutMs);
    socket.once(eventName, (payload: unknown) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

async function checkAuditLog(superAdminToken: string): Promise<void> {
  const audit = await api<{ items: Array<{ action: string }> }>(
    superAdminToken,
    'GET',
    '/admin/audit?page=1&pageSize=20',
  );
  assert(audit.items.length > 0, 'Expected at least one audit log entry');
  assert(
    audit.items.some((entry) => entry.action === 'staging.otp.viewed'),
    "Expected a staging.otp.viewed audit entry from this run's OTP lookups",
  );
  log('audit_log.ok', { entries: audit.items.length });
}

async function main(): Promise<void> {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!REDIS_URL) throw new Error('REDIS_URL is required');

  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const redis = new Redis(REDIS_URL);

  try {
    await checkHealth();

    const superAdminToken = await bootstrapSuperAdminToken(redis);
    log('auth.super_admin_ok');

    const passengerToken = await loginViaOtpViewer(
      superAdminToken,
      STAGING_TEST_PASSENGER_PHONE,
      'smoke-test-passenger',
      'WEB',
    );
    const driverToken = await loginViaOtpViewer(
      superAdminToken,
      STAGING_TEST_DRIVER_PHONE,
      'smoke-test-driver',
      'ANDROID',
    );
    log('auth.test_accounts_ok');

    const driverProfile = await prisma.user.findUniqueOrThrow({
      where: { phone: STAGING_TEST_DRIVER_PHONE },
    });
    const driverDataCrypto = new DriverDataCryptoService(
      new ConfigService({
        driverVerification: {
          dataEncryptionKey: process.env.DRIVER_DATA_ENCRYPTION_KEY,
          dataHashSecret: process.env.DRIVER_DATA_HASH_SECRET,
        },
      }),
    );
    const vehicle = await prisma.vehicle.findUniqueOrThrow({
      where: {
        registrationNumberHash: driverDataCrypto.hash(
          STAGING_TEST_VEHICLE_REGISTRATION_NUMBER,
        ),
      },
    });

    const passengerSocket = await connectRealtimeClient(passengerToken);
    log('realtime.connected');

    const trip = await api<{ id: string }>(
      passengerToken,
      'POST',
      '/trips',
      {
        pickup: PICKUP,
        destination: DESTINATION,
        pickupAddress: 'Smoke test pickup',
        destinationAddress: 'Smoke test destination',
        passengerPriceKopecks: 60_000,
      },
      randomUUID(),
    );

    await new Promise<void>((resolve, reject) => {
      passengerSocket.emit(
        'room.join',
        { tripId: trip.id },
        (response: unknown) => {
          if (response && typeof response === 'object' && 'room' in response) {
            resolve();
          } else {
            reject(
              new Error(
                `Unexpected room.join response: ${JSON.stringify(response)}`,
              ),
            );
          }
        },
      );
    });

    const searchingEvent = waitForEvent(passengerSocket, 'trip.searching');
    await api(passengerToken, 'POST', `/trips/${trip.id}/start-search`);
    await searchingEvent;
    log('realtime.trip_searching_delivered');

    passengerSocket.disconnect();

    await seedDispatchMatch(prisma, trip.id, driverProfile.id);

    await api(driverToken, 'POST', '/drivers/me/offline');
    await api(driverToken, 'POST', '/drivers/me/online');
    await api(driverToken, 'POST', '/drivers/me/location', {
      recordedAt: new Date().toISOString(),
      latitude: PICKUP.latitude,
      longitude: PICKUP.longitude,
      accuracyMeters: 8,
      provider: 'smoke-test',
      confidence: 'HIGH',
      suspectedSpoofing: false,
    });

    const bid = await api<{ id: string }>(
      driverToken,
      'POST',
      `/trips/${trip.id}/bids`,
      { vehicleId: vehicle.id },
    );
    await api(
      passengerToken,
      'POST',
      `/trips/${trip.id}/bids/${bid.id}/select`,
    );
    await api(
      driverToken,
      'POST',
      `/driver/trips/${trip.id}/confirm-departure`,
      undefined,
      randomUUID(),
    );
    await api(
      passengerToken,
      'POST',
      `/trips/${trip.id}/payment/authorize`,
      undefined,
      randomUUID(),
    );
    await api(
      driverToken,
      'POST',
      `/driver/trips/${trip.id}/en-route`,
      undefined,
      randomUUID(),
    );
    await api(
      driverToken,
      'POST',
      `/driver/trips/${trip.id}/arrived`,
      undefined,
      randomUUID(),
    );

    const boardingCode = await api<{ code: string }>(
      passengerToken,
      'GET',
      `/trips/${trip.id}/boarding-code`,
    );
    await api(
      driverToken,
      'POST',
      `/driver/trips/${trip.id}/start`,
      { code: boardingCode.code },
      randomUUID(),
    );
    await api(
      driverToken,
      'POST',
      `/driver/trips/${trip.id}/complete`,
      undefined,
      randomUUID(),
    );

    const finalTrip = await api<{ status: string }>(
      passengerToken,
      'GET',
      `/trips/${trip.id}`,
    );
    assert(
      finalTrip.status === 'SETTLED',
      `Expected trip to be SETTLED, got ${finalTrip.status}`,
    );
    log('trip_lifecycle.ok', { tripId: trip.id });

    await checkObjectStorage(passengerToken);
    await checkAuditLog(superAdminToken);

    await api(superAdminToken, 'POST', '/admin/staging/reset-test-data', {
      confirm: true,
    });
    log('cleanup.ok');

    log('smoke_test.passed');
  } finally {
    redis.disconnect();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
