import { WsException } from '@nestjs/websockets';
import { jest } from '@jest/globals';
import type { Socket } from 'socket.io';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeAuthorizationService } from './realtime-authorization.service.js';
import { RealtimeOutboxService } from './realtime-outbox.service.js';

const passenger: AuthenticatedUser = {
  id: 'passenger-1',
  phone: '+79990000001',
  role: 'PASSENGER',
  sessionId: 'session-1',
};

function createSocket(token = 'valid-token'): {
  client: Socket;
  disconnect: jest.Mock;
  emit: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
} {
  const join = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
  const leave = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
  const emit = jest.fn();
  const disconnect = jest.fn();

  return {
    client: {
      data: {},
      disconnect,
      emit,
      handshake: { auth: { token }, headers: {} },
      join,
      leave,
    } as unknown as Socket,
    disconnect,
    emit,
    join,
    leave,
  };
}

describe('RealtimeGateway', () => {
  let authorization: {
    authenticate: jest.Mock;
    canJoinTripRoom: jest.Mock;
  };
  let outbox: {
    attachPublisher: jest.Mock;
    getDeliveredEventsAfter: jest.Mock;
    getLastSequence: jest.Mock;
  };
  let gateway: RealtimeGateway;

  beforeEach(() => {
    authorization = {
      authenticate: jest.fn().mockResolvedValue(passenger),
      canJoinTripRoom: jest.fn(),
    };
    outbox = {
      attachPublisher: jest.fn(),
      getDeliveredEventsAfter: jest.fn().mockResolvedValue([]),
      getLastSequence: jest.fn().mockResolvedValue(4),
    };
    gateway = new RealtimeGateway(
      authorization as unknown as RealtimeAuthorizationService,
      outbox as unknown as RealtimeOutboxService,
    );
  });

  it('authenticates a socket, joins only its personal room and returns the sequence', async () => {
    const socket = createSocket();

    await gateway.handleConnection(socket.client);

    expect(authorization.authenticate).toHaveBeenCalledWith('valid-token');
    expect(socket.join).toHaveBeenCalledWith('user:passenger-1');
    expect(socket.emit).toHaveBeenCalledWith('realtime.ready', {
      room: 'user:passenger-1',
      sequence: 4,
    });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('rejects a socket with an invalid access token', async () => {
    authorization.authenticate.mockRejectedValue(new Error('invalid token'));
    const socket = createSocket('invalid-token');

    await gateway.handleConnection(socket.client);

    expect(socket.emit).toHaveBeenCalledWith('realtime.error', {
      code: 'INVALID_ACCESS_TOKEN',
    });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('does not allow a passenger to join or replay a foreign trip room', async () => {
    authorization.canJoinTripRoom.mockResolvedValue(false);
    const socket = createSocket();
    (socket.client.data as { user: AuthenticatedUser }).user = passenger;

    await expect(
      gateway.joinTripRoom(socket.client, { tripId: 'foreign-trip' }),
    ).rejects.toThrow(new WsException('TRIP_ROOM_ACCESS_DENIED'));
    await expect(
      gateway.replay(socket.client, {
        afterSequence: 0,
        room: 'trip:foreign-trip',
      }),
    ).rejects.toThrow(new WsException('ROOM_ACCESS_DENIED'));

    expect(socket.join).not.toHaveBeenCalled();
    expect(outbox.getDeliveredEventsAfter).not.toHaveBeenCalled();
  });

  it('allows an authorized passenger to join only their trip room', async () => {
    authorization.canJoinTripRoom.mockResolvedValue(true);
    const socket = createSocket();
    (socket.client.data as { user: AuthenticatedUser }).user = passenger;

    await expect(
      gateway.joinTripRoom(socket.client, { tripId: 'own-trip' }),
    ).resolves.toEqual({ room: 'trip:own-trip', sequence: 4 });

    expect(socket.join).toHaveBeenCalledWith('trip:own-trip');
  });
});
