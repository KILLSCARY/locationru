import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { RedisService } from '../redis/redis.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { OtpService } from './otp.service.js';
import { PhoneNormalizer } from './phone-normalizer.service.js';
import { createSmsProvider } from './providers/sms-provider.factory.js';
import { SMS_PROVIDER } from './providers/sms-provider.interface.js';
import { SmsTemplateService } from './sms-template.service.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    AuthRateLimitService,
    SmsTemplateService,
    PhoneNormalizer,
    AccessTokenGuard,
    RolesGuard,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) =>
        createSmsProvider(config, redis),
    },
  ],
  exports: [
    JwtModule,
    AccessTokenGuard,
    RolesGuard,
    PhoneNormalizer,
    OtpService,
    SmsTemplateService,
  ],
})
export class AuthModule {}
