import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../src/auth/guards/roles.guard.js';
import { DriverController } from '../src/drivers/driver.controller.js';
import { DriverService } from '../src/drivers/driver.service.js';

const driver: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000010',
  phone: '+79990000010',
  role: 'DRIVER',
  sessionId: '00000000-0000-4000-8000-000000000011',
};

describe('Driver status and location endpoints', () => {
  let app: INestApplication;
  const driverService = {
    getStatus: async () => ({
      status: 'ONLINE',
      verificationStatus: 'APPROVED',
      hasApprovedVehicle: true,
      lastLocation: null,
    }),
    goOffline: async () => ({ status: 'OFFLINE' }),
    goOnline: async () => ({ status: 'ONLINE' }),
    submitLocation: async () => ({ accepted: 1, deduplicated: 0, stale: 0 }),
    submitLocationBatch: async () => ({
      accepted: 2,
      deduplicated: 0,
      stale: 0,
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DriverController],
      providers: [{ provide: DriverService, useValue: driverService }],
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

  it('serves the driver status and accepts a valid point', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/drivers/me/status')
      .expect(200)
      .expect({
        status: 'ONLINE',
        verificationStatus: 'APPROVED',
        hasApprovedVehicle: true,
        lastLocation: null,
      });

    await request(app.getHttpServer())
      .post('/api/v1/drivers/me/location')
      .send(validLocation())
      .expect(200)
      .expect({ accepted: 1, deduplicated: 0, stale: 0 });
  });

  it('rejects an invalid location before reaching the service', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/drivers/me/location/batch')
      .send({ locations: [{ ...validLocation(), latitude: 91 }] })
      .expect(400);
  });
});

function validLocation() {
  return {
    recordedAt: new Date().toISOString(),
    latitude: 55.7558,
    longitude: 37.6173,
    accuracyMeters: 12,
    provider: 'fused',
    confidence: 'HIGH',
    suspectedSpoofing: false,
  };
}
