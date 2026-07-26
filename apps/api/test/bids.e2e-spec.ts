import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../src/auth/guards/roles.guard.js';
import { BidsController } from '../src/bids/bids.controller.js';
import { BidsService } from '../src/bids/bids.service.js';

const user: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000010',
  phone: '+79990000010',
  role: 'DRIVER',
  sessionId: '00000000-0000-4000-8000-000000000011',
};

describe('Bid endpoints', () => {
  let app: INestApplication;
  const bidsService = {
    create: async () => ({ id: 'bid-1', status: 'ACTIVE' }),
    getAvailableTrips: async () => [{ tripId: 'trip-1' }],
    listForPassenger: async () => [{ id: 'bid-1', status: 'ACTIVE' }],
    select: async () => ({
      tripId: 'trip-1',
      bidId: 'bid-1',
      status: 'DRIVER_SELECTED',
    }),
    withdraw: async () => ({ id: 'bid-1', status: 'WITHDRAWN' }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BidsController],
      providers: [{ provide: BidsService, useValue: bidsService }],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => { user?: AuthenticatedUser };
          };
        }) => {
          context.switchToHttp().getRequest().user = user;
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

  afterAll(async () => {
    await app?.close();
  });

  it('exposes available trips and driver bid actions', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/driver/trips/available')
      .expect(200)
      .expect([{ tripId: 'trip-1' }]);
    await request(app.getHttpServer())
      .post('/api/v1/trips/trip-1/bids')
      .send({ vehicleId: '00000000-0000-4000-8000-000000000020' })
      .expect(201)
      .expect({ id: 'bid-1', status: 'ACTIVE' });
    await request(app.getHttpServer())
      .delete('/api/v1/trips/trip-1/bids/bid-1')
      .expect(200)
      .expect({ id: 'bid-1', status: 'WITHDRAWN' });
  });

  it('exposes passenger bid listing and selection routes', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/trips/trip-1/bids')
      .expect(200)
      .expect([{ id: 'bid-1', status: 'ACTIVE' }]);
    await request(app.getHttpServer())
      .post('/api/v1/trips/trip-1/bids/bid-1/select')
      .expect(200)
      .expect({ tripId: 'trip-1', bidId: 'bid-1', status: 'DRIVER_SELECTED' });
  });
});
