import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MapsCacheService } from './cache/maps-cache.service.js';
import {
  geocodeCacheKey,
  reverseGeocodeCacheKey,
  routeCacheKey,
  suggestionsCacheKey,
} from './geo/cache-keys.js';
import {
  MAPS_PROVIDER,
  type MapsProvider,
} from './providers/maps-provider.interface.js';
import type {
  AddressSuggestion,
  GeoPoint,
  ResolvedAddress,
  RouteRequest,
  RouteResult,
} from './maps.types.js';

export interface AddressSearchInput {
  query: string;
  bias?: GeoPoint | undefined;
  limit: number;
}

/**
 * Orchestrates the maps provider behind a read-through Redis cache. Callers use
 * this service; they never see the concrete provider. Different result kinds get
 * different TTLs, and invalid/empty results are not cached.
 */
@Injectable()
export class MapsService {
  private readonly suggestionsTtl: number;
  private readonly geocodingTtl: number;
  private readonly routeTtl: number;

  constructor(
    @Inject(MAPS_PROVIDER) private readonly provider: MapsProvider,
    private readonly cache: MapsCacheService,
    configService: ConfigService,
  ) {
    this.suggestionsTtl = configService.getOrThrow<number>(
      'maps.suggestionsTtlSeconds',
    );
    this.geocodingTtl = configService.getOrThrow<number>(
      'maps.geocodingTtlSeconds',
    );
    this.routeTtl = configService.getOrThrow<number>('maps.routeTtlSeconds');
  }

  get providerName(): string {
    return this.provider.name;
  }

  searchAddress(input: AddressSearchInput): Promise<AddressSuggestion[]> {
    const key = suggestionsCacheKey(
      this.provider.name,
      input.query,
      input.bias,
      input.limit,
    );
    return this.cache.getOrCompute(
      key,
      this.suggestionsTtl,
      () =>
        this.provider.searchAddress(input.query, {
          biasLocation: input.bias,
          limit: input.limit,
        }),
      (suggestions) => suggestions.length > 0,
    );
  }

  geocode(address: string): Promise<ResolvedAddress | null> {
    const key = geocodeCacheKey(this.provider.name, address);
    return this.cache.getOrCompute(
      key,
      this.geocodingTtl,
      () => this.provider.geocodeAddress(address),
      (resolved) => resolved !== null,
    );
  }

  reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<ResolvedAddress | null> {
    const key = reverseGeocodeCacheKey(this.provider.name, latitude, longitude);
    return this.cache.getOrCompute(
      key,
      this.geocodingTtl,
      () => this.provider.reverseGeocode(latitude, longitude),
      (resolved) => resolved !== null,
    );
  }

  estimateRoute(request: RouteRequest): Promise<RouteResult> {
    const key = routeCacheKey(this.provider.name, 'estimate', request);
    return this.cache.getOrCompute(key, this.routeTtl, () =>
      this.provider.estimateRoute(request),
    );
  }

  buildRoute(request: RouteRequest): Promise<RouteResult> {
    const key = routeCacheKey(this.provider.name, 'build', request);
    return this.cache.getOrCompute(key, this.routeTtl, () =>
      this.provider.buildRoute(request),
    );
  }
}
