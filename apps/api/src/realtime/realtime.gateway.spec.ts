import { WsException } from '@nestjs/websockets';
import { jest } from '@jest/globals';
import type { Socket } from 'socket.io';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeAuthorizationService } from './realtime-authorization.service.js';
import { RealtimeOutboxService } from './realtime-outbox.service.js';
import { RedisService } from '../redis/redis.service.js';

const passenger: AuthenticatedUser = {
  id: 'passenger-1',
  phone: '+79990000001',
  role: 'PASSENGER',
  sessionId: 'session-1',
};

function createSocket(
  token = 'valid-token',
  options: { id?: string; origin?: string } = {},
): {
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
      id: options.id ?? 'socket-1',
      data: {},
      disconnect,
      emit,
      handshake: {
        auth: { token },
        headers: options.origin ? { origin: options.origin } : {},
      },
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
  let redis: { increment: jest.Mock; setExpiry: jest.Mock };
  let configValues: Record<string, unknown>;
  let configService: { getOrThrow: jest.Mock };
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
    redis = {
      increment: jest.fn().mockResolvedValue(1),
      setExpiry: jest.fn().mockResolvedValue(undefined),
    };
    configValues = {
      'websocket.allowedOrigins': [],
      'websocket.maxConnectionsPerUser': 10,
      'websocket.eventRateLimitPerMinute': 300,
    };
    configService = {
      getOrThrow: jest.fn((key: string) => configValues[key]),
    };
    gateway = new RealtimeGateway(
      authorization as unknown as RealtimeAuthorizationService,
      outbox as unknown as RealtimeOutboxService,
      configService as never,
      redis as unknown as RedisService,
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

  it('rejects a connection from a disallowed origin', async () => {
    configValues['websocket.allowedOrigins'] = ['https://app.example.com'];
    const socket = createSocket('valid-token', {
      origin: 'https://evil.example.com',
    });

    await gateway.handleConnection(socket.client);

    expect(authorization.authenticate).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('allows a connection whose origin is in the allow-list', async () => {
    configValues['websocket.allowedOrigins'] = ['https://app.example.com'];
    const socket = createSocket('valid-token', {
      origin: 'https://app.example.com',
    });

    await gateway.handleConnection(socket.client);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith('user:passenger-1');
  });

  it('rejects a new connection once the per-user connection limit is exceeded', async () => {
    configValues['websocket.maxConnectionsPerUser'] = 1;
    const first = createSocket('valid-token', { id: 'socket-a' });
    await gateway.handleConnection(first.client);

    const second = createSocket('valid-token', { id: 'socket-b' });
    authorization.authenticate.mockResolvedValue({
      ...passenger,
      sessionId: 'session-2',
    });
    await gateway.handleConnection(second.client);

    expect(second.emit).toHaveBeenCalledWith('realtime.error', {
      code: 'TOO_MANY_CONNECTIONS',
    });
    expect(second.disconnect).toHaveBeenCalledWith(true);
  });

  it('evicts the previous socket when the same session reconnects', async () => {
    const first = createSocket('valid-token', { id: 'socket-a' });
    await gateway.handleConnection(first.client);

    const second = createSocket('valid-token', { id: 'socket-b' });
    await gateway.handleConnection(second.client);

    expect(second.disconnect).not.toHaveBeenCalled();
  });

  it('cleans up connection tracking on disconnect', async () => {
    configValues['websocket.maxConnectionsPerUser'] = 1;
    const first = createSocket('valid-token', { id: 'socket-a' });
    await gateway.handleConnection(first.client);

    gateway.handleDisconnect(first.client);

    const second = createSocket('valid-token', { id: 'socket-b' });
    authorization.authenticate.mockResolvedValue({
      ...passenger,
      sessionId: 'session-2',
    });
    await gateway.handleConnection(second.client);

    expect(second.disconnect).not.toHaveBeenCalled();
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

  it('rate-limits events once the per-minute threshold is exceeded', async () => {
    configValues['websocket.eventRateLimitPerMinute'] = 2;
    redis.increment
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    authorization.canJoinTripRoom.mockResolvedValue(true);
    const socket = createSocket();
    (socket.client.data as { user: AuthenticatedUser }).user = passenger;

    await gateway.joinTripRoom(socket.client, { tripId: 'own-trip' });
    await gateway.joinTripRoom(socket.client, { tripId: 'own-trip' });

    await expect(
      gateway.joinTripRoom(socket.client, { tripId: 'own-trip' }),
    ).rejects.toThrow(new WsException('RATE_LIMITED'));
  });

  it('fails open on a rate-limit check when Redis is unavailable', async () => {
    redis.increment.mockRejectedValue(new Error('ECONNREFUSED'));
    authorization.canJoinTripRoom.mockResolvedValue(true);
    const socket = createSocket();
    (socket.client.data as { user: AuthenticatedUser }).user = passenger;

    await expect(
      gateway.joinTripRoom(socket.client, { tripId: 'own-trip' }),
    ).resolves.toEqual({ room: 'trip:own-trip', sequence: 4 });
  });
});
