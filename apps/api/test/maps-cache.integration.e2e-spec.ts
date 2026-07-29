import { ConfigService } from '@nestjs/config';

import { MapsCacheService } from '../src/maps/cache/maps-cache.service.js';
import { MapsRateLimitService } from '../src/maps/maps-rate-limit.service.js';
import { MapsService } from '../src/maps/maps.service.js';
import { MapsProviderError } from '../src/maps/providers/maps-provider.errors.js';
import type { MapsProvider } from '../src/maps/providers/maps-provider.interface.js';
import type { RouteRequest, RouteResult } from '../src/maps/maps.types.js';
import {
  asRedisService,
  InMemoryRedisService,
} from './support/in-memory-redis.js';

const baseRoute: RouteRequest = {
  origin: { latitude: 59.9326, longitude: 30.3506 },
  destination: { latitude: 59.8003, longitude: 30.2625 },
  waypoints: [],
  transportMode: 'driving',
  avoidTolls: false,
  avoidUnpavedRoads: false,
};

function fakeRoute(): RouteResult {
  return {
    distanceMeters: 12_000,
    durationSeconds: 900,
    geometry: [baseRoute.origin, baseRoute.destination],
    encodedPolyline: null,
    bounds: {
      minLatitude: 59.8003,
      minLongitude: 30.2625,
      maxLatitude: 59.9326,
      maxLongitude: 30.3506,
    },
    provider: 'fake',
    providerRouteId: null,
    warnings: [],
    snappedWaypoints: [],
  };
}

function makeMapsService(
  provider: Partial<MapsProvider>,
  redis: InMemoryRedisService,
): MapsService {
  const fullProvider: MapsProvider = {
    name: 'fake',
    searchAddress: async () => [],
    searchPlaces: async () => [],
    getPlaceDetails: async () => null,
    geocodeAddress: async () => null,
    reverseGeocode: async () => null,
    buildRoute: async () => fakeRoute(),
    estimateRoute: async () => fakeRoute(),
    matchLocationToRoad: async (location) => ({ location, confidence: 1 }),
    matchRoute: async (points) => points,
    ...provider,
  };

  const cache = new MapsCacheService(asRedisService(redis));
  const config = new ConfigService({
    maps: {
      suggestionsTtlSeconds: 300,
      geocodingTtlSeconds: 86_400,
      routeTtlSeconds: 1_800,
    },
  });

  return new MapsService(fullProvider, cache, config);
}

describe('Maps caching integration', () => {
  it('is a cache miss on the first call and a cache hit afterwards', async () => {
    const redis = new InMemoryRedisService();
    let calls = 0;
    const mapsService = makeMapsService(
      {
        estimateRoute: async () => {
          calls += 1;
          return fakeRoute();
        },
      },
      redis,
    );

    const first = await mapsService.estimateRoute(baseRoute);
    const second = await mapsService.estimateRoute(baseRoute);

    expect(first).toEqual(second);
    expect(calls).toBe(1); // Provider called once; second call was a cache hit.
  });

  it('recomputes when the cache key differs (cache miss for a distinct route)', async () => {
    const redis = new InMemoryRedisService();
    let calls = 0;
    const mapsService = makeMapsService(
      {
        estimateRoute: async () => {
          calls += 1;
          return fakeRoute();
        },
      },
      redis,
    );

    await mapsService.estimateRoute(baseRoute);
    await mapsService.estimateRoute({ ...baseRoute, avoidTolls: true });

    expect(calls).toBe(2);
  });

  it('does not cache a null geocoding result', async () => {
    const redis = new InMemoryRedisService();
    let calls = 0;
    const mapsService = makeMapsService(
      {
        geocodeAddress: async () => {
          calls += 1;
          return null;
        },
      },
      redis,
    );

    await mapsService.geocode('Несуществующий адрес');
    await mapsService.geocode('Несуществующий адрес');

    expect(calls).toBe(2); // Invalid/null results are never cached.
  });

  it('propagates a provider timeout instead of caching a failure', async () => {
    const redis = new InMemoryRedisService();
    const mapsService = makeMapsService(
      {
        buildRoute: async () => {
          throw MapsProviderError.timeout('fake');
        },
      },
      redis,
    );

    await expect(mapsService.buildRoute(baseRoute)).rejects.toBeInstanceOf(
      MapsProviderError,
    );

    // A later successful call is not blocked by a cached failure.
    const recovered = makeMapsService({}, redis);
    await expect(recovered.buildRoute(baseRoute)).resolves.toMatchObject({
      provider: 'fake',
    });
  });

  it('propagates a provider rate-limit error', async () => {
    const redis = new InMemoryRedisService();
    const mapsService = makeMapsService(
      {
        estimateRoute: async () => {
          throw MapsProviderError.rateLimited('fake');
        },
      },
      redis,
    );

    const error = await mapsService
      .estimateRoute(baseRoute)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MapsProviderError);
    expect((error as MapsProviderError).kind).toBe('rate_limited');
  });
});

describe('Maps rate limiting integration', () => {
  it('allows requests under the per-minute limit', async () => {
    const redis = new InMemoryRedisService();
    const rateLimit = new MapsRateLimitService(asRedisService(redis));

    await expect(
      rateLimit.enforce('suggestions', 'user-1', 3),
    ).resolves.toBeUndefined();
    await expect(
      rateLimit.enforce('suggestions', 'user-1', 3),
    ).resolves.toBeUndefined();
  });

  it('rejects once the per-minute limit is exceeded', async () => {
    const redis = new InMemoryRedisService();
    const rateLimit = new MapsRateLimitService(asRedisService(redis));

    await rateLimit.enforce('suggestions', 'user-2', 2);
    await rateLimit.enforce('suggestions', 'user-2', 2);

    await expect(
      rateLimit.enforce('suggestions', 'user-2', 2),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('tracks limits independently per subject', async () => {
    const redis = new InMemoryRedisService();
    const rateLimit = new MapsRateLimitService(asRedisService(redis));

    await rateLimit.enforce('suggestions', 'user-a', 1);
    await expect(
      rateLimit.enforce('suggestions', 'user-b', 1),
    ).resolves.toBeUndefined();
  });
});
