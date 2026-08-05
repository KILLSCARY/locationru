import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import type { AuthenticatedUser } from '../src/auth/auth.types.js';
import { AccessTokenGuard } from '../src/auth/guards/access-token.guard.js';
import { MapsController } from '../src/maps/maps.controller.js';
import { MapsRateLimitService } from '../src/maps/maps-rate-limit.service.js';
import { MapsService } from '../src/maps/maps.service.js';
import { PricingController } from '../src/maps/pricing.controller.js';
import { PricingEstimateService } from '../src/maps/pricing/pricing-estimate.service.js';
import { RoutesController } from '../src/maps/routes.controller.js';

const passenger: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000001',
  phone: '+79990000000',
  role: 'PASSENGER',
  sessionId: '00000000-0000-4000-8000-000000000002',
};

describe('Maps, routes and pricing endpoints', () => {
  let app: INestApplication;

  const mapsService = {
    providerName: 'development',
    searchAddress: async () => [
      {
        id: 'dev-spb-nevsky-45',
        title: 'Невский проспект, 45',
        subtitle: 'Санкт-Петербург',
        fullAddress: 'Санкт-Петербург, Невский проспект, 45',
        location: { latitude: 59.9326, longitude: 30.3506 },
        provider: 'development',
        providerPlaceId: 'dev-spb-nevsky-45',
      },
    ],
    geocode: async (address: string) =>
      address.includes('nowhere')
        ? null
        : {
            formattedAddress: 'Санкт-Петербург, Невский проспект, 45',
            location: { latitude: 59.9326, longitude: 30.3506 },
            components: {
              country: 'Россия',
              region: 'Санкт-Петербург',
              city: 'Санкт-Петербург',
              street: 'Невский проспект',
              house: '45',
              postalCode: '191025',
            },
            provider: 'development',
            providerPlaceId: 'dev-spb-nevsky-45',
          },
    reverseGeocode: async () => ({
      formattedAddress: 'Санкт-Петербург, аэропорт Пулково',
      location: { latitude: 59.8003, longitude: 30.2625 },
      components: {
        country: 'Россия',
        region: 'Санкт-Петербург',
        city: 'Санкт-Петербург',
        street: 'Пулковское шоссе',
        house: '41',
        postalCode: '196140',
      },
      provider: 'development',
      providerPlaceId: 'dev-spb-pulkovo',
    }),
    estimateRoute: async () => ({
      distanceMeters: 12_000,
      durationSeconds: 900,
      geometry: [
        { latitude: 59.9326, longitude: 30.3506 },
        { latitude: 59.8003, longitude: 30.2625 },
      ],
      encodedPolyline: null,
      bounds: {
        minLatitude: 59.8003,
        minLongitude: 30.2625,
        maxLatitude: 59.9326,
        maxLongitude: 30.3506,
      },
      provider: 'development',
      providerRouteId: null,
      warnings: [],
      snappedWaypoints: [],
    }),
    buildRoute: async () => ({
      distanceMeters: 12_000,
      durationSeconds: 900,
      geometry: [
        { latitude: 59.9326, longitude: 30.3506 },
        { latitude: 59.8003, longitude: 30.2625 },
      ],
      encodedPolyline: null,
      bounds: {
        minLatitude: 59.8003,
        minLongitude: 30.2625,
        maxLatitude: 59.9326,
        maxLongitude: 30.3506,
      },
      provider: 'development',
      providerRouteId: null,
      warnings: [],
      snappedWaypoints: [],
    }),
  };

  const rateLimitService = { enforce: async () => undefined };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MapsController, RoutesController, PricingController],
      providers: [
        { provide: MapsService, useValue: mapsService },
        { provide: MapsRateLimitService, useValue: rateLimitService },
        PricingEstimateService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            maps: {
              suggestionsRateLimitPerMinute: 60,
              routesRateLimitPerMinute: 30,
            },
            pricing: {
              baseFareKopecks: 15_000,
              perKilometerKopecks: 3_000,
              perMinuteKopecks: 800,
              minimumFareKopecks: 15_000,
              lowerMultiplierBasisPoints: 9_000,
              upperMultiplierBasisPoints: 13_000,
            },
          }),
        },
      ],
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

  it('returns address suggestions for a valid query', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/maps/address-suggestions')
      .query({ query: 'Невский' })
      .expect(200);

    expect(response.body.suggestions).toHaveLength(1);
    expect(response.body.provider).toBe('development');
  });

  it('rejects an address query shorter than 3 characters', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/maps/address-suggestions')
      .query({ query: 'ab' })
      .expect(400);
  });

  it('rejects a suggestions limit above 10', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/maps/address-suggestions')
      .query({ query: 'Невский', limit: 11 })
      .expect(400);
  });

  it('geocodes a resolvable address', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/maps/geocode')
      .send({ address: 'Невский проспект 45' })
      .expect(200);

    expect(response.body.address.formattedAddress).toContain('Невский');
  });

  it('returns 404 for an address that cannot be resolved', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/maps/geocode')
      .send({ address: 'nowhere at all' })
      .expect(404);
  });

  it('reverse geocodes coordinates', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/maps/reverse-geocode')
      .send({ latitude: 59.8003, longitude: 30.2625 })
      .expect(200);

    expect(response.body.address.formattedAddress).toContain('Пулково');
  });

  it('rejects an invalid latitude on reverse geocode', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/maps/reverse-geocode')
      .send({ latitude: 200, longitude: 30.2625 })
      .expect(400);
  });

  it('estimates a route', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/routes/estimate')
      .send({
        origin: { latitude: 59.9326, longitude: 30.3506 },
        destination: { latitude: 59.8003, longitude: 30.2625 },
      })
      .expect(200);

    expect(response.body).toMatchObject({
      distanceMeters: 12_000,
      durationSeconds: 900,
      provider: 'development',
    });
  });

  it('builds a route with geometry', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/routes/build')
      .send({
        origin: { latitude: 59.9326, longitude: 30.3506 },
        destination: { latitude: 59.8003, longitude: 30.2625 },
      })
      .expect(200);

    expect(response.body.route.geometry.length).toBeGreaterThanOrEqual(2);
  });

  it('recommends a fare from distance and duration', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/pricing/estimate')
      .send({ distanceMeters: 12_000, durationSeconds: 900 })
      .expect(200);

    expect(response.body.recommendedPriceKopecks).toBeGreaterThan(0);
    expect(response.body.minimumSuggestedPriceKopecks).toBeLessThanOrEqual(
      response.body.recommendedPriceKopecks,
    );
    expect(response.body.maximumSuggestedPriceKopecks).toBeGreaterThanOrEqual(
      response.body.recommendedPriceKopecks,
    );
  });

  it('recommends a fare computed from a route when distance/duration are absent', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/pricing/estimate')
      .send({
        route: {
          origin: { latitude: 59.9326, longitude: 30.3506 },
          destination: { latitude: 59.8003, longitude: 30.2625 },
        },
      })
      .expect(200);

    expect(response.body.distanceMeters).toBe(12_000);
    expect(response.body.durationSeconds).toBe(900);
  });

  it('rejects a pricing estimate with neither distance nor route', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/pricing/estimate')
      .send({})
      .expect(400);
  });
});
