import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../database/prisma.service.js';
import { OtpStatus } from '../generated/prisma/enums.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AuthService } from './auth.service.js';
import type { AccessTokenPayload } from './auth.types.js';
import { AuthDevicePlatform } from './dto/verify-code.dto.js';
import { OtpService } from './otp.service.js';
import { DevelopmentSmsProvider } from './providers/development-sms.provider.js';
import type { SmsProvider } from './providers/sms-provider.interface.js';
import { SmsTemplateService } from './sms-template.service.js';
import { PhoneNormalizer } from './phone-normalizer.service.js';

interface TestUser {
  id: string;
  phone: string;
  role: 'PASSENGER' | 'DRIVER' | 'ADMIN';
  status: 'ACTIVE' | 'BLOCKED' | 'PENDING';
}

interface TestSession {
  id: string;
  userId: string;
  deviceId: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  appVersion: string | null;
  refreshTokenHash: string;
  tokenFamilyId: string;
  lastSeenAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdAt: Date;
  lastIpHash: string | null;
  userAgentSummary: string | null;
}

interface TestOtpRequest {
  id: string;
  phoneHash: string;
  status: OtpStatus;
  attemptsUsed: number;
  [key: string]: unknown;
}

class FakeSmsProvider implements SmsProvider {
  readonly name = 'fake';
  lastCode: string | undefined;
  lastPhone: string | undefined;

  async sendVerificationCode(input: {
    phone: string;
    code: string;
  }): Promise<{ status: 'SENT' }> {
    this.lastPhone = input.phone;
    this.lastCode = input.code;
    return { status: 'SENT' };
  }

  async sendTransactionalMessage() {
    return { status: 'SENT' as const };
  }

  async getDeliveryStatus() {
    return {
      providerMessageId: 'msg',
      status: 'SENT' as const,
      updatedAt: new Date(),
    };
  }

  async handleStatusWebhook() {
    return {
      providerMessageId: null,
      status: 'UNKNOWN' as const,
      rawEventHash: 'hash',
      occurredAt: new Date(),
    };
  }

  async healthCheck() {
    return { healthy: true };
  }
}

class FakeRedis {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setWithTtl(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async increment(key: string): Promise<number> {
    const value = Number(this.values.get(key) ?? 0) + 1;
    this.values.set(key, value.toString());
    return value;
  }

  async setExpiry(): Promise<void> {}

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async checkConnection(): Promise<void> {}
}

class FakePrisma {
  readonly usersByPhone = new Map<string, TestUser>();
  readonly sessions = new Map<string, TestSession>();
  readonly otpRequests = new Map<string, TestOtpRequest>();
  readonly securityEvents: Array<Record<string, unknown>> = [];
  readonly authBlocks: Array<Record<string, unknown>> = [];

  readonly user = {
    findUnique: async ({ where }: { where: { phone: string } }) =>
      this.usersByPhone.get(where.phone) ?? null,
    create: async ({ data }: { data: Omit<TestUser, 'id'> }) => {
      const user = { id: randomUUID(), ...data };
      this.usersByPhone.set(user.phone, user);
      return user;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<TestUser>;
    }) => {
      const user = [...this.usersByPhone.values()].find(
        (candidate) => candidate.id === where.id,
      );
      if (!user) throw new Error('User not found');
      Object.assign(user, data);
      return user;
    },
  };

  readonly deviceSession = {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { userId_deviceId: { userId: string; deviceId: string } };
      create: Omit<
        TestSession,
        'lastSeenAt' | 'revokedAt' | 'createdAt' | 'revokeReason'
      > &
        Partial<
          Pick<
            TestSession,
            'lastSeenAt' | 'revokedAt' | 'createdAt' | 'revokeReason'
          >
        >;
      update: Partial<TestSession>;
    }) => {
      const existing = [...this.sessions.values()].find(
        (session) =>
          session.userId === where.userId_deviceId.userId &&
          session.deviceId === where.userId_deviceId.deviceId,
      );

      if (existing) {
        Object.assign(existing, update);
        return existing;
      }

      const session: TestSession = {
        revokeReason: null,
        ...create,
        lastSeenAt: create.lastSeenAt ?? new Date(),
        revokedAt: create.revokedAt ?? null,
        createdAt: create.createdAt ?? new Date(),
      };
      this.sessions.set(session.id, session);
      return session;
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const session = this.sessions.get(where.id);
      if (!session) return null;
      const user = [...this.usersByPhone.values()].find(
        (candidate) => candidate.id === session.userId,
      );
      return user ? { ...session, user } : null;
    },
    findMany: async ({
      where,
    }: {
      where: { userId: string; revokedAt: null };
    }) => {
      return [...this.sessions.values()].filter(
        (session) =>
          session.userId === where.userId && session.revokedAt === null,
      );
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<TestSession>;
    }) => {
      let count = 0;
      for (const session of this.sessions.values()) {
        const matches = Object.entries(where).every(([key, value]) => {
          if (
            key === 'id' &&
            typeof value === 'object' &&
            value &&
            'in' in value
          ) {
            return (value as { in: string[] }).in.includes(session.id);
          }
          return session[key as keyof TestSession] === value;
        });
        if (matches) {
          Object.assign(session, data);
          count += 1;
        }
      }
      return { count };
    },
  };

  readonly otpRequest = {
    create: async ({ data }: { data: TestOtpRequest }) => {
      this.otpRequests.set(data.id, { ...data });
      return data;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<TestOtpRequest>;
    }) => {
      const row = this.otpRequests.get(where.id);
      if (row) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    },
  };

  readonly authBlock = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.authBlocks.push(data);
      return data;
    },
    findFirst: async (): Promise<{
      id: string;
      deviceId?: string;
      unblockedAt: Date | null;
      expiresAt: Date | null;
    } | null> => null,
  };

  readonly driverProfile = {
    findUnique: async (): Promise<{ status: string } | null> => null,
  };

  readonly securityEvent = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      this.securityEvents.push(data);
      return data;
    },
  };
}

describe('AuthService', () => {
  const phone = '+79990000000';
  const jwtSecret = 'test-access-token-secret-that-is-at-least-32-characters';
  let authService: AuthService;
  let jwtService: JwtService;
  let prisma: FakePrisma;
  let smsProvider: FakeSmsProvider;

  function buildConfig(): ConfigService {
    return new ConfigService({
      app: { appEnvironment: 'test' },
      auth: {
        accessTokenTtlSeconds: 900,
        jwtSecret,
        otpHashSecret: 'test-otp-hash-secret-that-is-at-least-32-characters',
        refreshTokenTtlSeconds: 3600,
        enableDevelopmentOtp: false,
        maxActiveSessions: 10,
      },
      otp: {
        smsCodeLength: 6,
        ttlSeconds: 300,
        maxAttempts: 3,
        resendInitialSeconds: 60,
        maxSendsPerPhoneHour: 5,
        maxSendsPerIpHour: 20,
        blockSeconds: 900,
      },
      authRateLimit: {
        requestCodeMaxPerDevicePerHour: 10,
        requestCodeGlobalMaxPerMinute: 500,
        verifyCodeMaxPerMinute: 10,
      },
    });
  }

  beforeEach(() => {
    const configService = buildConfig();
    jwtService = new JwtService();
    prisma = new FakePrisma();
    smsProvider = new FakeSmsProvider();
    const redis = new FakeRedis();
    const otpService = new OtpService(
      configService,
      prisma as unknown as PrismaService,
      redis as never,
      new SmsTemplateService(),
      smsProvider,
    );
    const rateLimit = new AuthRateLimitService(configService, redis as never);

    authService = new AuthService(
      configService,
      jwtService,
      new PhoneNormalizer(),
      prisma as unknown as PrismaService,
      otpService,
      rateLimit,
    );
  });

  it('registers a new passenger and normalizes the phone', async () => {
    const tokens = await requestAndVerify('8 (999) 000-00-00');
    const user = prisma.usersByPhone.get(phone);
    const payload = await jwtService.verifyAsync<AccessTokenPayload>(
      tokens.accessToken,
      { secret: jwtSecret },
    );
    const session = [...prisma.sessions.values()][0];

    expect(smsProvider.lastPhone).toBe(phone);
    expect(user).toMatchObject({ phone, role: 'PASSENGER', status: 'ACTIVE' });
    expect(payload.roles).toEqual(['PASSENGER']);
    expect(session?.refreshTokenHash).toMatch(/^scrypt\$/);
    expect(session?.refreshTokenHash).not.toContain(tokens.refreshToken);
    expect(session?.tokenFamilyId).toBeTruthy();
  });

  it('signs in an existing user and keeps their role', async () => {
    prisma.usersByPhone.set(phone, {
      id: randomUUID(),
      phone,
      role: 'DRIVER',
      status: 'ACTIVE',
    });

    const tokens = await requestAndVerify(phone);
    const payload = await jwtService.verifyAsync<AccessTokenPayload>(
      tokens.accessToken,
      { secret: jwtSecret },
    );

    expect(prisma.usersByPhone.size).toBe(1);
    expect(payload.roles).toEqual(['DRIVER']);
  });

  it('blocks login for a suspended driver', async () => {
    prisma.usersByPhone.set(phone, {
      id: randomUUID(),
      phone,
      role: 'DRIVER',
      status: 'ACTIVE',
    });
    prisma.driverProfile.findUnique = async () => ({
      verificationStatus: 'SUSPENDED',
    });

    const { requestId } = await authService.requestCode({
      phone,
      deviceId: 'test-device',
      ip: '1.2.3.4',
    });
    if (!smsProvider.lastCode) throw new Error('OTP was not captured');

    const error = await captureError(
      authService.verifyCode({
        requestId,
        phone,
        code: smsProvider.lastCode,
        deviceId: 'test-device',
        platform: AuthDevicePlatform.ANDROID,
        ip: '1.2.3.4',
      }),
    );

    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({ code: 'DRIVER_SUSPENDED' });
  });

  it('rejects an incorrect OTP', async () => {
    const { requestId } = await authService.requestCode({
      phone,
      deviceId: 'test-device',
      ip: '1.2.3.4',
    });

    const error = await captureError(
      authService.verifyCode({
        requestId,
        phone,
        code: '000001',
        deviceId: 'test-device',
        platform: AuthDevicePlatform.ANDROID,
        ip: '1.2.3.4',
      }),
    );

    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: 'INVALID_OTP' });
    expect(prisma.usersByPhone.size).toBe(0);
  });

  it('blocks OTP verification after the maximum attempts', async () => {
    const { requestId } = await authService.requestCode({
      phone,
      deviceId: 'test-device',
      ip: '1.2.3.4',
    });
    const wrongInput = {
      requestId,
      phone,
      code: '000001',
      deviceId: 'test-device',
      platform: AuthDevicePlatform.ANDROID,
      ip: '1.2.3.4',
    };

    await captureError(authService.verifyCode(wrongInput));
    await captureError(authService.verifyCode(wrongInput));
    const error = await captureError(authService.verifyCode(wrongInput));

    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({ code: 'OTP_BLOCKED' });
  });

  it('refuses to issue a code to a device with an active admin block', async () => {
    prisma.authBlock.findFirst = async () => ({
      id: randomUUID(),
      deviceId: 'blocked-device',
      unblockedAt: null,
      expiresAt: null,
    });

    const error = await captureError(
      authService.requestCode({
        phone,
        deviceId: 'blocked-device',
        ip: '1.2.3.4',
      }),
    );

    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({ code: 'DEVICE_BLOCKED' });
  });

  it('rotates a refresh token, preserving the token family', async () => {
    const initial = await requestAndVerify(phone);
    const rotated = await authService.refresh({
      refreshToken: initial.refreshToken,
      ip: '1.2.3.4',
    });

    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    const session = [...prisma.sessions.values()][0];
    expect(session?.lastIpHash).toBeTruthy();

    await expect(
      authService.refresh({
        refreshToken: rotated.refreshToken,
        ip: '1.2.3.4',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      }),
    );
  });

  it('detects reuse of an old refresh token, revokes the whole family, and logs a security event', async () => {
    const initial = await requestAndVerify(phone);
    await authService.refresh({
      refreshToken: initial.refreshToken,
      ip: '1.2.3.4',
    });

    const error = await captureError(
      authService.refresh({
        refreshToken: initial.refreshToken,
        ip: '1.2.3.4',
      }),
    );
    const session = [...prisma.sessions.values()][0];

    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    expect(session?.revokedAt).toBeInstanceOf(Date);
    expect(session?.revokeReason).toBe('REFRESH_TOKEN_REUSE');
    expect(prisma.securityEvents).toHaveLength(1);
    expect(prisma.securityEvents[0]).toMatchObject({
      type: 'REFRESH_TOKEN_REUSE',
    });
  });

  it('revokes only the selected device session on logout', async () => {
    await requestAndVerify(phone, 'device-one');
    await requestAndVerify(phone, 'device-two');
    const firstSession = [...prisma.sessions.values()].find(
      (session) => session.deviceId === 'device-one',
    );
    const secondSession = [...prisma.sessions.values()].find(
      (session) => session.deviceId === 'device-two',
    );
    const user = prisma.usersByPhone.get(phone);

    if (!firstSession || !secondSession || !user) {
      throw new Error('Test sessions were not created');
    }

    await authService.logout({
      id: user.id,
      phone: user.phone,
      role: user.role,
      sessionId: firstSession.id,
    });

    expect(firstSession.revokedAt).toBeInstanceOf(Date);
    expect(secondSession.revokedAt).toBeNull();
  });

  it('logout-all revokes every session for the user', async () => {
    await requestAndVerify(phone, 'device-one');
    await requestAndVerify(phone, 'device-two');
    const user = prisma.usersByPhone.get(phone)!;

    await authService.logoutAll({
      id: user.id,
      phone: user.phone,
      role: user.role,
      sessionId: 'irrelevant',
    });

    const sessions = [...prisma.sessions.values()];
    expect(sessions.every((session) => session.revokedAt instanceof Date)).toBe(
      true,
    );
  });

  it('lists active sessions with the current one flagged', async () => {
    const tokens = await requestAndVerify(phone, 'device-one');
    const payload = await jwtService.verifyAsync<AccessTokenPayload>(
      tokens.accessToken,
      { secret: jwtSecret },
    );
    const user = prisma.usersByPhone.get(phone)!;

    const sessions = await authService.listSessions({
      id: user.id,
      phone: user.phone,
      role: user.role,
      sessionId: payload.sessionId,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      deviceId: 'device-one',
      isCurrent: true,
    });
  });

  it('getChannels reports SMS as the only available channel', () => {
    const { channels } = authService.getChannels();
    const sms = channels.find((entry) => entry.channel === 'SMS');
    expect(sms?.available).toBe(true);
    expect(channels.filter((entry) => entry.available)).toHaveLength(1);
  });

  async function requestAndVerify(
    inputPhone: string,
    deviceId = 'test-device',
  ) {
    const { requestId } = await authService.requestCode({
      phone: inputPhone,
      deviceId,
      ip: '1.2.3.4',
    });
    if (!smsProvider.lastCode) throw new Error('OTP was not captured');

    return authService.verifyCode({
      requestId,
      phone: inputPhone,
      code: smsProvider.lastCode,
      deviceId,
      platform: AuthDevicePlatform.ANDROID,
      ip: '1.2.3.4',
    });
  }
});

describe('DevelopmentSmsProvider', () => {
  it('refuses to initialize in production', () => {
    const configService = new ConfigService({
      app: { environment: 'production', appEnvironment: 'production' },
    });

    expect(() => new DevelopmentSmsProvider(configService)).toThrow(
      'DevelopmentSmsProvider must not be used in staging or production',
    );
  });
});

async function captureError(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected promise to reject');
}
