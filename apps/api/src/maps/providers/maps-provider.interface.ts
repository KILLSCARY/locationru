import type {
  AddressSuggestion,
  GeoPoint,
  ResolvedAddress,
  RouteRequest,
  RouteResult,
} from '../maps.types.js';

/**
 * Provider-agnostic maps contracts. Business logic depends on these interfaces
 * only — never on a concrete maps SDK. Concrete adapters (development, Yandex,
 * …) implement them and are selected by {@link createMapsProvider}.
 */

export interface AddressSearchOptions {
  biasLocation?: GeoPoint | undefined;
  limit?: number | undefined;
}

export interface GeocodingProvider {
  readonly name: string;
  searchAddress(
    query: string,
    options?: AddressSearchOptions,
  ): Promise<AddressSuggestion[]>;
  geocodeAddress(address: string): Promise<ResolvedAddress | null>;
  reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<ResolvedAddress | null>;
}

export interface RoutingProvider {
  readonly name: string;
  buildRoute(request: RouteRequest): Promise<RouteResult>;
  estimateRoute(request: RouteRequest): Promise<RouteResult>;
}

export interface MatchedLocation {
  location: GeoPoint;
  /** 0..1 confidence that the point was snapped to the correct road. */
  confidence: number;
}

export interface MapMatchingProvider {
  readonly name: string;
  matchLocationToRoad(
    location: GeoPoint,
    previousLocation?: GeoPoint,
  ): Promise<MatchedLocation>;
  matchRoute(points: GeoPoint[]): Promise<GeoPoint[]>;
}

export interface PlaceDetails extends ResolvedAddress {
  title: string;
}

export interface PlacesProvider {
  readonly name: string;
  searchPlaces(
    query: string,
    options?: AddressSearchOptions,
  ): Promise<AddressSuggestion[]>;
  getPlaceDetails(placeId: string): Promise<PlaceDetails | null>;
}

/**
 * A single object implements every capability so the factory can wire one
 * adapter per environment. Splitting the interfaces keeps call sites honest
 * about which capability they use.
 */
export interface MapsProvider
  extends
    GeocodingProvider,
    RoutingProvider,
    MapMatchingProvider,
    PlacesProvider {
  readonly name: string;
}

export const MAPS_PROVIDER = Symbol('MAPS_PROVIDER');
