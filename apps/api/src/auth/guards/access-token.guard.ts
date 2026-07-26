import {
  CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../../database/prisma.service.js';
import type { AccessTokenPayload, AuthenticatedUser } from '../auth.types.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: AuthenticatedUser;
    }>();
    const token = this.getBearerToken(request.headers.authorization);

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        {
          secret: this.configService.getOrThrow<string>('auth.jwtSecret'),
        },
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
        throw new UnauthorizedException();
      }

      request.user = {
        id: session.user.id,
        phone: session.user.phone,
        role: session.user.role,
        sessionId: session.id,
      };

      return true;
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Access token is invalid or expired',
      });
    }
  }

  private getBearerToken(authorization: string | undefined): string {
    const [type, token] = authorization?.split(' ') ?? [];

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException({
        code: 'ACCESS_TOKEN_REQUIRED',
        message: 'Bearer access token is required',
      });
    }

    return token;
  }
}
