import { api } from '@/api/client';
import type { Trip } from '@/api/types';
import {
  CreateTripRequestSchema,
  CreateTripResponseSchema,
  GetTripResponseSchema,
  type CreateTripRequest,
} from '@resilient-taxi/contracts';

export type CreateTripInput = Omit<
  CreateTripRequest,
  'passengerPriceKopecks'
> & { passengerPriceKopecks: number };

export const createTrip = async (input: CreateTripInput) =>
  CreateTripResponseSchema.parse(
    await api<unknown>('/trips', {
      method: 'POST',
      headers: {
        'Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify(CreateTripRequestSchema.parse(input)),
    }),
  );

export const startSearch = (tripId: string) =>
  api<Pick<Trip, 'id' | 'status' | 'version'>>(
    `/trips/${tripId}/start-search`,
    { method: 'POST' },
  );

export const getTrip = async (tripId: string): Promise<Trip> =>
  GetTripResponseSchema.parse(await api<unknown>(`/trips/${tripId}`));
