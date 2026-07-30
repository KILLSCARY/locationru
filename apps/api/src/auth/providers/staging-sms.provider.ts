import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import { RedisService } from '../../redis/redis.service.js';
import type { SmsProvider } from './sms-provider.interface.js';

/** Redis key holding the plaintext OTP for the staging admin viewer tool. */
export function stagingOtpLookupKey(phone: string): string {
  return `staging:otp-lookup:${phone}`;
}

/**
 * Never sends a real SMS and never logs the OTP anywhere. Instead it stores
 * the plaintext code in a short-lived, admin-only Redis key so a
 * SUPER_ADMIN can retrieve it through
 * `GET /api/v1/admin/staging/otp/:phone` (StagingToolsController) — a fixed
 * bypass code is never used, and this key is separate from the HASH
 * AuthService stores for the real verification path (see
 * `AuthService.otpKey`); this one exists solely for the staging viewing
 * tool and shares the OTP's own TTL.
 */
@Injectable()
export class StagingSmsProvider implements SmsProvider {
  private readonly logger = new Logger(StagingSmsProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    const environment = this.config.getOrThrow<AppEnvironment>(
      'app.appEnvironment',
    );
    if (environment === AppEnvironment.PRODUCTION) {
      throw new Error('StagingSmsProvider must not be used in production');
    }
  }

  async sendCode(phone: string, code: string): Promise<void> {
    const ttlSeconds = this.config.getOrThrow<number>('auth.otpTtlSeconds');
    await this.redis.setWithTtl(stagingOtpLookupKey(phone), code, ttlSeconds);
    this.logger.log({
      event: 'auth.staging_otp_stored',
      phone,
      // Deliberately no `code` field — see the class doc comment.
    });
  }
}
