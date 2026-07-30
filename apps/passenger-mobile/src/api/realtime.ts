import { io, type Socket } from 'socket.io-client';
import { RoomSequenceTracker } from '@/maps/eventSequence';
import { useSessionStore } from '@/store/session';
import { API_URL } from './client';

export type RealtimeEnvelope<TPayload = unknown> = {
  eventId: string;
  occurredAt: string;
  room: string;
  sequence: number;
  payload: TPayload;
};

export const TRIP_ROOM_EVENT_NAMES = [
  'trip.searching',
  'trip.updated',
  'trip.cancelled',
  'bid.created',
  'bid.withdrawn',
  'bid.expired',
  'bid.accepted',
  'driver.location.updated',
  'driver.arrived',
  'trip.started',
  'trip.completed',
] as const;

export type TripRoomEventName = (typeof TRIP_ROOM_EVENT_NAMES)[number];

/** Mirrors the backend's REALTIME_EVENT_NAME map — needed to resolve the event
 * name of a *replayed* event, which the server only tags with `eventType`. */
const EVENT_NAME_BY_TYPE: Record<string, TripRoomEventName> = {
  TRIP_SEARCHING: 'trip.searching',
  TRIP_UPDATED: 'trip.updated',
  TRIP_CANCELLED: 'trip.cancelled',
  BID_CREATED: 'bid.created',
  BID_WITHDRAWN: 'bid.withdrawn',
  BID_EXPIRED: 'bid.expired',
  BID_ACCEPTED: 'bid.accepted',
  DRIVER_LOCATION_UPDATED: 'driver.location.updated',
  DRIVER_ARRIVED: 'driver.arrived',
  TRIP_STARTED: 'trip.started',
  TRIP_COMPLETED: 'trip.completed',
};

type ReplayedEnvelope = RealtimeEnvelope & { eventType: string };

export type TripRoomHandlers = Partial<
  Record<
    TripRoomEventName,
    (payload: unknown, envelope: RealtimeEnvelope) => void
  >
>;

export type RoomSubscription = {
  unsubscribe: () => void;
};

// Single shared connection for the whole app — screens subscribe/unsubscribe
// to rooms on this one socket instead of each opening their own.
let socket: Socket | null = null;

function getSocket(): Socket {
  if (socket) return socket;

  const baseUrl = API_URL.replace(/\/api\/v1\/?$/, '');
  socket = io(`${baseUrl}/realtime`, {
    // A function (not a static object) so socket.io re-reads the access token
    // fresh on every (re)connection attempt, picking up a token refreshed
    // after the socket was first opened.
    auth: (callback) =>
      callback({ token: useSessionStore.getState().accessToken ?? '' }),
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 15_000,
    randomizationFactor: 0.5,
  });
  return socket;
}

/** Closes the shared connection — call on sign-out. */
export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}

/**
 * Joins a trip room and dispatches its events through a per-room
 * RoomSequenceTracker. A detected sequence gap triggers `events.replay` over
 * the same socket (no second connection, no separate REST resync endpoint —
 * the backend already exposes this via its outbox) to fetch the missed
 * events, applies them in order, then resumes live dispatch.
 */
export function subscribeToTripRoom(
  tripId: string,
  handlers: TripRoomHandlers,
): RoomSubscription {
  const client = getSocket();
  const room = `trip:${tripId}`;
  const tracker = new RoomSequenceTracker(0);
  let resyncing = false;
  let joined = false;

  const applyEnvelope = (
    name: TripRoomEventName,
    envelope: RealtimeEnvelope,
  ) => {
    handlers[name]?.(envelope.payload, envelope);
  };

  const resync = (
    finalName: TripRoomEventName,
    finalEnvelope: RealtimeEnvelope,
  ) => {
    if (resyncing) return;
    resyncing = true;
    client.emit(
      'events.replay',
      { room, afterSequence: tracker.current },
      (response: { events: ReplayedEnvelope[] }) => {
        for (const envelope of response?.events ?? []) {
          const name = EVENT_NAME_BY_TYPE[envelope.eventType];
          if (name) applyEnvelope(name, envelope);
          tracker.fastForwardTo(envelope.sequence);
        }
        if (finalEnvelope.sequence > tracker.current) {
          tracker.fastForwardTo(finalEnvelope.sequence);
          applyEnvelope(finalName, finalEnvelope);
        }
        resyncing = false;
      },
    );
  };

  const listeners = TRIP_ROOM_EVENT_NAMES.map((name) => {
    const listener = (envelope: RealtimeEnvelope) => {
      if (!joined || resyncing) return;
      const outcome = tracker.observe(envelope.sequence);
      if (outcome.type === 'duplicate_or_old') return;
      if (outcome.type === 'apply') {
        applyEnvelope(name, envelope);
        return;
      }
      resync(name, envelope);
    };
    client.on(name, listener);
    return { name, listener };
  });

  client.emit(
    'room.join',
    { tripId },
    (response: { sequence: number } | undefined) => {
      tracker.fastForwardTo(response?.sequence ?? 0);
      joined = true;
    },
  );

  return {
    unsubscribe: () => {
      for (const { name, listener } of listeners) client.off(name, listener);
      client.emit('room.leave', { tripId });
    },
  };
}
