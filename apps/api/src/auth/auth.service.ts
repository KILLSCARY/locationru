import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { AuthenticatedUser, AuthTokens } from './auth.types.js';
import type { VerifyCodeDto } from './dto/verify-code.dto.js';
import { PhoneNormalizer } from './phone-normalizer.service.js';
import {
  SMS_PROVIDER,
  type SmsProvider,
} from './providers/sms-provider.interface.js';

interface OtpRecord {
  attempts: number;
  hash: string;
}

interface SessionUser {
  id: string;
  phone: string;
  role: 'PASSENGER' | 'DRIVER' | 'ADMIN';
}

const scryptAsync = promisify(scrypt);

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly phoneNormalizer: PhoneNormalizer,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  async requestCode(inputPhone: string): Promise<{ status: 'accepted' }> {
    const phone = this.phoneNormalizer.normalize(inputPhone);
    await this.enforceRequestRateLimit(phone);

    const code = this.generateOtpCode();
    const record: OtpRecord = {
      attempts: 0,
      hash: this.hashOtp(phone, code),
    };

    await this.redis.setWithTtl(
      this.otpKey(phone),
      JSON.stringify(record),
      this.configService.getOrThrow<number>('auth.otpTtlSeconds'),
    );
    await this.smsProvider.sendCode(phone, code);

    return { status: 'accepted' };
  }

  async verifyCode(input: VerifyCodeDto): Promise<AuthTokens> {
    const phone = this.phoneNormalizer.normalize(input.phone);
    await this.verifyOtp(phone, input.code);

    let user = await this.prisma.user.findUnique({ where: { phone } });

    if (user?.status === 'BLOCKED') {
      throw new ForbiddenException({
        code: 'USER_BLOCKED',
        message: 'User account is blocked',
      });
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone,
          role: 'PASSENGER',
          status: 'ACTIVE',
        },
      });
    } else if (user.status === 'PENDING') {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      });
    }

    return this.createOrReplaceSession(
      {
        id: user.id,
        phone: user.phone,
        role: user.role,
      },
      input.deviceId,
      input.platform,
    );
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const parsed = this.parseRefreshToken(refreshToken);
    const session = await this.prisma.deviceSession.findUnique({
      where: { id: parsed.sessionId },
      include: { user: true },
    });

    if (!session || session.revokedAt) {
      throw this.invalidRefreshToken();
    }

    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
      await this.revokeSession(session.id);
      throw this.invalidRefreshToken();
    }

    const refreshValue = `${parsed.expiresAt}.${parsed.secret}`;
    const matches = await this.verifySecretHash(
      refreshValue,
      session.refreshTokenHash,
    );

    if (!matches) {
      await this.revokeSession(session.id);
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Refresh token was already used or is invalid',
      });
    }

    if (session.user.status !== 'ACTIVE') {
      await this.revokeSession(session.id);
      throw this.invalidRefreshToken();
    }

    const rotated = await this.createRefreshToken(session.id);
    const update = await this.prisma.deviceSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: session.refreshTokenHash,
        revokedAt: null,
      },
      data: {
        refreshTokenHash: rotated.hash,
        lastSeenAt: new Date(),
      },
    });

    if (update.count !== 1) {
      await this.revokeSession(session.id);
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Refresh token was already used',
      });
    }

    return {
      accessToken: await this.createAccessToken(
        {
          id: session.user.id,
          phone: session.user.phone,
          role: session.user.role,
        },
        session.id,
      ),
      refreshToken: rotated.token,
    };
  }

  async logout(user: AuthenticatedUser): Promise<{ status: 'ok' }> {
    await this.prisma.deviceSession.updateMany({
      where: {
        id: user.sessionId,
        userId: user.id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    return { status: 'ok' };
  }

  getMe(user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  private async enforceRequestRateLimit(phone: string): Promise<void> {
    const key = this.rateLimitKey(phone);
    const count = await this.redis.increment(key);

    if (count === 1) {
      await this.redis.setExpiry(
        key,
        this.configService.getOrThrow<number>('auth.otpRequestWindowSeconds'),
      );
    }

    if (count > this.configService.getOrThrow<number>('auth.otpRequestLimit')) {
      throw new HttpException(
        {
          code: 'OTP_RATE_LIMIT_EXCEEDED',
          message: 'Too many OTP requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async verifyOtp(phone: string, code: string): Promise<void> {
    const key = this.otpKey(phone);
    const serialized = await this.redis.get(key);

    if (!serialized) {
      throw new UnauthorizedException({
        code: 'OTP_EXPIRED',
        message: 'OTP code is expired or does not exist',
      });
    }

    const record = this.parseOtpRecord(serialized);
    const maxAttempts = this.configService.getOrThrow<number>(
      'auth.otpMaxAttempts',
    );

    if (record.attempts >= maxAttempts) {
      throw this.otpAttemptsExceeded();
    }

    if (!this.compareOtpHashes(record.hash, this.hashOtp(phone, code))) {
      record.attempts += 1;
      const ttl = await this.redis.getTtl(key);

      if (ttl > 0) {
        await this.redis.setWithTtl(key, JSON.stringify(record), ttl);
      }

      if (record.attempts >= maxAttempts) {
        throw this.otpAttemptsExceeded();
      }

      throw new UnauthorizedException({
        code: 'INVALID_OTP',
        message: 'OTP code is invalid',
      });
    }

    await this.redis.delete(key);
  }

  private async createOrReplaceSession(
    user: SessionUser,
    deviceId: string,
    platform: 'IOS' | 'ANDROID' | 'WEB',
  ): Promise<AuthTokens> {
    const candidateSessionId = randomUUID();
    const refresh = await this.createRefreshToken(candidateSessionId);
    const session = await this.prisma.deviceSession.upsert({
      where: {
        userId_deviceId: {
          userId: user.id,
          deviceId,
        },
      },
      create: {
        id: candidateSessionId,
        userId: user.id,
        deviceId,
        platform,
        refreshTokenHash: refresh.hash,
      },
      update: {
        platform,
        refreshTokenHash: refresh.hash,
        lastSeenAt: new Date(),
        revokedAt: null,
      },
    });

    const refreshToken =
      session.id === candidateSessionId
        ? refresh.token
        : this.replaceRefreshSessionId(refresh.token, session.id);

    return {
      accessToken: await this.createAccessToken(user, session.id),
      refreshToken,
    };
  }

  private async createAccessToken(
    user: SessionUser,
    sessionId: string,
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        sessionId,
        roles: [user.role],
      },
      {
        secret: this.configService.getOrThrow<string>('auth.jwtSecret'),
        expiresIn: this.configService.getOrThrow<number>(
          'auth.accessTokenTtlSeconds',
        ),
      },
    );
  }

  private async createRefreshToken(
    sessionId: string,
  ): Promise<{ hash: string; token: string }> {
    const expiresAt =
      Math.floor(Date.now() / 1000) +
      this.configService.getOrThrow<number>('auth.refreshTokenTtlSeconds');
    const secret = randomBytes(32).toString('base64url');
    const value = `${expiresAt}.${secret}`;

    return {
      hash: await this.hashSecret(value),
      token: `${sessionId}.${value}`,
    };
  }

  private parseRefreshToken(token: string): {
    expiresAt: number;
    secret: string;
    sessionId: string;
  } {
    const [sessionId, rawExpiresAt, secret, ...extra] = token.split('.');
    const expiresAt = Number(rawExpiresAt);

    if (
      extra.length ||
      !sessionId ||
      !secret ||
      !Number.isSafeInteger(expiresAt)
    ) {
      throw this.invalidRefreshToken();
    }

    return { sessionId, expiresAt, secret };
  }

  private replaceRefreshSessionId(token: string, sessionId: string): string {
    const [, expiresAt, secret] = token.split('.');
    return `${sessionId}.${expiresAt}.${secret}`;
  }

  private async hashSecret(value: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = (await scryptAsync(value, salt, 64)) as Buffer;

    return `scrypt$${salt.toString('base64url')}$${derivedKey.toString(
      'base64url',
    )}`;
  }

  private async verifySecretHash(
    value: string,
    storedHash: string,
  ): Promise<boolean> {
    const [algorithm, encodedSalt, encodedHash] = storedHash.split('$');

    if (algorithm !== 'scrypt' || !encodedSalt || !encodedHash) {
      return false;
    }

    const expected = Buffer.from(encodedHash, 'base64url');
    const actual = (await scryptAsync(
      value,
      Buffer.from(encodedSalt, 'base64url'),
      expected.length,
    )) as Buffer;

    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  private hashOtp(phone: string, code: string): string {
    return createHmac(
      'sha256',
      this.configService.getOrThrow<string>('auth.otpHashSecret'),
    )
      .update(`${phone}:${code}`)
      .digest('hex');
  }

  private generateOtpCode(): string {
    const developmentCode = this.configService.get<string>(
      'auth.developmentOtpCode',
    );
    const environment = this.configService.get<string>('app.environment');

    if (environment === 'development' && developmentCode) {
      return developmentCode;
    }

    return randomInt(100_000, 1_000_000).toString();
  }

  private compareOtpHashes(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(actual, 'hex');

    return (
      expectedBuffer.length === actualBuffer.length &&
      timingSafeEqual(expectedBuffer, actualBuffer)
    );
  }

  private parseOtpRecord(value: string): OtpRecord {
    try {
      const record = JSON.parse(value) as Partial<OtpRecord>;

      if (
        typeof record.attempts !== 'number' ||
        !Number.isInteger(record.attempts) ||
        typeof record.hash !== 'string'
      ) {
        throw new Error('Invalid OTP record');
      }

      return {
        attempts: record.attempts,
        hash: record.hash,
      };
    } catch {
      throw new UnauthorizedException({
        code: 'OTP_EXPIRED',
        message: 'OTP code is expired or does not exist',
      });
    }
  }

  private otpAttemptsExceeded(): HttpException {
    return new HttpException(
      {
        code: 'OTP_ATTEMPTS_EXCEEDED',
        message: 'OTP attempt limit exceeded',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Refresh token is invalid or expired',
    });
  }

  private async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.deviceSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private otpKey(phone: string): string {
    return `auth:otp:${phone}`;
  }

  private rateLimitKey(phone: string): string {
    return `auth:otp-rate:${phone}`;
  }
}
