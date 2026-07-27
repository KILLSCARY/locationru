import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApplication } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DispatchService } from '../src/dispatch/dispatch.service.js';
import {
  TripPaymentStatus,
  TripStatus,
} from '../src/generated/prisma/client.js';
import { RedisService } from '../src/redis/redis.service.js';

interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
}

interface TripResponse {
  id: string;
  status: string;
  version: number;
}

interface BidResponse {
  id: string;
  offeredPriceKopecks: number;
  status: string;
}

interface BoardingCodeResponse {
  code: string;
  expiresAt: string;
}

describe('local development journey', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('test:journey requires NODE_ENV=development');
    }
    if (!/^\d{6}$/.test(process.env.AUTH_DEVELOPMENT_OTP_CODE ?? '')) {
      throw new Error(
        'test:journey requires a six-digit AUTH_DEVELOPMENT_OTP_CODE',
      );
    }

    app = await createApplication();
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('moves one passenger trip from DRAFT to SETTLED', async () => {
    const passengerPhone = requiredEnvironment('SEED_PASSENGER_PHONE');
    const driverPhone = requiredEnvironment('SEED_DRIVER_PHONE');
    const adminPhone = requiredEnvironment('SEED_ADMIN_PHONE');
    const otpCode = requiredEnvironment('AUTH_DEVELOPMENT_OTP_CODE');
    const registrationNumber = requiredEnvironment(
      'SEED_DRIVER_VEHICLE_REGISTRATION',
    );
    const runId = randomUUID();

    const passenger = await prisma.user.findUniqueOrThrow({
      where: { phone: passengerPhone },
    });
    const driver = await prisma.user.findUniqueOrThrow({
      where: { phone: driverPhone },
    });
    const vehicle = await prisma.vehicle.findUniqueOrThrow({
      where: { registrationNumber },
    });

    await prisma.trip.deleteMany({
      where: {
        passengerId: passenger.id,
        status: {
          notIn: [
            TripStatus.SETTLED,
            TripStatus.CANCELLED_BY_DRIVER,
            TripStatus.CANCELLED_BY_PASSENGER,
            TripStatus.CANCELLED_BY_SYSTEM,
            TripStatus.PAYMENT_FAILED,
            TripStatus.REFUNDED,
          ],
        },
      },
    });
    await clearAuthenticationState(passengerPhone, driverPhone, adminPhone);

    const passengerTokens = await authenticate(
      passengerPhone,
      otpCode,
      `journey-passenger-${runId}`,
    );
    const driverTokens = await authenticate(
      driverPhone,
      otpCode,
      `journey-driver-${runId}`,
    );
    const adminTokens = await authenticate(
      adminPhone,
      otpCode,
      `journey-admin-${runId}`,
    );

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(adminTokens.accessToken))
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ role: 'ADMIN' });
      });

    await request(app.getHttpServer())
      .post('/api/v1/drivers/me/online')
      .set(bearer(driverTokens.accessToken))
      .send({})
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          status: 'ONLINE',
          verificationStatus: 'APPROVED',
          hasApprovedVehicle: true,
        });
      });

    await request(app.getHttpServer())
      .post('/api/v1/drivers/me/location')
      .set(bearer(driverTokens.accessToken))
      .send({
        recordedAt: new Date().toISOString(),
        latitude: 55.7558,
        longitude: 37.6173,
        accuracyMeters: 8,
        speedMetersPerSecond: 0,
        bearingDegrees: 0,
        altitudeMeters: 156,
        provider: 'journey-test',
        confidence: 'HIGH',
        suspectedSpoofing: false,
        satellitesVisible: 12,
        cellCount: 4,
      })
      .expect(200)
      .expect({ accepted: 1, deduplicated: 0, stale: 0 });

    const trip = (
      await request(app.getHttpServer())
        .post('/api/v1/trips')
        .set(bearer(passengerTokens.accessToken))
        .set('Idempotency-Key', `journey-create-${runId}`)
        .send({
          pickup: { latitude: 55.7558, longitude: 37.6173 },
          destination: { latitude: 55.75, longitude: 37.65 },
          pickupAddress: 'Development pickup',
          destinationAddress: 'Development destination',
          passengerPriceKopecks: 130_000,
          stops: [],
          options: { childSeat: false, pet: false, luggage: true },
          comment: 'Automated local development journey',
        })
        .expect(201)
        .expect((response) => {
          expect(response.body).toMatchObject({ status: TripStatus.DRAFT });
        })
    ).body as TripResponse;

    await request(app.getHttpServer())
      .post(`/api/v1/trips/${trip.id}/start-search`)
      .set(bearer(passengerTokens.accessToken))
      .send({})
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ status: TripStatus.SEARCHING });
      });

    const dispatch = await app.get(DispatchService).findCandidates({
      tripId: trip.id,
    });
    expect(
      dispatch.candidates.map((candidate) => candidate.driverId),
    ).toContain(driver.id);

    await request(app.getHttpServer())
      .get('/api/v1/driver/trips/available')
      .set(bearer(driverTokens.accessToken))
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ tripId: trip.id }),
          ]),
        );
      });

    const bid = (
      await request(app.getHttpServer())
        .post(`/api/v1/trips/${trip.id}/bids`)
        .set(bearer(driverTokens.accessToken))
        .send({ vehicleId: vehicle.id, offeredPriceKopecks: 145_000 })
        .expect(201)
        .expect((response) => {
          expect(response.body).toMatchObject({
            offeredPriceKopecks: 145_000,
            status: 'ACTIVE',
          });
        })
    ).body as BidResponse;

    await request(app.getHttpServer())
      .get(`/api/v1/trips/${trip.id}/bids`)
      .set(bearer(passengerTokens.accessToken))
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: bid.id })]),
        );
      });

    await request(app.getHttpServer())
      .post(`/api/v1/trips/${trip.id}/bids/${bid.id}/select`)
      .set(bearer(passengerTokens.accessToken))
      .send({})
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          status: TripStatus.DRIVER_SELECTED,
          finalPriceKopecks: 145_000,
          commissionKopecks: 11_600,
          driverPayoutKopecks: 133_400,
        });
      });

    await lifecyclePost(
      `/driver/trips/${trip.id}/confirm-departure`,
      driverTokens.accessToken,
      `journey-departure-${runId}`,
      TripStatus.PAYMENT_PENDING,
    );
    await lifecyclePost(
      `/trips/${trip.id}/payment/authorize`,
      passengerTokens.accessToken,
      `journey-payment-${runId}`,
      TripStatus.PAYMENT_RESERVED,
    );
    await lifecyclePost(
      `/driver/trips/${trip.id}/en-route`,
      driverTokens.accessToken,
      `journey-en-route-${runId}`,
      TripStatus.DRIVER_EN_ROUTE,
    );
    await lifecyclePost(
      `/driver/trips/${trip.id}/arrived`,
      driverTokens.accessToken,
      `journey-arrived-${runId}`,
      TripStatus.DRIVER_ARRIVED,
    );

    const boardingCode = (
      await request(app.getHttpServer())
        .get(`/api/v1/trips/${trip.id}/boarding-code`)
        .set(bearer(passengerTokens.accessToken))
        .expect(200)
        .expect((response) => {
          expect(response.body.code).toMatch(/^\d{4}$/);
        })
    ).body as BoardingCodeResponse;

    await request(app.getHttpServer())
      .post(`/api/v1/driver/trips/${trip.id}/start`)
      .set(bearer(driverTokens.accessToken))
      .set('Idempotency-Key', `journey-start-${runId}`)
      .send({ code: boardingCode.code })
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({ status: TripStatus.IN_PROGRESS });
      });

    await lifecyclePost(
      `/driver/trips/${trip.id}/complete`,
      driverTokens.accessToken,
      `journey-complete-${runId}`,
      TripStatus.SETTLED,
      200,
    );

    const settled = await prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
      include: {
        payment: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    expect(settled).toMatchObject({
      status: TripStatus.SETTLED,
      finalPriceKopecks: 145_000,
      commissionBasisPoints: 800,
      commissionKopecks: 11_600,
      driverPayoutKopecks: 133_400,
      selectedDriverId: driver.id,
      selectedVehicleId: vehicle.id,
      payment: {
        status: TripPaymentStatus.SETTLED,
        reservedAmountKopecks: 145_000,
      },
    });
    expect(settled.statusHistory.map((item) => item.newStatus)).toEqual(
      expect.arrayContaining([
        TripStatus.SEARCHING,
        TripStatus.OFFERS_RECEIVED,
        TripStatus.DRIVER_SELECTED,
        TripStatus.PAYMENT_PENDING,
        TripStatus.PAYMENT_RESERVED,
        TripStatus.DRIVER_EN_ROUTE,
        TripStatus.DRIVER_ARRIVED,
        TripStatus.IN_PROGRESS,
        TripStatus.COMPLETED,
        TripStatus.SETTLED,
      ]),
    );

    console.log(
      JSON.stringify({
        event: 'development.journey.settled',
        tripId: trip.id,
        finalPriceKopecks: settled.finalPriceKopecks,
        commissionKopecks: settled.commissionKopecks,
        driverPayoutKopecks: settled.driverPayoutKopecks,
      }),
    );
  });

  async function authenticate(
    phone: string,
    code: string,
    deviceId: string,
  ): Promise<AuthTokensResponse> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/request-code')
      .send({ phone })
      .expect(202);

    return (
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-code')
        .send({ phone, code, deviceId, platform: 'WEB' })
        .expect(200)
    ).body as AuthTokensResponse;
  }

  async function clearAuthenticationState(...phones: string[]): Promise<void> {
    await Promise.all(
      phones.flatMap((phone) => [
        redis.delete(`auth:otp:${phone}`),
        redis.delete(`auth:otp-rate:${phone}`),
      ]),
    );
  }

  async function lifecyclePost(
    path: string,
    accessToken: string,
    idempotencyKey: string,
    expectedStatus: TripStatus,
    expectedHttpStatus = 201,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set(bearer(accessToken))
      .set('Idempotency-Key', idempotencyKey)
      .send({})
      .expect(expectedHttpStatus)
      .expect((response) => {
        expect(response.body).toMatchObject({ status: expectedStatus });
      });
  }
});

function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
