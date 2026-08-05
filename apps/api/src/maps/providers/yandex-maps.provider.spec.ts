import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';

import { MapsProviderError } from '../maps.types.js';
import { parseGeoObject, YandexMapsProvider } from './yandex-maps.provider.js';

describe('YandexMapsProvider', () => {
  it('normalizes geocoder responses without exposing provider objects', () => {
    expect(
      parseGeoObject({
        uri: 'ymapsbm1://geo?data=test',
        Point: { pos: '30.338448 59.934102' },
        metaDataProperty: {
          GeocoderMetaData: {
            Address: {
              formatted: 'Россия, Санкт-Петербург, Невский проспект, 45',
              Components: [
                { kind: 'country', name: 'Россия' },
                { kind: 'locality', name: 'Санкт-Петербург' },
                { kind: 'street', name: 'Невский проспект' },
                { kind: 'house', name: '45' },
              ],
            },
          },
        },
      }),
    ).toEqual({
      formattedAddress: 'Россия, Санкт-Петербург, Невский проспект, 45',
      location: { latitude: 59.934102, longitude: 30.338448 },
      providerPlaceId: 'ymapsbm1://geo?data=test',
      provider: 'yandex',
      components: {
        country: 'Россия',
        region: null,
        city: 'Санкт-Петербург',
        district: null,
        street: 'Невский проспект',
        house: '45',
        postalCode: null,
      },
    });
  });

  it('retries rate limits and then exposes a normalized error', async () => {
    const fetcher = jest.fn(async () => new Response('{}', { status: 429 }));
    const provider = new YandexMapsProvider(
      config({ maps: { retryAttempts: 1 } }),
      fetcher as typeof fetch,
    );
    await expect(provider.searchAddress('Невский 45')).rejects.toEqual(
      expect.objectContaining<Partial<MapsProviderError>>({
        code: 'RATE_LIMITED',
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('normalizes request timeouts', async () => {
    const fetcher = jest.fn(
      async (_url: URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const provider = new YandexMapsProvider(
      config({ maps: { timeoutMs: 5, retryAttempts: 0 } }),
      fetcher as typeof fetch,
    );
    await expect(provider.searchAddress('Невский 45')).rejects.toEqual(
      expect.objectContaining<Partial<MapsProviderError>>({ code: 'TIMEOUT' }),
    );
  });
});

function config(overrides: Record<string, unknown>): ConfigService {
  return new ConfigService({
    app: { environment: 'test' },
    maps: {
      provider: 'yandex',
      apiKey: 'test-key',
      apiUrl: 'https://geocode-maps.yandex.ru/v1/',
      timeoutMs: 100,
      retryAttempts: 0,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 1_000,
      ...(overrides.maps as object),
    },
  });
}
