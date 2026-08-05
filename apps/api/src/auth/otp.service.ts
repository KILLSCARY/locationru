import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import { PrismaService } from '../database/prisma.service.js';
import { OtpPurpose, OtpStatus } from '../generated/prisma/enums.js';
import { MetricsService } from '../observability/metrics.service.js';
import { RedisService } from '../redis/redis.service.js';
import {
  SMS_PROVIDER,
  VerificationChannel,
  type SmsProvider,
} from './providers/sms-provider.interface.js';
import { SmsTemplateService, type SmsLocale } from './sms-template.service.js';

/** All-zeros — obviously not a real code, and only ever reachable behind ENABLE_DEVELOPMENT_OTP + APP_ENV=development. */
const DEVELOPMENT_FIXED_CODE = '000000';

/** Progressive resend backoff, in seconds, before a temporary block. */
const RESEND_BACKOFF_SECONDS = [60, 120, 240];

interface ActiveOtpState {
  requestId: string;
  purpose: OtpPurpose;
  channel: VerificationChannel;
  codeHash: string;
  attemptsUsed: number;
  maxAttempts: number;
  resendCount: number;
  resendAvailableAtMs: number;
  expiresAtMs: number;
}

export interface RequestOtpInput {
  phone: string;
  purpose: OtpPurpose;
  channel: VerificationChannel;
  locale?: SmsLocale;
}

export interface ResendOtpInput {
  requestId: string;
  phone: string;
  purpose: OtpPurpose;
  channel?: VerificationChannel;
  locale?: SmsLocale;
}

export interface VerifyOtpInput {
  requestId: string;
  phone: string;
  purpose: OtpPurpose;
  code: string;
}

export interface OtpRequestSummary {
  requestId: string;
  expiresInSeconds: number;
  resendInSeconds: number;
}

/**
 * Owns the OTP domain end to end: generation, hashing, storage,
 * expiration, attempt counting, resend cooldown/blocking, and one-time
 * consumption. The SMS provider it's given only ever sees a phone number,
 * a rendered message, and a code to relay — never database access, never
 * the caller's rate-limit state. See docs/auth/otp-architecture.md.
 *
 * Redis holds the one *active* code per (purpose, phone) — the only thing
 * verify-code actually checks against. Postgres (OtpRequest) is the
 * durable, codeless history: if Redis is unavailable, requests fail
 * closed (see requireRedis) rather than falling back to keeping the code
 * in process memory, which would silently stop working across replicas
 * and survive a restart in a way nothing is designed to clean up.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly templates: SmsTemplateService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async requestCode(input: RequestOtpInput): Promise<OtpRequestSummary> {
    const phoneHash = this.hashPhone(input.phone);
    const requestId = randomUUID();
    const code = this.generateCode();
    const codeHash = this.hashCode(input.phone, code);
    const now = Date.now();
    const ttlSeconds = this.configService.getOrThrow<number>('otp.ttlSeconds');
    const maxAttempts =
      this.configService.getOrThrow<number>('otp.maxAttempts');
    const resendInitialSeconds = this.configService.getOrThrow<number>(
      'otp.resendInitialSeconds',
    );

    const state: ActiveOtpState = {
      requestId,
      purpose: input.purpose,
      channel: input.channel,
      codeHash,
      attemptsUsed: 0,
      maxAttempts,
      resendCount: 0,
      resendAvailableAtMs: now + resendInitialSeconds * 1_000,
      expiresAtMs: now + ttlSeconds * 1_000,
    };

    await this.writeActiveState(input.purpose, phoneHash, state, ttlSeconds);

    const historyId = await this.recordHistory({
      phoneHash,
      purpose: input.purpose,
      channel: input.channel,
      codeHash,
      maxAttempts,
      expiresAt: new Date(state.expiresAtMs),
      resendAvailableAt: new Date(state.resendAvailableAtMs),
      requestId,
    });

    await this.deliver(
      input.phone,
      code,
      input.purpose,
      input.channel,
      requestId,
      input.locale,
      historyId,
    );

    this.metrics?.increment(
      'auth_otp_requests_total',
      'Total OTP codes requested',
      {
        purpose: input.purpose,
        channel: input.channel,
      },
    );

    return {
      requestId,
      expiresInSeconds: ttlSeconds,
      resendInSeconds: resendInitialSeconds,
    };
  }

  async resendCode(input: ResendOtpInput): Promise<OtpRequestSummary> {
    const phoneHash = this.hashPhone(input.phone);
    const state = await this.readActiveState(input.purpose, phoneHash);

    if (!state || state.requestId !== input.requestId) {
      throw this.otpExpiredException();
    }

    await this.assertNotBlocked(input.purpose, phoneHash);

    const now = Date.now();
    if (now < state.resendAvailableAtMs) {
      throw new HttpException(
        {
          code: 'OTP_RESEND_NOT_AVAILABLE_YET',
          message: 'Resend is not available yet',
          resendInSeconds: Math.ceil((state.resendAvailableAtMs - now) / 1_000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const nextResendCount = state.resendCount + 1;
    if (nextResendCount > RESEND_BACKOFF_SECONDS.length) {
      await this.blockSubject(input.purpose, phoneHash, 'RESEND_ABUSE');
      throw this.blockedException();
    }

    const code = this.generateCode();
    const codeHash = this.hashCode(input.phone, code);
    const ttlSeconds = this.configService.getOrThrow<number>('otp.ttlSeconds');
    const resendDelaySeconds =
      RESEND_BACKOFF_SECONDS[nextResendCount - 1] ??
      RESEND_BACKOFF_SECONDS.at(-1)!;

    const nextState: ActiveOtpState = {
      ...state,
      codeHash,
      attemptsUsed: 0,
      resendCount: nextResendCount,
      resendAvailableAtMs: now + resendDelaySeconds * 1_000,
      expiresAtMs: now + ttlSeconds * 1_000,
      channel: input.channel ?? state.channel,
    };

    await this.writeActiveState(
      input.purpose,
      phoneHash,
      nextState,
      ttlSeconds,
    );
    await this.prisma.otpRequest.updateMany({
      where: { id: state.requestId },
      data: {
        codeHash,
        channel: nextState.channel,
        expiresAt: new Date(nextState.expiresAtMs),
        resendAvailableAt: new Date(nextState.resendAvailableAtMs),
        status: OtpStatus.SENDING,
        attemptsUsed: 0,
      },
    });

    await this.deliver(
      input.phone,
      code,
      input.purpose,
      nextState.channel,
      state.requestId,
      input.locale,
      state.requestId,
    );

    return {
      requestId: state.requestId,
      expiresInSeconds: ttlSeconds,
      resendInSeconds: resendDelaySeconds,
    };
  }

  /** Verifies the code and marks it VERIFIED — one-time: the active state is deleted regardless of outcome once attempts are exhausted or the code matches. */
  async verifyCode(input: VerifyOtpInput): Promise<void> {
    const phoneHash = this.hashPhone(input.phone);
    await this.assertNotBlocked(input.purpose, phoneHash);

    const state = await this.readActiveState(input.purpose, phoneHash);
    if (!state || state.requestId !== input.requestId) {
      throw this.otpExpiredException();
    }

    if (Date.now() >= state.expiresAtMs) {
      await this.deleteActiveState(input.purpose, phoneHash);
      await this.prisma.otpRequest.updateMany({
        where: { id: state.requestId },
        data: { status: OtpStatus.EXPIRED },
      });
      this.recordVerifyMetric(input.purpose, 'expired');
      throw this.otpExpiredException();
    }

    if (state.attemptsUsed >= state.maxAttempts) {
      await this.blockSubject(
        input.purpose,
        phoneHash,
        'MAX_ATTEMPTS_EXCEEDED',
      );
      this.recordVerifyMetric(input.purpose, 'blocked');
      throw this.blockedException();
    }

    if (
      !this.compareHashes(
        state.codeHash,
        this.hashCode(input.phone, input.code),
      )
    ) {
      const attemptsUsed = state.attemptsUsed + 1;
      const remainingTtlSeconds = Math.max(
        1,
        Math.ceil((state.expiresAtMs - Date.now()) / 1_000),
      );
      await this.writeActiveState(
        input.purpose,
        phoneHash,
        { ...state, attemptsUsed },
        remainingTtlSeconds,
      );
      await this.prisma.otpRequest.updateMany({
        where: { id: state.requestId },
        data: { attemptsUsed },
      });

      if (attemptsUsed >= state.maxAttempts) {
        await this.recordSecurityEvent(
          'OTP_BRUTE_FORCE_SUSPECTED',
          phoneHash,
          undefined,
          { purpose: input.purpose, requestId: state.requestId },
        );
        await this.blockSubject(
          input.purpose,
          phoneHash,
          'MAX_ATTEMPTS_EXCEEDED',
        );
        this.recordVerifyMetric(input.purpose, 'blocked');
        throw this.blockedException();
      }

      this.recordVerifyMetric(input.purpose, 'invalid');
      throw new UnauthorizedException({
        code: 'INVALID_OTP',
        message: 'OTP code is invalid',
      });
    }

    await this.deleteActiveState(input.purpose, phoneHash);
    await this.prisma.otpRequest.updateMany({
      where: { id: state.requestId },
      data: { status: OtpStatus.VERIFIED, verifiedAt: new Date() },
    });
    this.recordVerifyMetric(input.purpose, 'success');
  }

  private recordVerifyMetric(
    purpose: OtpPurpose,
    result: 'success' | 'invalid' | 'expired' | 'blocked',
  ): void {
    this.metrics?.increment(
      'auth_otp_verify_total',
      'OTP verification attempts by outcome',
      {
        purpose,
        result,
      },
    );
  }

  /** Marks the OTP row consumed once the caller has finished acting on it (e.g. a session was actually issued). */
  async consume(requestId: string): Promise<void> {
    await this.prisma.otpRequest.updateMany({
      where: { id: requestId },
      data: { status: OtpStatus.CONSUMED, consumedAt: new Date() },
    });
  }

  /**
   * Admin-triggered block/unblock (AdminAuthService), scoped to LOGIN since
   * that's the only purpose with a live HTTP endpoint in this task. Keeps
   * the Redis key format (blockKey) private to this service — callers never
   * construct it themselves.
   */
  async adminBlockLogin(
    phoneHash: string,
    expiresInSeconds: number | null,
  ): Promise<void> {
    const key = this.blockKey(OtpPurpose.LOGIN, phoneHash);
    if (expiresInSeconds === null) {
      await this.redis.setPersistent(key, 'ADMIN_BLOCK');
    } else {
      await this.redis.setWithTtl(key, 'ADMIN_BLOCK', expiresInSeconds);
    }
    await this.deleteActiveState(OtpPurpose.LOGIN, phoneHash);
  }

  async adminUnblockLogin(phoneHash: string): Promise<void> {
    await this.redis.delete(this.blockKey(OtpPurpose.LOGIN, phoneHash));
  }

  maskPhone(phone: string): string {
    return phone.length > 4
      ? `${phone.slice(0, 2)}${'*'.repeat(phone.length - 4)}${phone.slice(-2)}`
      : phone;
  }

  hashPhone(phone: string): string {
    return createHmac(
      'sha256',
      this.configService.getOrThrow<string>('auth.otpHashSecret'),
    )
      .update(phone)
      .digest('hex');
  }

  private async deliver(
    phone: string,
    code: string,
    purpose: OtpPurpose,
    channel: VerificationChannel,
    requestId: string,
    locale: SmsLocale | undefined,
    historyId: string,
  ): Promise<void> {
    const { message } = this.templates.renderVerificationCode(
      purpose,
      code,
      locale,
    );

    try {
      const result = await this.smsProvider.sendVerificationCode({
        phone,
        code,
        message,
        channel,
        requestId,
      });
      await this.prisma.otpRequest.updateMany({
        where: { id: historyId },
        data: {
          status: OtpStatus.SENT,
          ...(result.providerMessageId
            ? { providerMessageId: result.providerMessageId }
            : {}),
          providerStatus: result.status,
        },
      });
    } catch (error) {
      await this.prisma.otpRequest.updateMany({
        where: { id: historyId },
        data: { status: OtpStatus.FAILED },
      });
      this.logger.error({
        event: 'otp.delivery_failed',
        provider: this.smsProvider.name,
        channel,
        message: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        {
          code: 'OTP_DELIVERY_FAILED',
          message: 'Could not send the verification code, try again shortly',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private generateCode(): string {
    const length = this.configService.getOrThrow<number>('otp.smsCodeLength');
    const environment =
      this.configService.getOrThrow<AppEnvironment>('app.appEnvironment');
    const enableDevelopmentOtp = this.configService.getOrThrow<boolean>(
      'auth.enableDevelopmentOtp',
    );

    if (environment === AppEnvironment.DEVELOPMENT && enableDevelopmentOtp) {
      return DEVELOPMENT_FIXED_CODE.padStart(length, '0').slice(-length);
    }

    const max = 10 ** length;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = randomInt(0, max).toString().padStart(length, '0');
      if (!this.isWeakCode(code)) return code;
    }

    throw new Error('Failed to generate a non-weak OTP code');
  }

  private isWeakCode(code: string): boolean {
    const digits = code.split('').map(Number);
    if (new Set(digits).size === 1) return true;

    let ascending = true;
    let descending = true;
    for (let i = 1; i < digits.length; i += 1) {
      if (digits[i] !== digits[i - 1]! + 1) ascending = false;
      if (digits[i] !== digits[i - 1]! - 1) descending = false;
    }
    return ascending || descending;
  }

  private hashCode(phone: string, code: string): string {
    return createHmac(
      'sha256',
      this.configService.getOrThrow<string>('auth.otpHashSecret'),
    )
      .update(`${phone}:${code}`)
      .digest('hex');
  }

  private compareHashes(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(actual, 'hex');
    return (
      expectedBuffer.length === actualBuffer.length &&
      timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }

  private async writeActiveState(
    purpose: OtpPurpose,
    phoneHash: string,
    state: ActiveOtpState,
    ttlSeconds: number,
  ): Promise<void> {
    await this.requireRedis();
    await this.redis.setWithTtl(
      this.activeKey(purpose, phoneHash),
      JSON.stringify(state),
      ttlSeconds,
    );
  }

  private async readActiveState(
    purpose: OtpPurpose,
    phoneHash: string,
  ): Promise<ActiveOtpState | null> {
    await this.requireRedis();
    const raw = await this.redis.get(this.activeKey(purpose, phoneHash));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ActiveOtpState;
    } catch {
      return null;
    }
  }

  private async deleteActiveState(
    purpose: OtpPurpose,
    phoneHash: string,
  ): Promise<void> {
    await this.redis.delete(this.activeKey(purpose, phoneHash));
  }

  private async assertNotBlocked(
    purpose: OtpPurpose,
    phoneHash: string,
  ): Promise<void> {
    const blocked = await this.redis.get(this.blockKey(purpose, phoneHash));
    if (blocked) throw this.blockedException();
  }

  private async blockSubject(
    purpose: OtpPurpose,
    phoneHash: string,
    reason: string,
  ): Promise<void> {
    const blockSeconds =
      this.configService.getOrThrow<number>('otp.blockSeconds');
    await this.redis.setWithTtl(
      this.blockKey(purpose, phoneHash),
      reason,
      blockSeconds,
    );
    await this.deleteActiveState(purpose, phoneHash);
    await this.prisma.authBlock.create({
      data: {
        phoneHash,
        reason,
        expiresAt: new Date(Date.now() + blockSeconds * 1_000),
      },
    });
    this.metrics?.increment(
      'auth_otp_blocks_total',
      'Automatic OTP blocks by reason',
      {
        purpose,
        reason,
      },
    );
  }

  private async requireRedis(): Promise<void> {
    try {
      await this.redis.checkConnection();
    } catch {
      // Fail closed: never fall back to in-memory OTP state — that would
      // silently stop working across replicas and on restart.
      throw new HttpException(
        {
          code: 'OTP_STORE_UNAVAILABLE',
          message: 'Verification is temporarily unavailable, try again shortly',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async recordHistory(input: {
    phoneHash: string;
    purpose: OtpPurpose;
    channel: VerificationChannel;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
    resendAvailableAt: Date;
    requestId: string;
  }): Promise<string> {
    const row = await this.prisma.otpRequest.create({
      data: {
        id: input.requestId,
        phoneHash: input.phoneHash,
        purpose: input.purpose,
        channel: input.channel,
        codeHash: input.codeHash,
        status: OtpStatus.CREATED,
        maxAttempts: input.maxAttempts,
        expiresAt: input.expiresAt,
        resendAvailableAt: input.resendAvailableAt,
      },
    });
    return row.id;
  }

  private async recordSecurityEvent(
    type: 'OTP_BRUTE_FORCE_SUSPECTED',
    phoneHash: string | undefined,
    deviceId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.securityEvent.create({
      data: {
        type,
        ...(phoneHash ? { phoneHash } : {}),
        ...(deviceId ? { deviceId } : {}),
        metadata: metadata as never,
      },
    });
  }

  private activeKey(purpose: OtpPurpose, phoneHash: string): string {
    return `otp:active:${purpose}:${phoneHash}`;
  }

  private blockKey(purpose: OtpPurpose, phoneHash: string): string {
    return `otp:block:${purpose}:${phoneHash}`;
  }

  private otpExpiredException(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'OTP_EXPIRED',
      message: 'OTP code is expired or does not exist',
    });
  }

  private blockedException(): ForbiddenException {
    return new ForbiddenException({
      code: 'OTP_BLOCKED',
      message: 'Too many attempts — try again later',
    });
  }
}
