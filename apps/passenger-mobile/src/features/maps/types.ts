export type GeoPoint = { latitude: number; longitude: number };

export type AddressSuggestion = {
  id: string;
  title: string;
  subtitle: string;
  fullAddress: string;
  location: GeoPoint | null;
  provider: string;
  providerPlaceId: string | null;
};

export type ResolvedAddress = {
  formattedAddress: string;
  location: GeoPoint;
  provider: string;
  providerPlaceId: string | null;
};

export type RouteEstimate = {
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
};

export type GeoBounds = {
  minLatitude: number;
  minLongitude: number;
  maxLatitude: number;
  maxLongitude: number;
};

export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoPoint[];
  encodedPolyline: string | null;
  bounds: GeoBounds;
  provider: string;
  providerRouteId: string | null;
  warnings: string[];
  snappedWaypoints: GeoPoint[];
};

export type PricingEstimate = {
  recommendedPriceKopecks: number;
  minimumSuggestedPriceKopecks: number;
  maximumSuggestedPriceKopecks: number;
  distanceMeters: number;
  durationSeconds: number;
};
