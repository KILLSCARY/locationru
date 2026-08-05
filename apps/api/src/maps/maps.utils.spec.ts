import {
  normalizeAddressQuery,
  normalizedRouteRequest,
  stableCacheKey,
} from './maps.utils.js';

describe('maps utilities', () => {
  it('normalizes Russian address input consistently', () => {
    expect(normalizeAddressQuery('  СПБ,  Невский проспект, 45! ')).toBe(
      'спб невский проспект 45',
    );
    expect(normalizeAddressQuery('Ёлочная')).toBe('елочная');
  });

  it('creates stable cache keys without exposing personal address text', () => {
    const left = stableCacheKey('suggestions', 'development', {
      limit: 5,
      query: 'невский 45',
    });
    const right = stableCacheKey('suggestions', 'development', {
      query: 'невский 45',
      limit: 5,
    });
    expect(left).toBe(right);
    expect(left).not.toContain('невский');
    expect(left).not.toBe(
      stableCacheKey('suggestions', 'yandex', {
        query: 'невский 45',
        limit: 5,
      }),
    );
  });

  it('rounds route coordinates for cache reuse and preserves route parameters', () => {
    expect(
      normalizedRouteRequest({
        origin: { latitude: 59.93410249, longitude: 30.33844849 },
        destination: { latitude: 59.80029249, longitude: 30.26250349 },
        waypoints: [],
        transportMode: 'CAR',
        avoidTolls: true,
        avoidUnpavedRoads: false,
      }),
    ).toEqual({
      origin: { latitude: 59.934102, longitude: 30.338448 },
      destination: { latitude: 59.800292, longitude: 30.262503 },
      waypoints: [],
      transportMode: 'CAR',
      avoidTolls: true,
      avoidUnpavedRoads: false,
    });
  });
});
