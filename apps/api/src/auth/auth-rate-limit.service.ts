import { createHmac } from 'node:crypto';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../redis/redis.service.js';

export interface RequestCodeRateLimitInput {
  /** Already hashed by OtpService.hashPhone — this service never sees a raw phone number. */
  phoneHash: string;
  ip: string;
  deviceId: string;
}

export interface VerifyCodeRateLimitInput {
  requestId: string;
}

/**
 * Multi-axis rate limiting for the OTP request/verify endpoints, layered
 * ahead of OtpService's own per-subject attempt caps and resend backoff.
 * OtpService protects one (purpose, phone) pair; this protects the endpoint
 * as a whole against a single IP/device hammering many phone numbers, or a
 * burst across the whole system. Every axis fails closed if Redis is
 * unreachable — same posture as OtpService, see requireRedis() there.
 */
@Injectable()
export class AuthRateLimitService {
  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {}

  async checkRequestCode(input: RequestCodeRateLimitInput): Promise<void> {
    await this.requireRedis();

    const ipHash = this.hashIdentifier(input.ip);
    const maxPerPhoneHour = this.configService.getOrThrow<number>(
      'otp.maxSendsPerPhoneHour',
    );
    const maxPerIpHour = this.configService.getOrThrow<number>(
      'otp.maxSendsPerIpHour',
    );
    const maxPerDeviceHour = this.configService.getOrThrow<number>(
      'authRateLimit.requestCodeMaxPerDevicePerHour',
    );
    const maxGlobalPerMinute = this.configService.getOrThrow<number>(
      'authRateLimit.requestCodeGlobalMaxPerMinute',
    );

    await this.assertUnderLimit(
      `ratelimit:requestcode:phone:${input.phoneHash}`,
      3_600,
      maxPerPhoneHour,
    );
    await this.assertUnderLimit(
      `ratelimit:requestcode:ip:${ipHash}`,
      3_600,
      maxPerIpHour,
    );
    await this.assertUnderLimit(
      `ratelimit:requestcode:device:${input.deviceId}`,
      3_600,
      maxPerDeviceHour,
    );
    await this.assertUnderLimit(
      'ratelimit:requestcode:global',
      60,
      maxGlobalPerMinute,
    );
  }

  async checkVerifyCode(input: VerifyCodeRateLimitInput): Promise<void> {
    await this.requireRedis();

    const maxPerRequestPerMinute = this.configService.getOrThrow<number>(
      'authRateLimit.verifyCodeMaxPerMinute',
    );
    await this.assertUnderLimit(
      `ratelimit:verifycode:request:${input.requestId}`,
      60,
      maxPerRequestPerMinute,
    );
  }

  private hashIdentifier(value: string): string {
    return createHmac(
      'sha256',
      this.configService.getOrThrow<string>('auth.otpHashSecret'),
    )
      .update(value)
      .digest('hex');
  }

  private async assertUnderLimit(
    key: string,
    windowSeconds: number,
    limit: number,
  ): Promise<void> {
    const count = await this.redis.increment(key);
    if (count === 1) {
      await this.redis.setExpiry(key, windowSeconds);
    }
    if (count > limit) {
      throw new HttpException(
        {
          code: 'AUTH_RATE_LIMITED',
          message: 'Too many requests — try again later',
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
          message: 'Verification is temporarily unavailable, try again shortly',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
