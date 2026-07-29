import { api } from '@/api/client';
import type { AddressSuggestion, GeoPoint, RouteEstimate } from './types';

export type AddressSuggestionsParams = {
  query: string;
  bias?: GeoPoint;
  limit?: number;
  signal?: AbortSignal;
};

export const searchAddressSuggestions = ({
  query,
  bias,
  limit,
  signal,
}: AddressSuggestionsParams) => {
  const params = new URLSearchParams({ query });
  if (bias) {
    params.set('latitude', String(bias.latitude));
    params.set('longitude', String(bias.longitude));
  }
  if (limit) params.set('limit', String(limit));

  return api<{ suggestions: AddressSuggestion[]; provider: string }>(
    `/maps/address-suggestions?${params.toString()}`,
    { signal },
  );
};

export type RouteRequestInput = {
  origin: GeoPoint;
  destination: GeoPoint;
};

export const estimateRoute = (input: RouteRequestInput) =>
  api<RouteEstimate>('/routes/estimate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
