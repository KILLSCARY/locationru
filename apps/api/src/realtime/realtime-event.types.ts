import { RealtimeEventType } from '../generated/prisma/client.js';

export const REALTIME_EVENT_NAME: Record<RealtimeEventType, string> = {
  [RealtimeEventType.TRIP_SEARCHING]: 'trip.searching',
  [RealtimeEventType.TRIP_UPDATED]: 'trip.updated',
  [RealtimeEventType.TRIP_CANCELLED]: 'trip.cancelled',
  [RealtimeEventType.BID_CREATED]: 'bid.created',
  [RealtimeEventType.BID_WITHDRAWN]: 'bid.withdrawn',
  [RealtimeEventType.BID_EXPIRED]: 'bid.expired',
  [RealtimeEventType.BID_ACCEPTED]: 'bid.accepted',
  [RealtimeEventType.DRIVER_LOCATION_UPDATED]: 'driver.location.updated',
  [RealtimeEventType.DRIVER_ARRIVED]: 'driver.arrived',
  [RealtimeEventType.TRIP_STARTED]: 'trip.started',
  [RealtimeEventType.TRIP_COMPLETED]: 'trip.completed',
};

export interface RealtimeEnvelope {
  eventId: string;
  eventType: RealtimeEventType;
  occurredAt: string;
  payload: unknown;
  room: string;
  sequence: number;
}

export const userRoom = (userId: string): string => `user:${userId}`;
export const tripRoom = (tripId: string): string => `trip:${tripId}`;
