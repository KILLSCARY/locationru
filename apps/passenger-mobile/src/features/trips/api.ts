import { api } from '@/api/client';
import type { Trip } from '@/api/types';

export type CreateTripInput = {
  pickup: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  pickupAddress: string;
  destinationAddress: string;
  passengerPriceKopecks: number;
};

export const createTrip = (input: CreateTripInput) =>
  api<Pick<Trip, 'id' | 'status' | 'version'>>('/trips', {
    method: 'POST',
    headers: { 'Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2)}` },
    body: JSON.stringify(input),
  });

export const startSearch = (tripId: string) =>
  api<Pick<Trip, 'id' | 'status' | 'version'>>(`/trips/${tripId}/start-search`, { method: 'POST' });

export const getTrip = (tripId: string) => api<Trip>(`/trips/${tripId}`);
