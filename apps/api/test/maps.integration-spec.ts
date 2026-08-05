import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';

import { MapsCacheService } from '../src/maps/maps-cache.service.js';
import { MapsService } from '../src/maps/maps.service.js';
import { DevelopmentMapsProvider } from '../src/maps/providers/development-maps.provider.js';
import { YandexMapsProvider } from '../src/maps/providers/yandex-maps.provider.js';
import { RedisService } from '../src/redis/redis.service.js';

class MemoryRedis {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async setWithTtl(key: string, value: string) {
    this.values.set(key, value);
  }
  async setIfNotExistsWithTtl(key: string, value: string) {
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    return true;
  }
  async delete(key: string) {
    this.values.delete(key);
  }
  async deleteIfValue(key: string, expectedValue: string) {
    if (this.values.get(key) !== expectedValue) return false;
    this.values.delete(key);
    return true;
  }
}

describe('maps provider and cache integration', () => {
  it('executes the offline provider on a miss and serves the next request from Redis', async () => {
    const config = new ConfigService({
      app: { environment: 'test' },
      maps: {
        provider: 'development',
        suggestionsTtlSeconds: 60,
        geocodingTtlSeconds: 60,
        reverseGeocodingTtlSeconds: 60,
        routeTtlSeconds: 60,
      },
    });
    const redis = new MemoryRedis();
    const cache = new MapsCacheService(redis as unknown as RedisService);
    const development = new DevelopmentMapsProvider();
    const search = jest.spyOn(development, 'searchAddress');
    const service = new MapsService(
      config,
      cache,
      development,
      new YandexMapsProvider(config),
    );

    const first = await service.searchAddress('СПб, Невский 45', undefined, 5);
    const second = await service.searchAddress(
      '  спб невский 45 ',
      undefined,
      5,
    );

    expect(first).toEqual(second);
    expect(first[0]?.providerPlaceId).toBe('dev:spb:nevsky-45');
    expect(search).toHaveBeenCalledTimes(1);
    const resolved = await service.geocodeAddress(
      first[0]!.fullAddress,
      first[0]!.providerPlaceId,
    );
    await expect(service.reverseGeocode(resolved.location)).resolves.toEqual(
      resolved,
    );
    const request = {
      origin: { latitude: 60.052281, longitude: 30.440428 },
      destination: resolved.location,
      waypoints: [],
      transportMode: 'CAR' as const,
      avoidTolls: false,
      avoidUnpavedRoads: false,
    };
    const estimate = await service.estimateRoute(request);
    await expect(service.buildRoute(request)).resolves.toMatchObject({
      distanceMeters: estimate.distanceMeters,
      durationSeconds: estimate.durationSeconds,
      provider: 'development',
    });
    expect(
      [...redis.values.keys()].some((key) => key.includes('suggestions')),
    ).toBe(true);
  });

  it('normalizes provider rate limits after bounded retries', async () => {
    const fetcher = jest.fn(async () => new Response('{}', { status: 429 }));
    const provider = new YandexMapsProvider(
      yandexConfig({ retryAttempts: 1 }),
      fetcher as typeof fetch,
    );
    await expect(provider.searchAddress('Невский 45')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('aborts a provider request at the configured timeout', async () => {
    const fetcher = jest.fn(
      async (_url: URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const provider = new YandexMapsProvider(
      yandexConfig({ timeoutMs: 5 }),
      fetcher as typeof fetch,
    );
    await expect(provider.searchAddress('Невский 45')).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });
});

function yandexConfig(overrides: Record<string, unknown>): ConfigService {
  return new ConfigService({
    app: { environment: 'test' },
    maps: {
      provider: 'yandex',
      apiKey: 'integration-test-key',
      apiUrl: 'https://geocode-maps.yandex.ru/v1/',
      timeoutMs: 100,
      retryAttempts: 0,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 1_000,
      ...overrides,
    },
  });
}
