import type {
  AddressSuggestion,
  GeoPoint,
  ResolvedAddress,
  RouteRequest,
  RouteResult,
} from '@resilient-taxi/contracts';

export interface GeocodingProvider {
  readonly name: string;
  searchAddress(
    query: string,
    bias?: GeoPoint,
    limit?: number,
  ): Promise<AddressSuggestion[]>;
  geocodeAddress(
    address: string,
    providerPlaceId?: string | null,
  ): Promise<ResolvedAddress>;
  reverseGeocode(latitude: number, longitude: number): Promise<ResolvedAddress>;
}

export interface RoutingProvider {
  readonly name: string;
  buildRoute(request: RouteRequest): Promise<RouteResult>;
  estimateRoute(request: RouteRequest): Promise<RouteResult>;
}

export interface MapMatchingProvider {
  matchLocationToRoad(
    point: GeoPoint,
    previousLocation?: GeoPoint,
  ): Promise<GeoPoint>;
  matchRoute(points: GeoPoint[]): Promise<GeoPoint[]>;
}

export interface PlacesProvider {
  searchPlaces(
    query: string,
    bias?: GeoPoint,
    limit?: number,
  ): Promise<AddressSuggestion[]>;
  getPlaceDetails(providerPlaceId: string): Promise<ResolvedAddress>;
}

export type MapsProvider = GeocodingProvider &
  RoutingProvider &
  MapMatchingProvider &
  PlacesProvider;

export type MapsProviderErrorCode =
  | 'INVALID_RESPONSE'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UNAVAILABLE';

export class MapsProviderError extends Error {
  constructor(
    readonly code: MapsProviderErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MapsProviderError';
  }
}
