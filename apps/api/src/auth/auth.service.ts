import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../database/prisma.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import type {
  AuthenticatedUser,
  AuthTokens,
  SessionSummary,
} from './auth.types.js';
import type { AuthDevicePlatform } from './dto/verify-code.dto.js';
import {
  OtpPurpose,
  type SecurityEventType,
} from '../generated/prisma/enums.js';
import { OtpService, type OtpRequestSummary } from './otp.service.js';
import { PhoneNormalizer } from './phone-normalizer.service.js';
import { VerificationChannel } from './providers/sms-provider.interface.js';

interface SessionUser {
  id: string;
  phone: string;
  role: 'PASSENGER' | 'DRIVER' | 'ADMIN' | 'SUPER_ADMIN';
}

export interface RequestContext {
  ip: string;
  userAgent?: string;
}

export interface RequestCodeInput extends RequestContext {
  phone: string;
  deviceId: string;
}

export interface ResendCodeInput extends RequestContext {
  requestId: string;
  phone: string;
  deviceId: string;
}

export interface VerifyCodeInput extends RequestContext {
  requestId: string;
  phone: string;
  code: string;
  deviceId: string;
  platform: AuthDevicePlatform;
  appVersion?: string;
}

export interface AvailableChannel {
  channel: VerificationChannel;
  available: boolean;
}

const scryptAsync = promisify(scrypt);

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly phoneNormalizer: PhoneNormalizer,
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly rateLimit: AuthRateLimitService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async requestCode(input: RequestCodeInput): Promise<OtpRequestSummary> {
    await this.assertDeviceNotBlocked(input.deviceId);
    const phone = this.phoneNormalizer.normalize(input.phone);
    const phoneHash = this.otpService.hashPhone(phone);

    await this.rateLimit.checkRequestCode({
      phoneHash,
      ip: input.ip,
      deviceId: input.deviceId,
    });

    return this.otpService.requestCode({
      phone,
      purpose: OtpPurpose.LOGIN,
      channel: VerificationChannel.SMS,
    });
  }

  async resendCode(input: ResendCodeInput): Promise<OtpRequestSummary> {
    await this.assertDeviceNotBlocked(input.deviceId);
    const phone = this.phoneNormalizer.normalize(input.phone);
    const phoneHash = this.otpService.hashPhone(phone);

    await this.rateLimit.checkRequestCode({
      phoneHash,
      ip: input.ip,
      deviceId: input.deviceId,
    });

    return this.otpService.resendCode({
      requestId: input.requestId,
      phone,
      purpose: OtpPurpose.LOGIN,
    });
  }

  async verifyCode(input: VerifyCodeInput): Promise<AuthTokens> {
    await this.rateLimit.checkVerifyCode({ requestId: input.requestId });

    const phone = this.phoneNormalizer.normalize(input.phone);
    await this.otpService.verifyCode({
      requestId: input.requestId,
      phone,
      purpose: OtpPurpose.LOGIN,
      code: input.code,
    });

    let user = await this.prisma.user.findUnique({ where: { phone } });

    if (user?.status === 'BLOCKED') {
      throw new ForbiddenException({
        code: 'USER_BLOCKED',
        message: 'User account is blocked',
      });
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: { phone, role: 'PASSENGER', status: 'ACTIVE' },
      });
    } else if (user.status === 'PENDING') {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      });
    }

    if (user.role === 'DRIVER') {
      const driverProfile = await this.prisma.driverProfile.findUnique({
        where: { userId: user.id },
      });
      if (driverProfile?.status === 'SUSPENDED') {
        throw new ForbiddenException({
          code: 'DRIVER_SUSPENDED',
          message: 'Driver account is suspended',
        });
      }
    }

    const tokens = await this.createOrReplaceSession(
      { id: user.id, phone: user.phone, role: user.role },
      input,
    );

    await this.otpService.consume(input.requestId);
    return tokens;
  }

  async refresh(
    input: RequestContext & { refreshToken: string },
  ): Promise<AuthTokens> {
    const parsed = this.parseRefreshToken(input.refreshToken);
    const session = await this.prisma.deviceSession.findUnique({
      where: { id: parsed.sessionId },
      include: { user: true },
    });

    if (!session || session.revokedAt) {
      throw this.invalidRefreshToken();
    }

    if (parsed.expiresAt <= Math.floor(Date.now() / 1000)) {
      await this.revokeSession(session.id, 'EXPIRED');
      throw this.invalidRefreshToken();
    }

    const refreshValue = `${parsed.expiresAt}.${parsed.secret}`;
    const matches = await this.verifySecretHash(
      refreshValue,
      session.refreshTokenHash,
    );

    if (!matches) {
      await this.handleRefreshTokenReuse(
        session.tokenFamilyId,
        session.userId,
        session.deviceId,
      );
      throw this.refreshTokenReusedException();
    }

    if (session.user.status !== 'ACTIVE') {
      await this.revokeSession(session.id, 'USER_INACTIVE');
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
        ...(input.ip ? { lastIpHash: this.hashIdentifier(input.ip) } : {}),
        ...(input.userAgent
          ? { userAgentSummary: this.summarizeUserAgent(input.userAgent) }
          : {}),
      },
    });

    if (update.count !== 1) {
      // Lost a concurrent rotation race — treat exactly like reuse: a second
      // caller already holds a token for a hash that no longer exists.
      await this.handleRefreshTokenReuse(
        session.tokenFamilyId,
        session.userId,
        session.deviceId,
      );
      throw this.refreshTokenReusedException();
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
      where: { id: user.sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'USER_LOGOUT' },
    });

    return { status: 'ok' };
  }

  async logoutAll(user: AuthenticatedUser): Promise<{ status: 'ok' }> {
    await this.prisma.deviceSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'USER_LOGOUT_ALL' },
    });

    return { status: 'ok' };
  }

  async listSessions(user: AuthenticatedUser): Promise<SessionSummary[]> {
    const sessions = await this.prisma.deviceSession.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      deviceId: session.deviceId,
      platform: session.platform,
      appVersion: session.appVersion ?? null,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      isCurrent: session.id === user.sessionId,
    }));
  }

  async revokeSessionForUser(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<{ status: 'ok' }> {
    const result = await this.prisma.deviceSession.updateMany({
      where: { id: sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'USER_REVOKED' },
    });

    if (result.count === 0) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Session not found',
      });
    }

    return { status: 'ok' };
  }

  getChannels(): { channels: AvailableChannel[] } {
    // Only SMS is a wired transport today; FLASH_CALL/INCOMING_CALL are
    // modeled in the domain (VerificationChannel) but have no adapter, so
    // they are reported unavailable rather than silently accepted — see
    // docs/auth/otp-architecture.md.
    return {
      channels: [
        { channel: VerificationChannel.SMS, available: true },
        { channel: VerificationChannel.FLASH_CALL, available: false },
        { channel: VerificationChannel.INCOMING_CALL, available: false },
      ],
    };
  }

  getMe(user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  private async createOrReplaceSession(
    user: SessionUser,
    input: VerifyCodeInput,
  ): Promise<AuthTokens> {
    const candidateSessionId = randomUUID();
    const refresh = await this.createRefreshToken(candidateSessionId);
    // A fresh login always starts a new token family — only refresh
    // rotations (see refresh()) preserve tokenFamilyId across updates.
    const tokenFamilyId = randomUUID();
    const lastIpHash = this.hashIdentifier(input.ip);
    const userAgentSummary = input.userAgent
      ? this.summarizeUserAgent(input.userAgent)
      : null;
    const appVersion = input.appVersion ?? null;

    const session = await this.prisma.deviceSession.upsert({
      where: { userId_deviceId: { userId: user.id, deviceId: input.deviceId } },
      create: {
        id: candidateSessionId,
        userId: user.id,
        deviceId: input.deviceId,
        platform: input.platform,
        appVersion,
        refreshTokenHash: refresh.hash,
        tokenFamilyId,
        lastIpHash,
        userAgentSummary,
      },
      update: {
        platform: input.platform,
        appVersion,
        refreshTokenHash: refresh.hash,
        tokenFamilyId,
        lastIpHash,
        userAgentSummary,
        lastSeenAt: new Date(),
        revokedAt: null,
        revokeReason: null,
      },
    });

    await this.enforceMaxActiveSessions(user.id, session.id);

    const refreshToken =
      session.id === candidateSessionId
        ? refresh.token
        : this.replaceRefreshSessionId(refresh.token, session.id);

    return {
      accessToken: await this.createAccessToken(user, session.id),
      refreshToken,
    };
  }

  /** Oldest-first eviction once a user exceeds auth.maxActiveSessions distinct devices. */
  private async enforceMaxActiveSessions(
    userId: string,
    justCreatedSessionId: string,
  ): Promise<void> {
    const maxActiveSessions = this.configService.getOrThrow<number>(
      'auth.maxActiveSessions',
    );
    const activeSessions = await this.prisma.deviceSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'asc' },
      select: { id: true },
    });

    const overLimit = activeSessions.length - maxActiveSessions;
    if (overLimit <= 0) return;

    const toRevoke = activeSessions
      .filter((session) => session.id !== justCreatedSessionId)
      .slice(0, overLimit)
      .map((session) => session.id);

    if (toRevoke.length === 0) return;

    await this.prisma.deviceSession.updateMany({
      where: { id: { in: toRevoke } },
      data: { revokedAt: new Date(), revokeReason: 'MAX_SESSIONS_EXCEEDED' },
    });
  }

  private async handleRefreshTokenReuse(
    tokenFamilyId: string,
    userId: string,
    deviceId: string,
  ): Promise<void> {
    await this.prisma.deviceSession.updateMany({
      where: { tokenFamilyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'REFRESH_TOKEN_REUSE' },
    });
    await this.recordSecurityEvent('REFRESH_TOKEN_REUSE', userId, deviceId, {
      tokenFamilyId,
    });
    this.metrics?.increment(
      'auth_refresh_token_reuse_total',
      'Refresh token reuse detections (each one revokes a full token family)',
    );
  }

  private async recordSecurityEvent(
    type: SecurityEventType,
    userId: string | undefined,
    deviceId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.securityEvent.create({
      data: {
        type,
        ...(userId ? { userId } : {}),
        ...(deviceId ? { deviceId } : {}),
        metadata: metadata as never,
      },
    });
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

  private hashIdentifier(value: string): string {
    return createHmac(
      'sha256',
      this.configService.getOrThrow<string>('auth.otpHashSecret'),
    )
      .update(value)
      .digest('hex');
  }

  private summarizeUserAgent(userAgent: string): string {
    return userAgent.slice(0, 255);
  }

  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Refresh token is invalid or expired',
    });
  }

  private refreshTokenReusedException(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'REFRESH_TOKEN_REUSED',
      message: 'Refresh token was already used or is invalid',
    });
  }

  private async assertDeviceNotBlocked(deviceId: string): Promise<void> {
    const block = await this.prisma.authBlock.findFirst({
      where: {
        deviceId,
        unblockedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (block) {
      throw new ForbiddenException({
        code: 'DEVICE_BLOCKED',
        message: 'This device is blocked',
      });
    }
  }

  private async revokeSession(
    sessionId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.deviceSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }
}
