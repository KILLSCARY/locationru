import { jest } from '@jest/globals';

import { DevelopmentMapsProvider } from './development-maps.provider.js';

describe('DevelopmentMapsProvider', () => {
  let provider: DevelopmentMapsProvider;

  beforeEach(() => {
    provider = new DevelopmentMapsProvider();
  });

  it('returns address suggestions for the seed test addresses', async () => {
    const results = await provider.searchAddress('Мурино Екатерининская');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.fullAddress).toContain('Мурино');
    expect(results[0]?.provider).toBe('development');
  });

  it('finds suggestions for each documented seed address', async () => {
    const queries = [
      'Мурино, Екатерининская улица, 30',
      'Санкт-Петербург, Невский проспект, 45',
      'Санкт-Петербург, Московский вокзал',
      'Санкт-Петербург, аэропорт Пулково',
    ];

    for (const query of queries) {
      const results = await provider.searchAddress(query);
      expect(results.length).toBeGreaterThan(0);
    }
  });

  it('geocodes a known seed address to fixed coordinates', async () => {
    const resolved = await provider.geocodeAddress('Невский проспект 45');
    expect(resolved).not.toBeNull();
    expect(resolved?.location.latitude).toBeCloseTo(59.9326, 3);
    expect(resolved?.location.longitude).toBeCloseTo(30.3506, 3);
  });

  it('returns null when geocoding an address outside the seed set', async () => {
    const resolved = await provider.geocodeAddress('Москва, Арбат, 1');
    expect(resolved).toBeNull();
  });

  it('reverse geocodes to the nearest seed address', async () => {
    const resolved = await provider.reverseGeocode(59.8003, 30.2625);
    expect(resolved?.formattedAddress).toContain('Пулково');
  });

  it('builds a deterministic route with distance, duration and geometry', async () => {
    const route = await provider.buildRoute({
      origin: { latitude: 59.9326, longitude: 30.3506 },
      destination: { latitude: 59.8003, longitude: 30.2625 },
      waypoints: [],
      transportMode: 'driving',
      avoidTolls: false,
      avoidUnpavedRoads: false,
    });

    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(route.durationSeconds).toBeGreaterThan(0);
    expect(route.geometry.length).toBeGreaterThanOrEqual(2);
    expect(route.provider).toBe('development');
  });

  it('produces identical routes for identical requests (deterministic)', async () => {
    const request = {
      origin: { latitude: 59.9326, longitude: 30.3506 },
      destination: { latitude: 59.8003, longitude: 30.2625 },
      waypoints: [],
      transportMode: 'driving' as const,
      avoidTolls: false,
      avoidUnpavedRoads: false,
    };
    const a = await provider.buildRoute(request);
    const b = await provider.buildRoute(request);
    expect(a).toEqual(b);
  });

  it('never performs network I/O (no fetch calls)', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await provider.searchAddress('Невский');
    await provider.geocodeAddress('Невский проспект 45');
    await provider.reverseGeocode(59.93, 30.35);
    await provider.buildRoute({
      origin: { latitude: 59.9326, longitude: 30.3506 },
      destination: { latitude: 59.8003, longitude: 30.2625 },
      waypoints: [],
      transportMode: 'driving',
      avoidTolls: false,
      avoidUnpavedRoads: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
