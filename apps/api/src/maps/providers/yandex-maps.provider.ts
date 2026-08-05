import { Logger } from '@nestjs/common';

import {
  boundsOf,
  haversineMeters,
  polylineLengthMeters,
} from '../geo/geo-math.js';
import type {
  AddressComponents,
  AddressSuggestion,
  GeoPoint,
  ResolvedAddress,
  RouteRequest,
  RouteResult,
} from '../maps.types.js';
import { MapsProviderError } from './maps-provider.errors.js';
import type {
  AddressSearchOptions,
  MapsProvider,
  MatchedLocation,
  PlaceDetails,
} from './maps-provider.interface.js';
import { ResilientHttpClient } from './resilient-http-client.js';

export const YANDEX_PROVIDER_NAME = 'yandex';

export interface YandexMapsProviderConfig {
  apiKey: string;
  apiBaseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  userAgent: string;
}

// Minimal shape of the Yandex Geocoder HTTP API JSON response we consume.
interface YandexGeocoderResponse {
  response?: {
    GeoObjectCollection?: {
      featureMember?: Array<{
        GeoObject?: {
          name?: string;
          description?: string;
          Point?: { pos?: string };
          metaDataProperty?: {
            GeocoderMetaData?: {
              text?: string;
              Address?: {
                postal_code?: string;
                Components?: Array<{ kind?: string; name?: string }>;
              };
            };
          };
        };
      }>;
    };
  };
}

const DRIVING_METERS_PER_SECOND = 8.5;
const ROUTE_WINDINGNESS = 1.3;

/**
 * Real maps adapter backed by Yandex — the geocoding provider best suited to
 * Russia and Saint Petersburg. Geocoding calls the Yandex Geocoder HTTP API and
 * parses its response; the API key lives only in configuration and is never sent
 * to the mobile clients.
 *
 * Routing follows the same scaffold-with-fallback convention as the dispatch
 * {@code HttpRouteEstimator}: wire a concrete routing API in {@link fetchRoute},
 * and until then routing degrades to a straight-line approximation carrying an
 * explicit warning, rather than failing the request.
 */
export class YandexMapsProvider implements MapsProvider {
  readonly name = YANDEX_PROVIDER_NAME;

  private readonly logger = new Logger(YandexMapsProvider.name);
  private readonly http: ResilientHttpClient;

  constructor(
    private readonly config: YandexMapsProviderConfig,
    http?: ResilientHttpClient,
  ) {
    this.http =
      http ??
      new ResilientHttpClient({
        provider: YANDEX_PROVIDER_NAME,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        userAgent: config.userAgent,
      });
  }

  async searchAddress(
    query: string,
    options?: AddressSearchOptions,
  ): Promise<AddressSuggestion[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 5, 10));
    const url = this.geocoderUrl({ geocode: query, results: limit });
    const parsed = await this.http.getJson<YandexGeocoderResponse>(url);
    return this.toSuggestions(parsed);
  }

  searchPlaces(
    query: string,
    options?: AddressSearchOptions,
  ): Promise<AddressSuggestion[]> {
    return this.searchAddress(query, options);
  }

  async getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
    const resolved = await this.geocodeAddress(placeId);
    if (!resolved) {
      return null;
    }
    return { ...resolved, title: resolved.formattedAddress };
  }

  async geocodeAddress(address: string): Promise<ResolvedAddress | null> {
    const url = this.geocoderUrl({ geocode: address, results: 1 });
    const parsed = await this.http.getJson<YandexGeocoderResponse>(url);
    return this.toResolved(parsed);
  }

  async reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<ResolvedAddress | null> {
    // Yandex expects "longitude,latitude" order for reverse geocoding.
    const url = this.geocoderUrl({
      geocode: `${longitude},${latitude}`,
      results: 1,
      kind: 'house',
    });
    const parsed = await this.http.getJson<YandexGeocoderResponse>(url);
    return this.toResolved(parsed);
  }

  buildRoute(request: RouteRequest): Promise<RouteResult> {
    return this.routeWithFallback(request);
  }

  estimateRoute(request: RouteRequest): Promise<RouteResult> {
    return this.routeWithFallback(request);
  }

  matchLocationToRoad(
    location: GeoPoint,
    _previousLocation?: GeoPoint,
  ): Promise<MatchedLocation> {
    void _previousLocation;
    return Promise.resolve({ location, confidence: 0.5 });
  }

  matchRoute(points: GeoPoint[]): Promise<GeoPoint[]> {
    return Promise.resolve(points);
  }

  private async routeWithFallback(request: RouteRequest): Promise<RouteResult> {
    try {
      return await this.fetchRoute(request);
    } catch (error) {
      if (
        error instanceof MapsProviderError &&
        error.kind === 'invalid_response'
      ) {
        this.logger.warn({
          event: 'maps.route_fallback',
          provider: YANDEX_PROVIDER_NAME,
        });
        return this.straightLineRoute(request);
      }
      throw error;
    }
  }

  /**
   * Concrete routing call. Not wired to a routing API yet — routing degrades to
   * {@link straightLineRoute}. Implement this against the chosen routing API to
   * return road geometry.
   */
  private fetchRoute(_request: RouteRequest): Promise<RouteResult> {
    void _request;
    return Promise.reject(
      MapsProviderError.invalidResponse(YANDEX_PROVIDER_NAME),
    );
  }

  private straightLineRoute(request: RouteRequest): RouteResult {
    const points: GeoPoint[] = [
      request.origin,
      ...request.waypoints
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((w) => ({ latitude: w.latitude, longitude: w.longitude })),
      request.destination,
    ];
    const distanceMeters = Math.max(
      1,
      Math.round(polylineLengthMeters(points) * ROUTE_WINDINGNESS),
    );
    const durationSeconds = Math.max(
      1,
      Math.round(distanceMeters / DRIVING_METERS_PER_SECOND),
    );
    return {
      distanceMeters,
      durationSeconds,
      geometry: points,
      encodedPolyline: null,
      bounds: boundsOf(points),
      provider: YANDEX_PROVIDER_NAME,
      providerRouteId: null,
      warnings: [
        'route geometry is a straight-line approximation; wire a routing API for road geometry',
      ],
      snappedWaypoints: request.waypoints.map((w) => ({
        latitude: w.latitude,
        longitude: w.longitude,
      })),
    };
  }

  private geocoderUrl(params: {
    geocode: string;
    results: number;
    kind?: string;
  }): string {
    const url = new URL('/1.x/', this.config.apiBaseUrl);
    url.searchParams.set('apikey', this.config.apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('lang', 'ru_RU');
    url.searchParams.set('geocode', params.geocode);
    url.searchParams.set('results', String(params.results));
    if (params.kind) {
      url.searchParams.set('kind', params.kind);
    }
    return url.toString();
  }

  private toSuggestions(parsed: YandexGeocoderResponse): AddressSuggestion[] {
    const members = parsed.response?.GeoObjectCollection?.featureMember ?? [];
    return members.map((member, index) => {
      const geoObject = member.GeoObject ?? {};
      const location = this.parsePoint(geoObject.Point?.pos);
      const text =
        geoObject.metaDataProperty?.GeocoderMetaData?.text ??
        geoObject.name ??
        '';
      return {
        id: `${YANDEX_PROVIDER_NAME}:${index}:${text}`.slice(0, 256),
        title: geoObject.name ?? text,
        subtitle: geoObject.description ?? '',
        fullAddress: text || geoObject.name || '',
        location,
        provider: YANDEX_PROVIDER_NAME,
        providerPlaceId: null,
      };
    });
  }

  private toResolved(parsed: YandexGeocoderResponse): ResolvedAddress | null {
    const member =
      parsed.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    if (!member) {
      return null;
    }
    const location = this.parsePoint(member.Point?.pos);
    if (!location) {
      return null;
    }
    const meta = member.metaDataProperty?.GeocoderMetaData;
    return {
      formattedAddress: meta?.text ?? member.name ?? '',
      location,
      components: this.parseComponents(
        meta?.Address?.Components ?? [],
        meta?.Address?.postal_code ?? null,
      ),
      provider: YANDEX_PROVIDER_NAME,
      providerPlaceId: null,
    };
  }

  private parseComponents(
    components: Array<{ kind?: string; name?: string }>,
    postalCode: string | null,
  ): AddressComponents {
    const pick = (kind: string): string | null =>
      components.find((c) => c.kind === kind)?.name ?? null;
    return {
      country: pick('country'),
      region: pick('province'),
      city: pick('locality'),
      street: pick('street'),
      house: pick('house'),
      postalCode,
    };
  }

  /** Yandex points are "longitude latitude" strings. */
  private parsePoint(pos: string | undefined): GeoPoint | null {
    if (!pos) {
      return null;
    }
    const [lon, lat] = pos.split(' ').map(Number);
    if (
      lon === undefined ||
      lat === undefined ||
      Number.isNaN(lon) ||
      Number.isNaN(lat)
    ) {
      return null;
    }
    return { latitude: lat, longitude: lon };
  }
}

/** Straight-line distance helper re-exported for pricing/dispatch reuse. */
export { haversineMeters };
