import {
  geocodeCacheKey,
  reverseGeocodeCacheKey,
  routeCacheKey,
  suggestionsCacheKey,
} from './cache-keys.js';
import type { RouteRequest } from '../maps.types.js';

const baseRoute: RouteRequest = {
  origin: { latitude: 59.9326, longitude: 30.3506 },
  destination: { latitude: 59.8003, longitude: 30.2625 },
  waypoints: [],
  transportMode: 'driving',
  avoidTolls: false,
  avoidUnpavedRoads: false,
};

describe('cache keys', () => {
  it('namespaces by provider so providers never share cached data', () => {
    expect(geocodeCacheKey('yandex', 'Невский 45')).not.toBe(
      geocodeCacheKey('development', 'Невский 45'),
    );
  });

  it('collapses equivalent address queries to one suggestions key', () => {
    expect(suggestionsCacheKey('yandex', 'Невский, 45', undefined, 5)).toBe(
      suggestionsCacheKey('yandex', 'невский 45', undefined, 5),
    );
  });

  it('separates suggestions keys by limit and bias', () => {
    expect(suggestionsCacheKey('yandex', 'невский', undefined, 5)).not.toBe(
      suggestionsCacheKey('yandex', 'невский', undefined, 10),
    );
    expect(
      suggestionsCacheKey(
        'yandex',
        'невский',
        { latitude: 59.9, longitude: 30.3 },
        5,
      ),
    ).not.toBe(suggestionsCacheKey('yandex', 'невский', undefined, 5));
  });

  it('rounds coordinates so near-identical points share a reverse key', () => {
    expect(reverseGeocodeCacheKey('yandex', 59.932_600_1, 30.350_600_2)).toBe(
      reverseGeocodeCacheKey('yandex', 59.9326, 30.3506),
    );
  });

  it('separates estimate and build route keys', () => {
    expect(routeCacheKey('yandex', 'estimate', baseRoute)).not.toBe(
      routeCacheKey('yandex', 'build', baseRoute),
    );
  });

  it('folds route options into the key', () => {
    expect(routeCacheKey('yandex', 'build', baseRoute)).not.toBe(
      routeCacheKey('yandex', 'build', { ...baseRoute, avoidTolls: true }),
    );
  });

  it('is stable regardless of waypoint input ordering', () => {
    const a: RouteRequest = {
      ...baseRoute,
      waypoints: [
        { latitude: 59.9, longitude: 30.3, sequence: 1 },
        { latitude: 59.85, longitude: 30.28, sequence: 2 },
      ],
    };
    const b: RouteRequest = {
      ...baseRoute,
      waypoints: [
        { latitude: 59.85, longitude: 30.28, sequence: 2 },
        { latitude: 59.9, longitude: 30.3, sequence: 1 },
      ],
    };
    expect(routeCacheKey('yandex', 'build', a)).toBe(
      routeCacheKey('yandex', 'build', b),
    );
  });
});
