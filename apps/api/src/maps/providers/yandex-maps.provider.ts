import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AddressSuggestion,
  GeoPoint,
  ResolvedAddress,
  RouteRequest,
  RouteResult,
} from '@resilient-taxi/contracts';

import type { MapsProvider } from '../maps.types.js';
import { MapsProviderError } from '../maps.types.js';
import { routeBounds } from '../maps.utils.js';

type FetchLike = typeof fetch;

interface YandexGeoObject {
  uri?: string;
  name?: string;
  description?: string;
  Point?: { pos?: string };
  metaDataProperty?: {
    GeocoderMetaData?: {
      text?: string;
      Address?: {
        formatted?: string;
        Components?: Array<{ kind?: string; name?: string }>;
      };
    };
  };
}

interface YandexGeocoderResponse {
  response?: {
    GeoObjectCollection?: {
      featureMember?: Array<{ GeoObject?: YandexGeoObject }>;
    };
  };
}

interface YandexRouterResponse {
  route?: { legs?: Array<{ status?: string; steps?: YandexRouteStep[] }> };
  errors?: string[];
}

interface YandexRouteStep {
  duration?: number;
  length?: number;
  polyline?: { points?: number[][] };
}

@Injectable()
export class YandexMapsProvider implements MapsProvider {
  readonly name = 'yandex';
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private readonly fetcher: FetchLike;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject('MAPS_FETCH') fetcher?: FetchLike,
  ) {
    this.fetcher = fetcher ?? fetch;
  }

  async searchAddress(
    query: string,
    bias?: GeoPoint,
    limit = 5,
  ): Promise<AddressSuggestion[]> {
    const objects = await this.geocodeObjects(query, limit, bias);
    return objects.map((object, index) => {
      const resolved = parseGeoObject(object);
      return {
        id:
          object.uri ??
          resolved.providerPlaceId ??
          `yandex:${index}:${resolved.formattedAddress}`,
        title: object.name ?? resolved.formattedAddress,
        subtitle: object.description ?? null,
        fullAddress: resolved.formattedAddress,
        location: resolved.location,
        provider: this.name,
        providerPlaceId: object.uri ?? null,
      };
    });
  }

  async geocodeAddress(
    address: string,
    providerPlaceId?: string | null,
  ): Promise<ResolvedAddress> {
    const objects = await this.geocodeObjects(providerPlaceId ?? address, 1);
    const object = objects[0];
    if (!object)
      throw new MapsProviderError('NOT_FOUND', 'Address was not found', false);
    return parseGeoObject(object);
  }

  async reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<ResolvedAddress> {
    const objects = await this.geocodeObjects(`${longitude},${latitude}`, 1);
    const object = objects[0];
    if (!object)
      throw new MapsProviderError('NOT_FOUND', 'Address was not found', false);
    return parseGeoObject(object);
  }

  async buildRoute(request: RouteRequest): Promise<RouteResult> {
    const apiKey = this.apiKey();
    const endpoint =
      this.config.get<string>('maps.routingApiUrl') ??
      'https://api.routing.yandex.net/v2/route';
    const points = [request.origin, ...request.waypoints, request.destination];
    const url = new URL(endpoint);
    url.searchParams.set('apikey', apiKey);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set(
      'waypoints',
      points.map((point) => `${point.latitude},${point.longitude}`).join('|'),
    );
    url.searchParams.set('avoid_tolls', String(request.avoidTolls));
    url.searchParams.set('avoid_unpaved', String(request.avoidUnpavedRoads));
    const response = await this.requestJson<YandexRouterResponse>(url);
    const legs = response.route?.legs ?? [];
    const steps = legs.flatMap((leg) => leg.steps ?? []);
    if (
      !steps.length ||
      legs.some((leg) => leg.status && leg.status !== 'OK')
    ) {
      throw new MapsProviderError(
        'INVALID_RESPONSE',
        'Routing provider returned no route',
        false,
      );
    }
    const geometryPoints = steps.flatMap((step) => step.polyline?.points ?? []);
    const coordinates = deduplicateCoordinates(geometryPoints).map((point) => {
      if (
        point.length < 2 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1])
      ) {
        throw new MapsProviderError(
          'INVALID_RESPONSE',
          'Routing provider returned invalid geometry',
          false,
        );
      }
      return [point[0]!, point[1]!] as [number, number];
    });
    if (coordinates.length < 2) {
      throw new MapsProviderError(
        'INVALID_RESPONSE',
        'Routing provider returned incomplete geometry',
        false,
      );
    }
    const snappedWaypoints = points;
    return {
      distanceMeters: Math.round(
        steps.reduce((total, step) => total + (step.length ?? 0), 0),
      ),
      durationSeconds: Math.round(
        steps.reduce((total, step) => total + (step.duration ?? 0), 0),
      ),
      geometry: { type: 'LineString', coordinates },
      encodedPolyline: null,
      bounds: routeBounds(
        coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
      ),
      snappedWaypoints,
      provider: this.name,
      providerRouteId: null,
      warnings: [],
    };
  }

  estimateRoute(request: RouteRequest): Promise<RouteResult> {
    return this.buildRoute(request);
  }

  async matchLocationToRoad(point: GeoPoint): Promise<GeoPoint> {
    return point;
  }

  async matchRoute(points: GeoPoint[]): Promise<GeoPoint[]> {
    return points;
  }

  searchPlaces(
    query: string,
    bias?: GeoPoint,
    limit?: number,
  ): Promise<AddressSuggestion[]> {
    return this.searchAddress(query, bias, limit);
  }

  getPlaceDetails(providerPlaceId: string): Promise<ResolvedAddress> {
    return this.geocodeAddress(providerPlaceId, providerPlaceId);
  }

  private async geocodeObjects(
    query: string,
    limit: number,
    bias?: GeoPoint,
  ): Promise<YandexGeoObject[]> {
    const endpoint =
      this.config.get<string>('maps.apiUrl') ??
      'https://geocode-maps.yandex.ru/v1/';
    const url = new URL(endpoint);
    url.searchParams.set('apikey', this.apiKey());
    url.searchParams.set('geocode', query);
    url.searchParams.set('lang', 'ru_RU');
    url.searchParams.set('format', 'json');
    url.searchParams.set('results', String(Math.min(10, Math.max(1, limit))));
    if (bias) url.searchParams.set('ll', `${bias.longitude},${bias.latitude}`);
    const response = await this.requestJson<YandexGeocoderResponse>(url);
    return (
      response.response?.GeoObjectCollection?.featureMember
        ?.map((member) => member.GeoObject)
        .filter((object): object is YandexGeoObject => Boolean(object)) ?? []
    );
  }

  private apiKey(): string {
    const apiKey = this.config.get<string>('maps.apiKey');
    if (!apiKey)
      throw new MapsProviderError(
        'UNAVAILABLE',
        'Maps provider is not configured',
        false,
      );
    return apiKey;
  }

  private async requestJson<T>(url: URL): Promise<T> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new MapsProviderError(
        'UNAVAILABLE',
        'Maps provider circuit is open',
        true,
      );
    }
    const attempts = this.config.get<number>('maps.retryAttempts') ?? 2;
    const timeoutMs = this.config.get<number>('maps.timeoutMs') ?? 3_000;
    let lastError: MapsProviderError | undefined;
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetcher(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'ResilientTaxi/0.1 maps-adapter',
          },
          signal: controller.signal,
        });
        if (response.status === 429) {
          lastError = new MapsProviderError(
            'RATE_LIMITED',
            'Maps provider rate limit exceeded',
            true,
          );
        } else if (response.status >= 500) {
          lastError = new MapsProviderError(
            'UNAVAILABLE',
            'Maps provider is temporarily unavailable',
            true,
          );
        } else if (!response.ok) {
          throw new MapsProviderError(
            'UNAVAILABLE',
            `Maps provider rejected the request (${response.status})`,
            false,
          );
        } else {
          const result = (await response.json()) as T;
          this.consecutiveFailures = 0;
          return result;
        }
      } catch (error) {
        if (error instanceof MapsProviderError) {
          if (!error.retryable) throw error;
          lastError = error;
        } else if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          lastError = new MapsProviderError(
            'TIMEOUT',
            'Maps provider request timed out',
            true,
          );
        } else {
          lastError = new MapsProviderError(
            'UNAVAILABLE',
            'Maps provider request failed',
            true,
          );
        }
      } finally {
        clearTimeout(timer);
      }
      if (attempt < attempts)
        await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
    this.consecutiveFailures += 1;
    const threshold =
      this.config.get<number>('maps.circuitBreakerThreshold') ?? 5;
    if (this.consecutiveFailures >= threshold) {
      this.circuitOpenUntil =
        Date.now() +
        (this.config.get<number>('maps.circuitBreakerResetMs') ?? 30_000);
    }
    throw (
      lastError ??
      new MapsProviderError('UNAVAILABLE', 'Maps provider request failed', true)
    );
  }
}

export function parseGeoObject(object: YandexGeoObject): ResolvedAddress {
  const position = object.Point?.pos?.trim().split(/\s+/).map(Number);
  if (
    !position ||
    position.length !== 2 ||
    position.some((value) => !Number.isFinite(value))
  ) {
    throw new MapsProviderError(
      'INVALID_RESPONSE',
      'Geocoder returned invalid coordinates',
      false,
    );
  }
  const metadata = object.metaDataProperty?.GeocoderMetaData;
  const formattedAddress =
    metadata?.Address?.formatted ?? metadata?.text ?? object.name;
  if (!formattedAddress)
    throw new MapsProviderError(
      'INVALID_RESPONSE',
      'Geocoder returned no address',
      false,
    );
  const components = Object.fromEntries(
    (metadata?.Address?.Components ?? []).map((component) => [
      component.kind,
      component.name,
    ]),
  );
  return {
    formattedAddress,
    location: { longitude: position[0]!, latitude: position[1]! },
    providerPlaceId: object.uri ?? null,
    provider: 'yandex',
    components: {
      country: components.country ?? null,
      region: components.province ?? components.area ?? null,
      city: components.locality ?? null,
      district: components.district ?? null,
      street: components.street ?? null,
      house: components.house ?? null,
      postalCode: components.postal_code ?? null,
    },
  };
}

function deduplicateCoordinates(points: number[][]): number[][] {
  return points.filter(
    (point, index) =>
      index === 0 ||
      point[0] !== points[index - 1]?.[0] ||
      point[1] !== points[index - 1]?.[1],
  );
}
