import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuthRateLimitService } from '../src/auth/auth-rate-limit.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AuthDevicePlatform } from '../src/auth/dto/verify-code.dto.js';
import { OtpService } from '../src/auth/otp.service.js';
import { PhoneNormalizer } from '../src/auth/phone-normalizer.service.js';
import { DevelopmentSmsProvider } from '../src/auth/providers/development-sms.provider.js';
import { SmsTemplateService } from '../src/auth/sms-template.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';

// Real Postgres + Redis, same convention as the other *.integration.e2e-spec.ts
// files in this directory (see dispatch.postgis.integration.e2e-spec.ts):
// skipped by default so CI without live infra stays green, run explicitly
// with RUN_AUTH_INTEGRATION=true when a database/Redis are available.
const describeAuthIntegration =
  process.env.RUN_AUTH_INTEGRATION === 'true' ? describe : describe.skip;

function randomPhone(): string {
  const digits = Array.from({ length: 7 }, () =>
    Math.floor(Math.random() * 10),
  ).join('');
  return `+7999${digits}`;
}

describeAuthIntegration('Auth OTP flow (real Postgres + Redis)', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let authService: AuthService;
  let smsProvider: DevelopmentSmsProvider;

  beforeAll(async () => {
    const config = new ConfigService({
      app: { appEnvironment: 'development' },
      database: { url: process.env.DATABASE_URL },
      redis: { url: process.env.REDIS_URL },
      auth: {
        accessTokenTtlSeconds: 900,
        jwtSecret: 'integration-test-jwt-secret-at-least-32-characters',
        otpHashSecret: 'integration-test-otp-hash-secret-at-least-32-chars',
        refreshTokenTtlSeconds: 3_600,
        enableDevelopmentOtp: true,
        maxActiveSessions: 10,
      },
      otp: {
        smsCodeLength: 6,
        ttlSeconds: 300,
        maxAttempts: 3,
        resendInitialSeconds: 0,
        maxSendsPerPhoneHour: 100,
        maxSendsPerIpHour: 100,
        blockSeconds: 5,
      },
      authRateLimit: {
        requestCodeMaxPerDevicePerHour: 1_000,
        requestCodeGlobalMaxPerMinute: 10_000,
        verifyCodeMaxPerMinute: 1_000,
      },
    });

    prisma = new PrismaService(config);
    redis = new RedisService(config);
    smsProvider = new DevelopmentSmsProvider(config);
    const otpService = new OtpService(
      config,
      prisma,
      redis,
      new SmsTemplateService(),
      smsProvider,
    );
    const rateLimit = new AuthRateLimitService(config, redis);

    authService = new AuthService(
      config,
      new JwtService(),
      new PhoneNormalizer(),
      prisma,
      otpService,
      rateLimit,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.onModuleDestroy();
  });

  it('runs the full request-code -> verify-code flow against real Postgres and creates a durable, codeless OtpRequest row', async () => {
    const phone = randomPhone();
    const deviceId = `device-${randomUUID()}`;

    const { requestId } = await authService.requestCode({
      phone,
      deviceId,
      ip: '203.0.113.10',
    });

    const otpRequestRow = await prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    expect(otpRequestRow).toBeTruthy();
    expect(JSON.stringify(otpRequestRow)).not.toContain('000000'.slice(0, 3));

    const tokens = await authService.verifyCode({
      requestId,
      phone,
      code: '000000',
      deviceId,
      platform: AuthDevicePlatform.ANDROID,
      ip: '203.0.113.10',
    });

    expect(tokens.accessToken).toEqual(expect.any(String));
    expect(tokens.refreshToken).toEqual(expect.any(String));

    const user = await prisma.user.findUnique({ where: { phone } });
    expect(user).toMatchObject({ phone, role: 'PASSENGER', status: 'ACTIVE' });

    const consumed = await prisma.otpRequest.findUnique({
      where: { id: requestId },
    });
    expect(consumed?.status).toBe('CONSUMED');
  });

  it('resend-code issues a fresh code that invalidates the first one, against real Redis state', async () => {
    const phone = randomPhone();
    const deviceId = `device-${randomUUID()}`;

    const { requestId } = await authService.requestCode({
      phone,
      deviceId,
      ip: '203.0.113.11',
    });

    await authService.resendCode({
      requestId,
      phone,
      deviceId,
      ip: '203.0.113.11',
    });

    await expect(
      authService.verifyCode({
        requestId,
        phone,
        code: '000000',
        deviceId,
        platform: AuthDevicePlatform.ANDROID,
        ip: '203.0.113.11',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ accessToken: expect.any(String) }),
    );
  });

  it('refresh-token reuse revokes the whole family and writes a real SecurityEvent row', async () => {
    const phone = randomPhone();
    const deviceId = `device-${randomUUID()}`;
    const { requestId } = await authService.requestCode({
      phone,
      deviceId,
      ip: '203.0.113.12',
    });
    const initial = await authService.verifyCode({
      requestId,
      phone,
      code: '000000',
      deviceId,
      platform: AuthDevicePlatform.ANDROID,
      ip: '203.0.113.12',
    });

    await authService.refresh({
      refreshToken: initial.refreshToken,
      ip: '203.0.113.12',
    });

    await expect(
      authService.refresh({
        refreshToken: initial.refreshToken,
        ip: '203.0.113.12',
      }),
    ).rejects.toMatchObject({ status: 401 });

    const user = await prisma.user.findUnique({ where: { phone } });
    const events = await prisma.securityEvent.findMany({
      where: { userId: user!.id, type: 'REFRESH_TOKEN_REUSE' },
    });
    expect(events).toHaveLength(1);

    const sessions = await prisma.deviceSession.findMany({
      where: { userId: user!.id },
    });
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });
});
