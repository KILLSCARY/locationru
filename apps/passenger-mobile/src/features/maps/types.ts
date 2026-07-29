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

export type PricingEstimate = {
  recommendedPriceKopecks: number;
  minimumSuggestedPriceKopecks: number;
  maximumSuggestedPriceKopecks: number;
  distanceMeters: number;
  durationSeconds: number;
};
