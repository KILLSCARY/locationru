import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

/**
 * Protects POST /devices (register/refresh) against a single user hammering
 * registrations — same fail-closed posture as AuthRateLimitService: if
 * Redis is unreachable, registration is refused rather than silently
 * unlimited. Also writes the one-shot SecurityEvent audit row the moment
 * the limit is first crossed (count === limit + 1) — mirrors OtpService's
 * recordSecurityEvent, which fires exactly once at the block-threshold
 * instant rather than on every subsequent already-blocked attempt.
 */
@Injectable()
export class DeviceTokenRateLimitService {
  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async checkRegisterDevice(userId: string): Promise<void> {
    await this.requireRedis();

    const maxPerUserPerHour = this.configService.getOrThrow<number>(
      'push.rateLimit.registerMaxPerUserPerHour',
    );
    await this.assertUnderLimit(
      `ratelimit:devicetoken:register:user:${userId}`,
      3_600,
      maxPerUserPerHour,
      userId,
    );
  }

  private async assertUnderLimit(
    key: string,
    windowSeconds: number,
    limit: number,
    userId: string,
  ): Promise<void> {
    const count = await this.redis.increment(key);
    if (count === 1) {
      await this.redis.setExpiry(key, windowSeconds);
    }
    if (count === limit + 1) {
      await this.prisma.securityEvent.create({
        data: {
          type: 'PUSH_TOKEN_MASS_REGISTRATION_SUSPECTED',
          userId,
          metadata: { registrationsInWindow: count, windowSeconds } as never,
        },
      });
    }
    if (count > limit) {
      throw new HttpException(
        {
          code: 'DEVICE_TOKEN_RATE_LIMITED',
          message: 'Too many device registrations — try again later',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async requireRedis(): Promise<void> {
    try {
      await this.redis.checkConnection();
    } catch {
      throw new HttpException(
        {
          code: 'RATE_LIMIT_STORE_UNAVAILABLE',
          message:
            'Device registration is temporarily unavailable, try again shortly',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
