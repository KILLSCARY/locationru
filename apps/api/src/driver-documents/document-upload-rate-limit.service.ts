import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { RedisService } from '../redis/redis.service.js';

const MAX_UPLOAD_URLS_PER_USER_PER_HOUR = 30;

/** Fail-closed, same posture as DeviceTokenRateLimitService — if Redis is unreachable, upload-url issuance is refused rather than silently unlimited. */
@Injectable()
export class DocumentUploadRateLimitService {
  constructor(private readonly redis: RedisService) {}

  async checkRequestUploadUrl(userId: string): Promise<void> {
    await this.requireRedis();

    const key = `ratelimit:documentupload:user:${userId}`;
    const count = await this.redis.increment(key);
    if (count === 1) {
      await this.redis.setExpiry(key, 3_600);
    }
    if (count > MAX_UPLOAD_URLS_PER_USER_PER_HOUR) {
      throw new HttpException(
        {
          code: 'DOCUMENT_UPLOAD_RATE_LIMITED',
          message: 'Too many document upload requests — try again later',
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
            'Document upload is temporarily unavailable, try again shortly',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
