import {
  CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class MapsRateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      ip?: string;
      user?: AuthenticatedUser;
    }>();
    const identity = request.user?.id ?? request.ip ?? 'unknown';
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `maps:rate:${identity}:${bucket}`;
    const count = await this.redis.increment(key);
    if (count === 1) await this.redis.setExpiry(key, 70);
    const limit = this.config.get<number>('maps.rateLimitPerMinute') ?? 60;
    if (count > limit) {
      throw new HttpException(
        {
          code: 'MAPS_REQUEST_LIMIT_EXCEEDED',
          message: 'Too many address or route requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
