import { YandexMapsProvider } from './yandex-maps.provider.js';

function geocoderResponse(overrides?: {
  name?: string;
  description?: string;
  pos?: string;
  text?: string;
  components?: Array<{ kind: string; name: string }>;
  postalCode?: string;
}) {
  return {
    response: {
      GeoObjectCollection: {
        featureMember: [
          {
            GeoObject: {
              name: overrides?.name ?? 'Невский проспект, 45',
              description: overrides?.description ?? 'Санкт-Петербург, Россия',
              Point: { pos: overrides?.pos ?? '30.3506 59.9326' },
              metaDataProperty: {
                GeocoderMetaData: {
                  text:
                    overrides?.text ??
                    'Россия, Санкт-Петербург, Невский проспект, 45',
                  Address: {
                    postal_code: overrides?.postalCode ?? '191025',
                    Components: overrides?.components ?? [
                      { kind: 'country', name: 'Россия' },
                      { kind: 'province', name: 'Санкт-Петербург' },
                      { kind: 'locality', name: 'Санкт-Петербург' },
                      { kind: 'street', name: 'Невский проспект' },
                      { kind: 'house', name: '45' },
                    ],
                  },
                },
              },
            },
          },
        ],
      },
    },
  };
}

describe('YandexMapsProvider', () => {
  function withMockedHttp(response: unknown) {
    const provider = new YandexMapsProvider({
      apiKey: 'test-key',
      apiBaseUrl: 'https://geocode-maps.yandex.ru',
      timeoutMs: 1_000,
      maxRetries: 0,
      userAgent: 'test-agent',
    });
    // Replace the private http client with a stub returning a fixed response.
    (
      provider as unknown as { http: { getJson: () => Promise<unknown> } }
    ).http = {
      getJson: async () => response,
    };
    return provider;
  }

  it('transforms a geocoder response into a ResolvedAddress', async () => {
    const provider = withMockedHttp(geocoderResponse());
    const resolved = await provider.geocodeAddress('Невский 45');

    expect(resolved).toMatchObject({
      formattedAddress: 'Россия, Санкт-Петербург, Невский проспект, 45',
      provider: 'yandex',
      components: {
        country: 'Россия',
        city: 'Санкт-Петербург',
        street: 'Невский проспект',
        house: '45',
        postalCode: '191025',
      },
    });
    expect(resolved?.location.latitude).toBeCloseTo(59.9326, 3);
    expect(resolved?.location.longitude).toBeCloseTo(30.3506, 3);
  });

  it('parses "longitude latitude" point order correctly', async () => {
    const provider = withMockedHttp(
      geocoderResponse({ pos: '30.262500 59.800300' }),
    );
    const resolved = await provider.geocodeAddress('Пулково');
    expect(resolved?.location.longitude).toBeCloseTo(30.2625, 3);
    expect(resolved?.location.latitude).toBeCloseTo(59.8003, 3);
  });

  it('returns null when the response has no GeoObject', async () => {
    const provider = withMockedHttp({ response: { GeoObjectCollection: {} } });
    const resolved = await provider.geocodeAddress('nowhere');
    expect(resolved).toBeNull();
  });

  it('turns a geocoder response into address suggestions', async () => {
    const provider = withMockedHttp(geocoderResponse());
    const suggestions = await provider.searchAddress('Невский');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.provider).toBe('yandex');
    expect(suggestions[0]?.fullAddress).toContain('Невский');
  });

  it('falls back to a straight-line route with a warning when routing is unimplemented', async () => {
    const provider = withMockedHttp(geocoderResponse());
    const route = await provider.buildRoute({
      origin: { latitude: 59.9326, longitude: 30.3506 },
      destination: { latitude: 59.8003, longitude: 30.2625 },
      waypoints: [],
      transportMode: 'driving',
      avoidTolls: false,
      avoidUnpavedRoads: false,
    });

    expect(route.distanceMeters).toBeGreaterThan(0);
    expect(route.warnings.length).toBeGreaterThan(0);
    expect(route.provider).toBe('yandex');
  });
});
