import { io, type Socket } from 'socket.io-client';
import { API_URL } from './client';

export function connectRealtime(
  accessToken: string,
  onTripChanged: () => void,
): Socket {
  const baseUrl = API_URL.replace(/\/api\/v1\/?$/, '');
  const socket = io(`${baseUrl}/realtime`, {
    auth: { token: accessToken },
    transports: ['websocket'],
  });
  [
    'trip.searching',
    'trip.updated',
    'trip.cancelled',
    'bid.created',
    'bid.withdrawn',
    'bid.expired',
    'bid.accepted',
  ].forEach((event) => {
    socket.on(event, onTripChanged);
  });
  return socket;
}
