import { ConfigService } from '@nestjs/config';

import { HttpRouteEstimator } from './http-route-estimator.js';
import { createRouteEstimator } from './route-estimator.factory.js';
import type { RouteLeg } from './route-estimator.interface.js';
import { StraightLineRouteEstimator } from './straight-line-route-estimator.js';

const legs: RouteLeg[] = [
  {
    driverId: 'driver-a',
    straightLineSeconds: 120,
    origin: { longitude: 37.61, latitude: 55.75 },
    destination: { longitude: 37.62, latitude: 55.75 },
  },
  {
    driverId: 'driver-b',
    straightLineSeconds: 200,
    origin: { longitude: 37.6, latitude: 55.74 },
    destination: { longitude: 37.62, latitude: 55.75 },
  },
];

describe('StraightLineRouteEstimator', () => {
  it('returns the straight-line ETA unchanged', async () => {
    const estimator = new StraightLineRouteEstimator();

    await expect(estimator.estimate(legs)).resolves.toEqual([
      { driverId: 'driver-a', estimatedPickupSeconds: 120 },
      { driverId: 'driver-b', estimatedPickupSeconds: 200 },
    ]);
  });
});

describe('HttpRouteEstimator', () => {
  const estimator = new HttpRouteEstimator(
    new ConfigService({
      dispatch: {
        routingApiBaseUrl: 'https://router.example/v1/',
        routingApiKey: 'test-key',
        routingRequestTimeoutMs: 3_000,
      },
    }),
  );

  it('degrades to the straight-line ETA until an API is wired in', async () => {
    await expect(estimator.estimate(legs)).resolves.toEqual([
      { driverId: 'driver-a', estimatedPickupSeconds: 120 },
      { driverId: 'driver-b', estimatedPickupSeconds: 200 },
    ]);
  });
});

describe('createRouteEstimator', () => {
  it('returns the straight-line estimator by default', () => {
    const estimator = createRouteEstimator(
      new ConfigService({ dispatch: { routingProvider: 'straight-line' } }),
    );

    expect(estimator).toBeInstanceOf(StraightLineRouteEstimator);
  });

  it('returns the http estimator when configured', () => {
    const estimator = createRouteEstimator(
      new ConfigService({
        dispatch: {
          routingProvider: 'http',
          routingApiBaseUrl: 'https://router.example/v1/',
          routingApiKey: 'test-key',
          routingRequestTimeoutMs: 3_000,
        },
      }),
    );

    expect(estimator).toBeInstanceOf(HttpRouteEstimator);
  });
});
