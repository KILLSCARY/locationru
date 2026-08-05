import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type {
  AuthenticatedUser,
  AccessTokenPayload,
} from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class RealtimeAuthorizationService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(accessToken: string): Promise<AuthenticatedUser> {
    const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
      accessToken,
      { secret: this.configService.getOrThrow<string>('auth.jwtSecret') },
    );
    const session = await this.prisma.deviceSession.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.userId !== payload.sub ||
      session.user.status !== 'ACTIVE' ||
      !payload.roles.includes(session.user.role)
    ) {
      throw new Error('Invalid realtime access token');
    }

    return {
      id: session.user.id,
      phone: session.user.phone,
      role: session.user.role,
      sessionId: session.id,
    };
  }

  async canJoinTripRoom(
    user: AuthenticatedUser,
    tripId: string,
  ): Promise<boolean> {
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      return Boolean(
        await this.prisma.trip.findUnique({
          where: { id: tripId },
          select: { id: true },
        }),
      );
    }

    const trip = await this.prisma.trip.findFirst({
      where:
        user.role === 'PASSENGER'
          ? { id: tripId, passengerId: user.id }
          : {
              id: tripId,
              OR: [
                { selectedDriverId: user.id },
                { bids: { some: { driverId: user.id } } },
                {
                  dispatchAttempts: {
                    some: { logs: { some: { driverId: user.id } } },
                  },
                },
              ],
            },
      select: { id: true },
    });

    return Boolean(trip);
  }
}
