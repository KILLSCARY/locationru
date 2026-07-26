import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  REALTIME_EVENT_NAME,
  tripRoom,
  userRoom,
} from './realtime-event.types.js';
import { RealtimeAuthorizationService } from './realtime-authorization.service.js';
import { RealtimeOutboxService } from './realtime-outbox.service.js';

interface RoomJoinPayload {
  tripId?: string;
}

interface ReplayPayload {
  afterSequence?: number;
  room?: string;
}

interface RealtimeSocketData {
  user?: AuthenticatedUser;
}

@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayInit {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly authorization: RealtimeAuthorizationService,
    private readonly outbox: RealtimeOutboxService,
  ) {}

  afterInit(): void {
    this.outbox.attachPublisher(async (event) => {
      this.server
        .to(event.room)
        .emit(REALTIME_EVENT_NAME[event.eventType], event);
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.authorization.authenticate(
        this.getAccessToken(client),
      );
      this.data(client).user = user;
      const room = userRoom(user.id);
      await client.join(room);
      client.emit('realtime.ready', {
        room,
        sequence: await this.outbox.getLastSequence(room),
      });
    } catch {
      client.emit('realtime.error', { code: 'INVALID_ACCESS_TOKEN' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('room.join')
  async joinTripRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: RoomJoinPayload,
  ): Promise<{ room: string; sequence: number }> {
    const user = this.requireUser(client);
    const tripId = body?.tripId;
    if (!tripId || !(await this.authorization.canJoinTripRoom(user, tripId))) {
      throw new WsException('TRIP_ROOM_ACCESS_DENIED');
    }

    const room = tripRoom(tripId);
    await client.join(room);
    return { room, sequence: await this.outbox.getLastSequence(room) };
  }

  @SubscribeMessage('room.leave')
  async leaveTripRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: RoomJoinPayload,
  ): Promise<{ room: string }> {
    const user = this.requireUser(client);
    const tripId = body?.tripId;
    if (!tripId || !(await this.authorization.canJoinTripRoom(user, tripId))) {
      throw new WsException('TRIP_ROOM_ACCESS_DENIED');
    }

    const room = tripRoom(tripId);
    await client.leave(room);
    return { room };
  }

  @SubscribeMessage('events.replay')
  async replay(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ReplayPayload,
  ): Promise<{ events: unknown[]; room: string }> {
    const user = this.requireUser(client);
    const room = body?.room;
    const afterSequence = body?.afterSequence ?? 0;
    if (!room || !Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new WsException('INVALID_REPLAY_REQUEST');
    }
    await this.assertRoomAccess(user, room);

    return {
      room,
      events: await this.outbox.getDeliveredEventsAfter(room, afterSequence),
    };
  }

  private async assertRoomAccess(
    user: AuthenticatedUser,
    room: string,
  ): Promise<void> {
    if (room === userRoom(user.id)) return;
    if (room.startsWith('trip:')) {
      const tripId = room.slice('trip:'.length);
      if (tripId && (await this.authorization.canJoinTripRoom(user, tripId))) {
        return;
      }
    }

    throw new WsException('ROOM_ACCESS_DENIED');
  }

  private requireUser(client: Socket): AuthenticatedUser {
    const user = this.data(client).user;
    if (!user) throw new WsException('AUTHENTICATION_REQUIRED');
    return user;
  }

  private getAccessToken(client: Socket): string {
    const authToken = client.handshake.auth.token;
    if (typeof authToken === 'string' && authToken) return authToken;

    const authorization = client.handshake.headers.authorization;
    const [type, token] = authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) return token;

    throw new Error('Access token is required');
  }

  private data(client: Socket): RealtimeSocketData {
    return client.data as RealtimeSocketData;
  }
}
