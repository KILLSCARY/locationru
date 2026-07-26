import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { AuthService } from './auth.service.js';
import type { AccessTokenPayload } from './auth.types.js';
import {
  AuthDevicePlatform,
  type VerifyCodeDto,
} from './dto/verify-code.dto.js';
import { PhoneNormalizer } from './phone-normalizer.service.js';
import { DevelopmentSmsProvider } from './providers/development-sms.provider.js';
import type { SmsProvider } from './providers/sms-provider.interface.js';

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
  refreshTokenHash: string;
  lastSeenAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

class FakeSmsProvider implements SmsProvider {
  lastCode: string | undefined;
  lastPhone: string | undefined;

  async sendCode(phone: string, code: string): Promise<void> {
    this.lastPhone = phone;
    this.lastCode = code;
  }
}

class FakeRedis {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setWithTtl(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    this.values.set(key, value);
    this.ttls.set(key, ttlSeconds);
  }

  async increment(key: string): Promise<number> {
    const value = Number(this.values.get(key) ?? 0) + 1;
    this.values.set(key, value.toString());
    return value;
  }

  async setExpiry(key: string, ttlSeconds: number): Promise<void> {
    this.ttls.set(key, ttlSeconds);
  }

  async getTtl(key: string): Promise<number> {
    return this.ttls.get(key) ?? -2;
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.ttls.delete(key);
  }
}

class FakePrisma {
  readonly usersByPhone = new Map<string, TestUser>();
  readonly sessions = new Map<string, TestSession>();
  readonly user: {
    findUnique(input: { where: { phone: string } }): Promise<TestUser | null>;
    create(input: { data: Omit<TestUser, 'id'> }): Promise<TestUser>;
    update(input: {
      where: { id: string };
      data: Partial<TestUser>;
    }): Promise<TestUser>;
  };

  constructor() {
    this.user = {
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
  }

  readonly deviceSession = {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { userId_deviceId: { userId: string; deviceId: string } };
      create: TestSession;
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
    updateMany: async ({
      where,
      data,
    }: {
      where: Partial<TestSession>;
      data: Partial<TestSession>;
    }) => {
      let count = 0;
      for (const session of this.sessions.values()) {
        const matches = Object.entries(where).every(
          ([key, value]) => session[key as keyof TestSession] === value,
        );
        if (matches) {
          Object.assign(session, data);
          count += 1;
        }
      }
      return { count };
    },
  };
}

describe('AuthService', () => {
  const phone = '+79990000000';
  const jwtSecret = 'test-access-token-secret-that-is-at-least-32-characters';
  let authService: AuthService;
  let jwtService: JwtService;
  let prisma: FakePrisma;
  let redis: FakeRedis;
  let smsProvider: FakeSmsProvider;

  beforeEach(() => {
    const configService = new ConfigService({
      auth: {
        accessTokenTtlSeconds: 900,
        jwtSecret,
        otpHashSecret: 'test-otp-hash-secret-that-is-at-least-32-characters',
        otpMaxAttempts: 3,
        otpRequestLimit: 3,
        otpRequestWindowSeconds: 60,
        otpTtlSeconds: 300,
        refreshTokenTtlSeconds: 3600,
      },
    });
    jwtService = new JwtService();
    prisma = new FakePrisma();
    redis = new FakeRedis();
    smsProvider = new FakeSmsProvider();
    authService = new AuthService(
      configService,
      jwtService,
      new PhoneNormalizer(),
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      smsProvider,
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
    expect(user).toMatchObject({
      phone,
      role: 'PASSENGER',
      status: 'ACTIVE',
    });
    expect(payload.roles).toEqual(['PASSENGER']);
    expect(session?.refreshTokenHash).toMatch(/^scrypt\$/);
    expect(session?.refreshTokenHash).not.toContain(tokens.refreshToken);
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

  it('rejects an incorrect OTP', async () => {
    await authService.requestCode(phone);

    const error = await captureError(
      authService.verifyCode(verificationInput('000000')),
    );

    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: 'INVALID_OTP' });
    expect(prisma.usersByPhone.size).toBe(0);
  });

  it('rejects an expired OTP', async () => {
    await authService.requestCode(phone);
    await redis.delete(`auth:otp:${phone}`);

    const error = await captureError(
      authService.verifyCode(verificationInput('000000')),
    );

    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('blocks OTP verification after the maximum attempts', async () => {
    await authService.requestCode(phone);

    await captureError(authService.verifyCode(verificationInput('000000')));
    await captureError(authService.verifyCode(verificationInput('000000')));
    const error = await captureError(
      authService.verifyCode(verificationInput('000000')),
    );

    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({
      code: 'OTP_ATTEMPTS_EXCEEDED',
    });
  });

  it('rotates a refresh token', async () => {
    const initial = await requestAndVerify(phone);
    const rotated = await authService.refresh(initial.refreshToken);

    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    await expect(authService.refresh(rotated.refreshToken)).resolves.toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      }),
    );
  });

  it('detects reuse of an old refresh token and revokes the session', async () => {
    const initial = await requestAndVerify(phone);
    await authService.refresh(initial.refreshToken);

    const error = await captureError(authService.refresh(initial.refreshToken));
    const session = [...prisma.sessions.values()][0];

    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    expect(session?.revokedAt).toBeInstanceOf(Date);
  });

  it('limits OTP requests per phone and time window', async () => {
    await authService.requestCode(phone);
    await authService.requestCode(phone);
    await authService.requestCode(phone);

    const error = await captureError(authService.requestCode(phone));

    expect(error.getStatus()).toBe(429);
    expect(error.getResponse()).toMatchObject({
      code: 'OTP_RATE_LIMIT_EXCEEDED',
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

  function verificationInput(code: string): VerifyCodeDto {
    return {
      phone,
      code,
      deviceId: 'test-device',
      platform: AuthDevicePlatform.ANDROID,
    };
  }

  async function requestAndVerify(
    inputPhone: string,
    deviceId = 'test-device',
  ) {
    await authService.requestCode(inputPhone);
    if (!smsProvider.lastCode) throw new Error('OTP was not captured');

    return authService.verifyCode({
      ...verificationInput(smsProvider.lastCode),
      phone: inputPhone,
      deviceId,
    });
  }
});

describe('DevelopmentSmsProvider', () => {
  it('refuses to initialize in production', () => {
    const configService = new ConfigService({
      app: { environment: 'production' },
    });

    expect(() => new DevelopmentSmsProvider(configService)).toThrow(
      'DevelopmentSmsProvider must not be used in production',
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
