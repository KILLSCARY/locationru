import { MapsProviderError } from '../maps.types.js';
import { DevelopmentMapsProvider } from './development-maps.provider.js';

describe('DevelopmentMapsProvider', () => {
  const provider = new DevelopmentMapsProvider();

  it('searches and resolves deterministic offline addresses', async () => {
    const suggestions = await provider.searchAddress('невский 45');
    expect(suggestions).toHaveLength(1);
    const address = await provider.geocodeAddress(
      suggestions[0]!.fullAddress,
      suggestions[0]!.providerPlaceId,
    );
    expect(address).toMatchObject({
      formattedAddress: 'Санкт-Петербург, Невский проспект, 45',
      providerPlaceId: 'dev:spb:nevsky-45',
    });
    await expect(
      provider.reverseGeocode(
        address.location.latitude,
        address.location.longitude,
      ),
    ).resolves.toEqual(address);
  });

  it('returns a deterministic route with geometry, distance and time', async () => {
    const route = await provider.buildRoute({
      origin: { latitude: 60.052281, longitude: 30.440428 },
      destination: { latitude: 59.934102, longitude: 30.338448 },
      waypoints: [{ latitude: 59.929103, longitude: 30.362328 }],
      transportMode: 'CAR',
      avoidTolls: false,
      avoidUnpavedRoads: false,
    });
    expect(route.provider).toBe('development');
    expect(route.distanceMeters).toBeGreaterThan(10_000);
    expect(route.durationSeconds).toBeGreaterThan(0);
    expect(route.geometry.coordinates).toHaveLength(3);
    await expect(
      provider.buildRoute({
        origin: { latitude: 60.052281, longitude: 30.440428 },
        destination: { latitude: 59.934102, longitude: 30.338448 },
        waypoints: [{ latitude: 59.929103, longitude: 30.362328 }],
        transportMode: 'CAR',
        avoidTolls: false,
        avoidUnpavedRoads: false,
      }),
    ).resolves.toEqual(route);
  });

  it('uses a normalized not-found error', async () => {
    await expect(provider.geocodeAddress('неизвестный адрес')).rejects.toEqual(
      expect.objectContaining<Partial<MapsProviderError>>({
        code: 'NOT_FOUND',
      }),
    );
  });
});
