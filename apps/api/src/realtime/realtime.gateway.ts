import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import type { Server, Socket } from 'socket.io';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RedisService } from '../redis/redis.service.js';
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

// Read directly from process.env: @WebSocketGateway's decorator arguments
// are evaluated at class-definition time (module import), before Nest's
// ConfigService/Joi validation exists to inject. Defaults mirror the ones
// Joi applies to WEBSOCKET_HEARTBEAT_INTERVAL_MS/_TIMEOUT_MS in
// configuration.ts, so an unconfigured env still behaves sensibly.
// pingTimeout is Socket.IO's own stale-client disconnect mechanism: a
// client that doesn't respond to a ping within pingTimeout is dropped.
const heartbeatIntervalMs = Number(
  process.env.WEBSOCKET_HEARTBEAT_INTERVAL_MS ?? 25_000,
);
const heartbeatTimeoutMs = Number(
  process.env.WEBSOCKET_HEARTBEAT_TIMEOUT_MS ?? 20_000,
);

@WebSocketGateway({
  namespace: '/realtime',
  pingInterval: heartbeatIntervalMs,
  pingTimeout: heartbeatTimeoutMs,
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  private server!: Server;

  /** userId -> live socket ids, enforcing websocket.maxConnectionsPerUser. */
  private readonly socketsByUser = new Map<string, Set<string>>();
  /** sessionId -> current live socket id, so a reconnect evicts the stale one. */
  private readonly socketBySession = new Map<string, string>();

  constructor(
    private readonly authorization: RealtimeAuthorizationService,
    private readonly outbox: RealtimeOutboxService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
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
      this.assertOriginAllowed(client);

      const user = await this.authorization.authenticate(
        this.getAccessToken(client),
      );

      this.evictDuplicateSession(user.sessionId, client.id);
      this.registerConnection(user, client.id);
      if (!this.withinConnectionLimit(user.id)) {
        this.unregisterConnection(user, client.id);
        client.emit('realtime.error', {
          code: 'TOO_MANY_CONNECTIONS',
        });
        client.disconnect(true);
        return;
      }

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

  handleDisconnect(client: Socket): void {
    const user = this.data(client).user;
    if (!user) return;
    this.unregisterConnection(user, client.id);
    if (this.socketBySession.get(user.sessionId) === client.id) {
      this.socketBySession.delete(user.sessionId);
    }
  }

  @SubscribeMessage('room.join')
  async joinTripRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: RoomJoinPayload,
  ): Promise<{ room: string; sequence: number }> {
    const user = this.requireUser(client);
    await this.enforceEventRateLimit(user);
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
    await this.enforceEventRateLimit(user);
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
    await this.enforceEventRateLimit(user);
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

  /**
   * Mirrors bootstrap.ts's HTTP CORS reasoning: an empty allow-list means
   * no browser client in this environment needs an origin check (mobile
   * apps and other non-browser clients don't send a trustworthy Origin
   * header at all), so only enforce once the list is non-empty.
   */
  private assertOriginAllowed(client: Socket): void {
    const allowedOrigins = this.configService.getOrThrow<string[]>(
      'websocket.allowedOrigins',
    );
    if (allowedOrigins.length === 0) return;

    const origin = client.handshake.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      throw new Error('Origin not allowed');
    }
  }

  private withinConnectionLimit(userId: string): boolean {
    const maxConnections = this.configService.getOrThrow<number>(
      'websocket.maxConnectionsPerUser',
    );
    return (this.socketsByUser.get(userId)?.size ?? 0) <= maxConnections;
  }

  private registerConnection(user: AuthenticatedUser, socketId: string): void {
    const sockets = this.socketsByUser.get(user.id) ?? new Set<string>();
    sockets.add(socketId);
    this.socketsByUser.set(user.id, sockets);
  }

  private unregisterConnection(
    user: AuthenticatedUser,
    socketId: string,
  ): void {
    const sockets = this.socketsByUser.get(user.id);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) this.socketsByUser.delete(user.id);
  }

  /**
   * A reconnecting client (token refresh, network blip) opens a new socket
   * for the same session before the old one has necessarily been torn
   * down. Without this, both sockets would keep receiving room events —
   * evict the stale one so a session only ever has one live connection.
   */
  private evictDuplicateSession(sessionId: string, newSocketId: string): void {
    const previousSocketId = this.socketBySession.get(sessionId);
    if (previousSocketId && previousSocketId !== newSocketId) {
      this.server
        ?.of('/realtime')
        .sockets.get(previousSocketId)
        ?.disconnect(true);
    }
    this.socketBySession.set(sessionId, newSocketId);
  }

  /**
   * Fixed-window counter in Redis, same pattern as MapsRateLimitService —
   * keyed per session so a single abusive client can't starve others, and
   * fails open (allows the event) if Redis itself is unavailable rather
   * than taking realtime messaging down with it.
   */
  private async enforceEventRateLimit(user: AuthenticatedUser): Promise<void> {
    const limitPerMinute = this.configService.getOrThrow<number>(
      'websocket.eventRateLimitPerMinute',
    );
    const key = `realtime:ws-rate:${user.sessionId}`;

    let count: number;
    try {
      count = await this.redis.increment(key);
      if (count === 1) await this.redis.setExpiry(key, 60);
    } catch {
      return;
    }

    if (count > limitPerMinute) {
      throw new WsException('RATE_LIMITED');
    }
  }
}
