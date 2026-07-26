import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../src/auth/guards/roles.guard.js';
import { TripLifecycleController } from '../src/lifecycle/trip-lifecycle.controller.js';
import { TripLifecycleService } from '../src/lifecycle/trip-lifecycle.service.js';

const passenger: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000010',
  phone: '+79990000010',
  role: 'PASSENGER',
  sessionId: '00000000-0000-4000-8000-000000000011',
};
const driver: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000020',
  phone: '+79990000020',
  role: 'DRIVER',
  sessionId: '00000000-0000-4000-8000-000000000021',
};

describe('Selected trip lifecycle', () => {
  let app: INestApplication;
  const lifecycle = {
    arrive: async () => ({
      id: 'trip-1',
      status: 'DRIVER_ARRIVED',
      version: 4,
    }),
    authorizePayment: async () => ({
      id: 'trip-1',
      status: 'PAYMENT_RESERVED',
      version: 2,
    }),
    completeTrip: async () => ({ id: 'trip-1', status: 'SETTLED', version: 7 }),
    confirmDeparture: async () => ({
      id: 'trip-1',
      status: 'PAYMENT_PENDING',
      version: 1,
    }),
    issueBoardingCode: async () => ({
      code: '1234',
      expiresAt: new Date('2026-07-27T12:00:00.000Z'),
    }),
    startEnRoute: async () => ({
      id: 'trip-1',
      status: 'DRIVER_EN_ROUTE',
      version: 3,
    }),
    startTrip: async () => ({
      id: 'trip-1',
      status: 'IN_PROGRESS',
      version: 5,
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TripLifecycleController],
      providers: [{ provide: TripLifecycleService, useValue: lifecycle }],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => { user?: AuthenticatedUser };
          };
        }) => {
          const request = context.switchToHttp().getRequest();
          request.user =
            request.headers['x-role'] === 'PASSENGER' ? passenger : driver;
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
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => app?.close());

  it('runs departure, payment, boarding and settlement flow', async () => {
    const key = { 'Idempotency-Key': 'lifecycle-test-1' };
    await request(app.getHttpServer())
      .post('/api/v1/driver/trips/trip-1/confirm-departure')
      .set(key)
      .expect(201)
      .expect({ id: 'trip-1', status: 'PAYMENT_PENDING', version: 1 });
    await request(app.getHttpServer())
      .post('/api/v1/trips/trip-1/payment/authorize')
      .set({ ...key, 'x-role': 'PASSENGER' })
      .expect(201)
      .expect({ id: 'trip-1', status: 'PAYMENT_RESERVED', version: 2 });
    await request(app.getHttpServer())
      .post('/api/v1/driver/trips/trip-1/en-route')
      .set(key)
      .expect(201)
      .expect({ id: 'trip-1', status: 'DRIVER_EN_ROUTE', version: 3 });
    await request(app.getHttpServer())
      .post('/api/v1/driver/trips/trip-1/arrived')
      .set(key)
      .expect(201)
      .expect({ id: 'trip-1', status: 'DRIVER_ARRIVED', version: 4 });
    await request(app.getHttpServer())
      .get('/api/v1/trips/trip-1/boarding-code')
      .set('x-role', 'PASSENGER')
      .expect(200)
      .expect({ code: '1234', expiresAt: '2026-07-27T12:00:00.000Z' });
    await request(app.getHttpServer())
      .post('/api/v1/driver/trips/trip-1/start')
      .set(key)
      .send({ code: '1234' })
      .expect(201)
      .expect({ id: 'trip-1', status: 'IN_PROGRESS', version: 5 });
    await request(app.getHttpServer())
      .post('/api/v1/driver/trips/trip-1/complete')
      .set(key)
      .expect(200)
      .expect({ id: 'trip-1', status: 'SETTLED', version: 7 });
  });
});
