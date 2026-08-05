import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../src/auth/guards/roles.guard.js';
import { TripController } from '../src/trips/trip.controller.js';
import { TripService } from '../src/trips/trip.service.js';

const passenger: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000001',
  phone: '+79990000000',
  role: 'PASSENGER',
  sessionId: '00000000-0000-4000-8000-000000000002',
};

describe('Passenger trip endpoints', () => {
  let app: INestApplication;
  const tripService = {
    cancel: async () => ({
      id: 'trip-1',
      status: 'CANCELLED_BY_PASSENGER',
      version: 2,
    }),
    create: async () => ({ id: 'trip-1', status: 'DRAFT', version: 0 }),
    getById: async () => ({
      id: 'trip-1',
      status: 'DRAFT',
      version: 0,
      pickup: {
        latitude: 55.7558,
        longitude: 37.6173,
        formattedAddress: 'A',
        providerPlaceId: null,
      },
      destination: {
        latitude: 55.7517,
        longitude: 37.6178,
        formattedAddress: 'B',
        providerPlaceId: null,
      },
      waypoints: [],
    }),
    startSearch: async () => ({
      id: 'trip-1',
      status: 'SEARCHING',
      version: 1,
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TripController],
      providers: [{ provide: TripService, useValue: tripService }],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => { user?: AuthenticatedUser };
          };
        }) => {
          context.switchToHttp().getRequest().user = passenger;
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

  it('creates a trip draft and exposes the passenger trip operations', async () => {
    const body = validCreateBody();

    await request(app.getHttpServer())
      .post('/api/v1/trips')
      .set('Idempotency-Key', 'trip-create-1')
      .send(body)
      .expect(201)
      .expect({ id: 'trip-1', status: 'DRAFT', version: 0 });

    const readResponse = await request(app.getHttpServer())
      .get('/api/v1/trips/trip-1')
      .expect(200);

    expect(readResponse.body).toMatchObject({ id: 'trip-1', status: 'DRAFT' });

    await request(app.getHttpServer())
      .post('/api/v1/trips/trip-1/start-search')
      .expect(200)
      .expect({ id: 'trip-1', status: 'SEARCHING', version: 1 });

    await request(app.getHttpServer())
      .post('/api/v1/trips/trip-1/cancel')
      .expect(200)
      .expect({
        id: 'trip-1',
        status: 'CANCELLED_BY_PASSENGER',
        version: 2,
      });
  });

  it('rejects invalid coordinates before calling the trip service', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/trips')
      .set('Idempotency-Key', 'trip-create-2')
      .send({
        ...validCreateBody(),
        pickup: { ...validCreateBody().pickup, latitude: 91 },
      })
      .expect(400);
  });
});

function validCreateBody() {
  return {
    pickup: {
      latitude: 55.7558,
      longitude: 37.6173,
      formattedAddress: 'Красная площадь, 1',
      providerPlaceId: 'dev:pickup',
    },
    destination: {
      latitude: 55.7517,
      longitude: 37.6178,
      formattedAddress: 'Тверская улица, 1',
      providerPlaceId: 'dev:destination',
    },
    passengerPriceKopecks: 10_000,
    waypoints: [],
    options: { childSeat: false, pet: false, luggage: true },
  };
}
