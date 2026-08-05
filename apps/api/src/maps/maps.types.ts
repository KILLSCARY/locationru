/**
 * Provider-agnostic maps domain types. These mirror the wire contracts in
 * `@resilient-taxi/contracts` but are kept local so the API stays self-contained
 * (like the rest of `apps/api`, which does not import the contracts package).
 */

export type TransportMode = 'driving' | 'walking';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface AddressSuggestion {
  id: string;
  title: string;
  subtitle: string;
  fullAddress: string;
  location: GeoPoint | null;
  provider: string;
  providerPlaceId: string | null;
}

export interface AddressComponents {
  country: string | null;
  region: string | null;
  city: string | null;
  street: string | null;
  house: string | null;
  postalCode: string | null;
}

export interface ResolvedAddress {
  formattedAddress: string;
  location: GeoPoint;
  components: AddressComponents;
  provider: string;
  providerPlaceId: string | null;
}

export interface RouteWaypoint extends GeoPoint {
  sequence: number;
}

export interface RouteRequest {
  origin: GeoPoint;
  destination: GeoPoint;
  waypoints: RouteWaypoint[];
  transportMode: TransportMode;
  avoidTolls: boolean;
  avoidUnpavedRoads: boolean;
}

export interface GeoBounds {
  minLatitude: number;
  minLongitude: number;
  maxLatitude: number;
  maxLongitude: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoPoint[];
  encodedPolyline: string | null;
  bounds: GeoBounds;
  provider: string;
  providerRouteId: string | null;
  warnings: string[];
  snappedWaypoints: GeoPoint[];
}

export interface PricingEstimate {
  recommendedPriceKopecks: number;
  minimumSuggestedPriceKopecks: number;
  maximumSuggestedPriceKopecks: number;
  distanceMeters: number;
  durationSeconds: number;
}
