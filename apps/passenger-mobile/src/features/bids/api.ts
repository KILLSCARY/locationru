import { api } from '@/api/client';
import type { DriverBid, Trip } from '@/api/types';

export const getBids = (tripId: string) => api<DriverBid[]>(`/trips/${tripId}/bids`);

export const selectBid = (tripId: string, bidId: string) =>
  api<Pick<Trip, 'id' | 'status' | 'version'>>(`/trips/${tripId}/bids/${bidId}/select`, { method: 'POST' });
