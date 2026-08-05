import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';

import { DriverDataCryptoService } from '../src/drivers/infrastructure/driver-data-crypto.service.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const driverDataCrypto = new DriverDataCryptoService(
  new ConfigService({
    driverVerification: {
      dataEncryptionKey: process.env.DRIVER_DATA_ENCRYPTION_KEY,
      dataHashSecret: process.env.DRIVER_DATA_HASH_SECRET,
    },
  }),
);

/**
 * Drives one full trip end-to-end against a running dev API, without a real
 * phone: creates a passenger and a driver, mints access tokens directly
 * (bypassing OTP — this is a development-only shortcut, see mintAccessToken),
 * then walks the driver's GPS position along real route geometry through
 * every trip status, exercising the real HTTP endpoints, the location
 * pipeline, and the realtime outbox exactly as a live client would.
 *
 * One shortcut beyond the OTP bypass: the dispatch match (which normally runs
 * async) is written directly, since re-deriving the candidate-search engine
 * here would test the simulator's plumbing, not the trip lifecycle.
 *
 * Run with the API and its Postgres/Redis already up (`pnpm infra:up` and the
 * API dev server). Usage: `pnpm dev:simulate-trip` from the repo root.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const DATABASE_URL = process.env.DATABASE_URL;
const AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET;
const ACCESS_TOKEN_TTL_SECONDS = Number(
  process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS ?? 900,
);

// Coordinates DevelopmentMapsProvider recognizes, so geocoding/routing/pricing
// all resolve deterministically without a real maps API key.
const PICKUP = {
  latitude: 59.9326,
  longitude: 30.3506,
  address: 'Санкт-Петербург, Невский проспект, 45',
};
const DESTINATION = {
  latitude: 59.8003,
  longitude: 30.2625,
  address: 'Санкт-Петербург, аэропорт Пулково',
};
const DRIVER_START = { latitude: 59.9295, longitude: 30.3621 }; // Московский вокзал.

// A slower playback speed (e.g. a realistic ~40 km/h) would be physically
// consistent, but replaying a long route (Nevsky -> Pulkovo, ~17 km) at that
// pace takes real minutes to run. Instead we play back at a synthetic speed
// close to (but safely under) the server's own plausible-speed ceiling, so
// each step's implied speed — distance / recordedAt delta — passes the
// server's check by construction, while requests fire close together in
// real time. The simulated clock is still kept from drifting too far past
// real time by driveAlong's catch-up sleep, bounded by the future-timestamp
// tolerance below.
const MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND = Number(
  process.env.DRIVER_LOCATIONS_MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND ?? 70,
);
const FUTURE_TOLERANCE_SECONDS = Number(
  process.env.DRIVER_LOCATIONS_FUTURE_TOLERANCE_SECONDS ?? 300,
);
const STEP_SECONDS = 5;
const DRIVE_SPEED_METERS_PER_SECOND =
  MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND * 0.8;
// Used only for the dispatch log's cosmetic ETA estimate, not for GPS
// playback — a real ~40 km/h approach speed, unrelated to the faster
// synthetic speed above.
const REALISTIC_APPROACH_SPEED_METERS_PER_SECOND = 11;
// Real-time margin kept under the server's future-timestamp tolerance, so the
// simulated clock is never right on the edge of it.
const FUTURE_DRIFT_BUDGET_MS = (FUTURE_TOLERANCE_SECONDS - 30) * 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...data }));
}

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Mints a valid access token without OTP verification — a development-only
 * shortcut. Mirrors AuthService.createAccessToken's exact claim shape
 * ({sub, sessionId, roles}) and signing (HS256, AUTH_JWT_SECRET), so the
 * token is accepted by the real, running AccessTokenGuard. The caller must
 * also create a matching, non-revoked DeviceSession row (done by
 * upsertUserAndSession below) — the guard checks both.
 */
function mintAccessToken(
  userId: string,
  sessionId: string,
  role: string,
): string {
  if (!AUTH_JWT_SECRET) {
    throw new Error(
      'AUTH_JWT_SECRET is required to mint a development access token',
    );
  }
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1_000);
  const payload = base64url(
    JSON.stringify({
      sub: userId,
      sessionId,
      roles: [role],
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_SECONDS,
    }),
  );
  const signature = createHmac('sha256', AUTH_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function api<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
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

interface GeoPoint {
  latitude: number;
  longitude: number;
}

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const earthRadius = 6_371_008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lerp(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

/** Resamples a polyline into steps of ~`stepMeters`, for smooth GPS playback. */
function resample(geometry: GeoPoint[], stepMeters: number): GeoPoint[] {
  const points: GeoPoint[] = [geometry[0]!];
  for (let i = 1; i < geometry.length; i += 1) {
    const from = geometry[i - 1]!;
    const to = geometry[i]!;
    const segmentLength = haversineMeters(from, to);
    const steps = Math.max(1, Math.round(segmentLength / stepMeters));
    for (let step = 1; step <= steps; step += 1) {
      points.push(lerp(from, to, step / steps));
    }
  }
  return points;
}

async function upsertUserAndSession(
  prisma: PrismaClient,
  input: { phone: string; role: 'PASSENGER' | 'DRIVER'; deviceId: string },
): Promise<{ userId: string; sessionId: string; token: string }> {
  const user = await prisma.user.upsert({
    where: { phone: input.phone },
    update: { role: input.role, status: 'ACTIVE' },
    create: { phone: input.phone, role: input.role, status: 'ACTIVE' },
  });

  const sessionId = randomUUID();
  const session = await prisma.deviceSession.upsert({
    where: { userId_deviceId: { userId: user.id, deviceId: input.deviceId } },
    update: {
      revokedAt: null,
      refreshTokenHash: randomBytes(16).toString('hex'),
    },
    create: {
      id: sessionId,
      userId: user.id,
      deviceId: input.deviceId,
      platform: 'ANDROID',
      refreshTokenHash: randomBytes(16).toString('hex'),
    },
  });

  return {
    userId: user.id,
    sessionId: session.id,
    token: mintAccessToken(user.id, session.id, input.role),
  };
}

async function seedDriverProfile(
  prisma: PrismaClient,
  driverId: string,
  driverPhone: string,
): Promise<string> {
  await prisma.driverProfile.upsert({
    where: { userId: driverId },
    update: { operationalStatus: 'OFFLINE', verificationStatus: 'APPROVED' },
    create: {
      userId: driverId,
      firstName: 'Симулятор',
      lastName: 'Водитель',
      phone: driverPhone,
      cityId: 'spb',
      birthDate: new Date('1990-01-01'),
      operationalStatus: 'OFFLINE',
      verificationStatus: 'APPROVED',
      approvedAt: new Date(),
    },
  });
  const registrationNumberHash = driverDataCrypto.hash('С000СИМ78');
  const vehicle = await prisma.vehicle.upsert({
    where: { registrationNumberHash },
    update: { driverId, status: 'ACTIVE', verificationStatus: 'APPROVED' },
    create: {
      driverId,
      brand: 'Kia',
      model: 'Rio',
      color: 'белый',
      registrationNumberEncrypted: driverDataCrypto.encrypt('С000СИМ78'),
      registrationNumberMasked: '••СИМ78',
      registrationNumberHash,
      productionYear: 2022,
      category: 'ECONOMY',
      seats: 4,
      status: 'ACTIVE',
      verificationStatus: 'APPROVED',
      approvedAt: new Date(),
    },
  });
  return vehicle.id;
}

/** The real dispatch match runs asynchronously; write its result directly. */
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
      distanceMeters: Math.round(haversineMeters(DRIVER_START, PICKUP)),
      estimatedPickupSeconds: Math.round(
        haversineMeters(DRIVER_START, PICKUP) /
          REALISTIC_APPROACH_SPEED_METERS_PER_SECOND,
      ),
    },
  });
}

type LocationScenario =
  | 'stable'
  | 'network_loss'
  | 'stale'
  | 'gps_jump'
  | 'recovery';

async function submitLocation(
  driverToken: string,
  point: GeoPoint,
  recordedAt: Date,
  scenario: LocationScenario,
): Promise<boolean> {
  const body = {
    recordedAt: recordedAt.toISOString(),
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyMeters: 8,
    speedMetersPerSecond: DRIVE_SPEED_METERS_PER_SECOND,
    bearingDegrees: 0,
    provider: 'simulator',
    confidence: 'HIGH',
    suspectedSpoofing: false,
  };

  if (scenario === 'network_loss') {
    // A real connection failure, not merely a skipped call, so the resilience
    // path (catch, log, keep going) is genuinely exercised.
    try {
      await fetch('http://127.0.0.1:1', { signal: AbortSignal.timeout(300) });
    } catch (error) {
      log('location.network_loss_simulated', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }

  try {
    const result = await api(driverToken, 'POST', '/drivers/me/location', body);
    log(`location.${scenario}`, { point, recordedAt: body.recordedAt, result });
    return true;
  } catch (error) {
    log(`location.${scenario}_rejected`, {
      point,
      recordedAt: body.recordedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function driveAlong(
  driverToken: string,
  from: GeoPoint,
  to: GeoPoint,
  label: string,
): Promise<GeoPoint> {
  const route = await api<{ route: { geometry: GeoPoint[] } }>(
    driverToken,
    'POST',
    '/routes/build',
    {
      origin: { latitude: from.latitude, longitude: from.longitude },
      destination: { latitude: to.latitude, longitude: to.longitude },
    },
  );
  const points = resample(
    route.route.geometry,
    DRIVE_SPEED_METERS_PER_SECOND * STEP_SECONDS,
  );
  log('drive.start', { label, points: points.length });

  let lastAccepted = points[0]!;
  // Advances by exactly STEP_SECONDS per point, so consecutive accepted
  // points always imply exactly DRIVE_SPEED_METERS_PER_SECOND — safely under
  // the server's plausible-speed ceiling, by construction — regardless of how
  // little real time the request round-trip itself takes.
  let simulatedNow = new Date();

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    simulatedNow = new Date(simulatedNow.getTime() + STEP_SECONDS * 1_000);

    // The simulated clock runs far ahead of real time (that's the point —
    // it lets a long route play back in seconds instead of real minutes).
    // Once it would drift past the server's future-timestamp tolerance,
    // pause in real time until it's back within budget.
    const driftMs = simulatedNow.getTime() - Date.now();
    if (driftMs > FUTURE_DRIFT_BUDGET_MS) {
      await sleep(driftMs - FUTURE_DRIFT_BUDGET_MS);
    }

    // Each scenario below is an *additional*, out-of-band request alongside
    // the real path point — never a replacement for it. That keeps the
    // driven path itself evenly paced (one step per loop iteration, no
    // skipped or reused points), so a rejected/stale/dropped scenario
    // submission can never throw off the implied speed of subsequent, actual
    // path progress.
    let scenario: LocationScenario = 'stable';
    if (i === Math.floor(points.length * 0.3)) {
      // A real connection failure, dropped before reaching the server —
      // simulates the phone briefly losing network.
      await submitLocation(driverToken, point, simulatedNow, 'network_loss');
    } else if (i === Math.floor(points.length * 0.5)) {
      // Older than DRIVER_LOCATIONS_STALE_AFTER_SECONDS — accepted but not
      // live, simulating a delayed request landing late.
      const staleAt = new Date(simulatedNow.getTime() - 120_000);
      await submitLocation(driverToken, point, staleAt, 'stale');
    } else if (i === Math.floor(points.length * 0.7)) {
      // ~50km away in an instant: an impossible speed, correctly rejected.
      await submitLocation(
        driverToken,
        { latitude: point.latitude + 0.45, longitude: point.longitude + 0.45 },
        simulatedNow,
        'gps_jump',
      );
      // The very next real path point, submitted normally right after the
      // rejected jump, demonstrates recovery.
      scenario = 'recovery';
    }

    const accepted = await submitLocation(
      driverToken,
      point,
      simulatedNow,
      scenario,
    );
    if (accepted) lastAccepted = point;
  }

  log('drive.end', { label });
  return lastAccepted;
}

async function main(): Promise<void> {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!AUTH_JWT_SECRET) throw new Error('AUTH_JWT_SECRET is required');

  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const passenger = await upsertUserAndSession(prisma, {
      phone: '+79995550001',
      role: 'PASSENGER',
      deviceId: 'simulator-passenger',
    });
    const driver = await upsertUserAndSession(prisma, {
      phone: '+79995550002',
      role: 'DRIVER',
      deviceId: 'simulator-driver',
    });
    const vehicleId = await seedDriverProfile(
      prisma,
      driver.userId,
      '+79995550002',
    );
    log('setup.ready', {
      passengerId: passenger.userId,
      driverId: driver.userId,
      vehicleId,
    });

    const trip = await api<{ id: string; status: string }>(
      passenger.token,
      'POST',
      '/trips',
      {
        pickup: { latitude: PICKUP.latitude, longitude: PICKUP.longitude },
        destination: {
          latitude: DESTINATION.latitude,
          longitude: DESTINATION.longitude,
        },
        pickupAddress: PICKUP.address,
        destinationAddress: DESTINATION.address,
        passengerPriceKopecks: 60_000,
      },
      randomUUID(),
    );
    log('trip.created', trip);

    await api(passenger.token, 'POST', `/trips/${trip.id}/start-search`);
    await seedDispatchMatch(prisma, trip.id, driver.userId);

    // Clears any cached last-known position left over from a previous run of
    // this script against the same driver — goOffline drops it unconditionally,
    // so a stale, distant leftover position never corrupts this run's
    // plausible-speed checks on its first few location updates.
    await api(driver.token, 'POST', '/drivers/me/offline');
    await api(driver.token, 'POST', '/drivers/me/online');
    await submitLocation(driver.token, DRIVER_START, new Date(), 'stable');

    const bid = await api<{ id: string }>(
      driver.token,
      'POST',
      `/trips/${trip.id}/bids`,
      { vehicleId },
    );
    log('bid.created', bid);

    await api(
      passenger.token,
      'POST',
      `/trips/${trip.id}/bids/${bid.id}/select`,
    );
    log('trip.driver_selected', {});

    await api(
      driver.token,
      'POST',
      `/driver/trips/${trip.id}/confirm-departure`,
      undefined,
      randomUUID(),
    );
    await api(
      passenger.token,
      'POST',
      `/trips/${trip.id}/payment/authorize`,
      undefined,
      randomUUID(),
    );
    await api(
      driver.token,
      'POST',
      `/driver/trips/${trip.id}/en-route`,
      undefined,
      randomUUID(),
    );
    log('trip.en_route', {});

    const arrivedAt = await driveAlong(
      driver.token,
      DRIVER_START,
      PICKUP,
      'to-pickup',
    );
    await submitLocation(driver.token, PICKUP, new Date(), 'stable');
    await api(
      driver.token,
      'POST',
      `/driver/trips/${trip.id}/arrived`,
      undefined,
      randomUUID(),
    );
    log('trip.arrived', { arrivedAt });

    const boardingCode = await api<{ code: string }>(
      passenger.token,
      'GET',
      `/trips/${trip.id}/boarding-code`,
    );
    await api(
      driver.token,
      'POST',
      `/driver/trips/${trip.id}/start`,
      { code: boardingCode.code },
      randomUUID(),
    );
    log('trip.started', {});

    await driveAlong(driver.token, PICKUP, DESTINATION, 'to-destination');
    await submitLocation(driver.token, DESTINATION, new Date(), 'stable');
    await api(
      driver.token,
      'POST',
      `/driver/trips/${trip.id}/complete`,
      undefined,
      randomUUID(),
    );
    log('trip.completed', { tripId: trip.id });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
