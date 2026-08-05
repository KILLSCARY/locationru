import {
  Injectable,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AddressSuggestionSchema,
  ResolvedAddressSchema,
  RouteResultSchema,
  type AddressSuggestion,
  type GeoPoint,
  type ResolvedAddress,
  type RouteRequest,
  type RouteResult,
} from '@resilient-taxi/contracts';
import { z } from 'zod';

import { MapsCacheService } from './maps-cache.service.js';
import type { MapsProvider } from './maps.types.js';
import { MapsProviderError } from './maps.types.js';
import {
  normalizeAddressQuery,
  normalizedRouteRequest,
  stableCacheKey,
} from './maps.utils.js';
import { DevelopmentMapsProvider } from './providers/development-maps.provider.js';
import { YandexMapsProvider } from './providers/yandex-maps.provider.js';

@Injectable()
export class MapsService {
  readonly provider: MapsProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly cache: MapsCacheService,
    developmentProvider: DevelopmentMapsProvider,
    yandexProvider: YandexMapsProvider,
  ) {
    const configured = config.get<string>('maps.provider') ?? 'development';
    const environment = config.get<string>('app.environment') ?? 'development';
    const hasApiKey = Boolean(config.get<string>('maps.apiKey'));
    if (configured === 'development' && environment === 'production') {
      throw new Error('DevelopmentMapsProvider must not run in production');
    }
    if (configured === 'yandex' && !hasApiKey) {
      if (environment === 'production')
        throw new Error('MAPS_API_KEY is required in production');
      this.provider = developmentProvider;
      return;
    }
    this.provider =
      configured === 'yandex' ? yandexProvider : developmentProvider;
  }

  searchAddress(
    query: string,
    bias?: GeoPoint,
    limit = 5,
  ): Promise<AddressSuggestion[]> {
    const normalized = normalizeAddressQuery(query);
    const key = stableCacheKey('suggestions', this.provider.name, {
      query: normalized,
      bias: bias && {
        latitude: Number(bias.latitude.toFixed(4)),
        longitude: Number(bias.longitude.toFixed(4)),
      },
      limit,
    });
    return this.cached(
      key,
      'suggestionsTtlSeconds',
      z.array(AddressSuggestionSchema),
      () => this.provider.searchAddress(normalized, bias, limit),
    );
  }

  geocodeAddress(
    address: string,
    providerPlaceId?: string | null,
  ): Promise<ResolvedAddress> {
    const key = stableCacheKey('geocode', this.provider.name, {
      address: normalizeAddressQuery(address),
      providerPlaceId: providerPlaceId ?? null,
    });
    return this.cached(key, 'geocodingTtlSeconds', ResolvedAddressSchema, () =>
      this.provider.geocodeAddress(address, providerPlaceId),
    );
  }

  reverseGeocode(point: GeoPoint): Promise<ResolvedAddress> {
    const normalized = {
      latitude: Number(point.latitude.toFixed(6)),
      longitude: Number(point.longitude.toFixed(6)),
    };
    const key = stableCacheKey('reverse', this.provider.name, normalized);
    return this.cached(
      key,
      'reverseGeocodingTtlSeconds',
      ResolvedAddressSchema,
      () =>
        this.provider.reverseGeocode(normalized.latitude, normalized.longitude),
    );
  }

  estimateRoute(request: RouteRequest): Promise<RouteResult> {
    const normalized = normalizedRouteRequest(request);
    const key = stableCacheKey(
      'route-estimate',
      this.provider.name,
      normalized,
    );
    return this.cached(key, 'routeTtlSeconds', RouteResultSchema, () =>
      this.provider.estimateRoute(normalized),
    );
  }

  buildRoute(request: RouteRequest): Promise<RouteResult> {
    const normalized = normalizedRouteRequest(request);
    const key = stableCacheKey('route-build', this.provider.name, normalized);
    return this.cached(key, 'routeTtlSeconds', RouteResultSchema, () =>
      this.provider.buildRoute(normalized),
    );
  }

  private async cached<T>(
    key: string,
    ttlKey: string,
    schema: z.ZodType<T>,
    loader: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.cache.getOrLoad(
        key,
        this.config.get<number>(`maps.${ttlKey}`) ?? 300,
        schema,
        loader,
      );
    } catch (error) {
      if (error instanceof MapsProviderError) {
        if (error.code === 'RATE_LIMITED') {
          throw new HttpException(
            {
              code: 'MAPS_RATE_LIMITED',
              message: 'Address and route service is temporarily rate limited',
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        throw new ServiceUnavailableException({
          code: `MAPS_${error.code}`,
          message: error.message,
        });
      }
      throw error;
    }
  }
}
