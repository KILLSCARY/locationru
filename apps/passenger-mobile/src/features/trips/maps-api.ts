import {
  AddressSuggestionsResponseSchema,
  PricingEstimateSchema,
  ResolvedAddressResponseSchema,
  RouteRequestSchema,
  type AddressSuggestion,
  type GeoPoint,
  type PricingEstimate,
  type ResolvedAddress,
  type RouteRequest,
} from '@resilient-taxi/contracts';

import { api } from '@/api/client';

export async function searchAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  const response = await api<unknown>(
    `/maps/address-suggestions?query=${encodeURIComponent(query)}&limit=5`,
    { signal },
  );
  return AddressSuggestionsResponseSchema.parse(response).suggestions;
}

export async function geocodeSuggestion(
  suggestion: AddressSuggestion,
  signal?: AbortSignal,
): Promise<ResolvedAddress> {
  const response = await api<unknown>('/maps/geocode', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      address: suggestion.fullAddress,
      providerPlaceId: suggestion.providerPlaceId,
    }),
  });
  return ResolvedAddressResponseSchema.parse(response).address;
}

export async function reverseGeocode(
  point: GeoPoint,
  signal?: AbortSignal,
): Promise<ResolvedAddress> {
  const response = await api<unknown>('/maps/reverse-geocode', {
    method: 'POST',
    signal,
    body: JSON.stringify(point),
  });
  return ResolvedAddressResponseSchema.parse(response).address;
}

export async function estimatePrice(
  request: RouteRequest,
  signal?: AbortSignal,
): Promise<PricingEstimate> {
  const response = await api<unknown>('/pricing/estimate', {
    method: 'POST',
    signal,
    body: JSON.stringify(RouteRequestSchema.parse(request)),
  });
  return PricingEstimateSchema.parse(response);
}
