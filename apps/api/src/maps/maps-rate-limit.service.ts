import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service.js';

/**
 * Fixed-window rate limiter backed by a Redis counter, matching the auth OTP
 * pattern already used in this codebase. Keyed per user (or IP) and per action.
 * If Redis is unavailable the limiter fails open rather than blocking traffic.
 */
@Injectable()
export class MapsRateLimitService {
  private readonly logger = new Logger(MapsRateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  async enforce(
    action: string,
    subject: string,
    limitPerMinute: number,
  ): Promise<void> {
    const key = `maps:ratelimit:${action}:${subject}`;
    let count: number;

    try {
      count = await this.redis.increment(key);
      if (count === 1) {
        await this.redis.setExpiry(key, 60);
      }
    } catch (error) {
      this.logger.warn({
        event: 'maps.ratelimit_unavailable',
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (count > limitPerMinute) {
      throw new HttpException(
        {
          code: 'MAPS_RATE_LIMITED',
          message: 'Too many maps requests, slow down',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
