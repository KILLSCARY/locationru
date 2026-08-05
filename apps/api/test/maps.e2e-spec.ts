import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AccessTokenGuard } from '../src/auth/guards/access-token.guard.js';
import { RolesGuard } from '../src/auth/guards/roles.guard.js';
import {
  MapsController,
  PricingController,
  RoutesController,
} from '../src/maps/maps.controller.js';
import { MapsRateLimitGuard } from '../src/maps/maps-rate-limit.guard.js';
import { MapsService } from '../src/maps/maps.service.js';
import { PricingEstimateService } from '../src/maps/pricing-estimate.service.js';
import { DevelopmentMapsProvider } from '../src/maps/providers/development-maps.provider.js';

describe('Maps, routes and pricing endpoints', () => {
  let app: INestApplication;
  const provider = new DevelopmentMapsProvider();
  const maps = {
    searchAddress: provider.searchAddress.bind(provider),
    geocodeAddress: provider.geocodeAddress.bind(provider),
    reverseGeocode: (point: { latitude: number; longitude: number }) =>
      provider.reverseGeocode(point.latitude, point.longitude),
    estimateRoute: provider.estimateRoute.bind(provider),
    buildRoute: provider.buildRoute.bind(provider),
  };
  const pricing = {
    calculate: (distanceMeters: number, durationSeconds: number) => ({
      recommendedPriceKopecks: 130_000,
      minimumSuggestedPriceKopecks: 120_000,
      maximumSuggestedPriceKopecks: 150_000,
      distanceMeters,
      durationSeconds,
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MapsController, RoutesController, PricingController],
      providers: [
        { provide: MapsService, useValue: maps },
        { provide: PricingEstimateService, useValue: pricing },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(MapsRateLimitGuard)
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

  afterAll(async () => app.close());

  it('searches, geocodes and reverse geocodes an offline address', async () => {
    const suggestions = await request(app.getHttpServer())
      .get('/api/v1/maps/address-suggestions')
      .query({ query: 'Невский 45', limit: 5 })
      .expect(200);
    expect(suggestions.body.suggestions).toHaveLength(1);
    const geocoded = await request(app.getHttpServer())
      .post('/api/v1/maps/geocode')
      .send({
        address: suggestions.body.suggestions[0].fullAddress,
        providerPlaceId: suggestions.body.suggestions[0].providerPlaceId,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/maps/reverse-geocode')
      .send(geocoded.body.address.location)
      .expect(201)
      .expect((response) => {
        expect(response.body.address.providerPlaceId).toBe('dev:spb:nevsky-45');
      });
  });

  it('estimates and builds a validated route and price', async () => {
    const body = {
      origin: { latitude: 60.052281, longitude: 30.440428 },
      destination: { latitude: 59.934102, longitude: 30.338448 },
      waypoints: [],
      transportMode: 'CAR',
    };
    await request(app.getHttpServer())
      .post('/api/v1/routes/estimate')
      .send(body)
      .expect(201)
      .expect((response) => expect(response.body.provider).toBe('development'));
    await request(app.getHttpServer())
      .post('/api/v1/routes/build')
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/pricing/estimate')
      .send(body)
      .expect(201)
      .expect((response) =>
        expect(response.body.recommendedPriceKopecks).toBe(130_000),
      );
  });

  it('rejects short queries, excessive limits and invalid coordinates', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/maps/address-suggestions')
      .query({ query: 'a', limit: 11 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/routes/build')
      .send({
        origin: { latitude: 91, longitude: 30 },
        destination: { latitude: 59, longitude: 30 },
      })
      .expect(400);
  });
});
