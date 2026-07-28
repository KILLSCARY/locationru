import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { PhoneNormalizer } from './phone-normalizer.service.js';
import { createSmsProvider } from './providers/sms-provider.factory.js';
import { SMS_PROVIDER } from './providers/sms-provider.interface.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PhoneNormalizer,
    AccessTokenGuard,
    RolesGuard,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createSmsProvider(config),
    },
  ],
  exports: [JwtModule, AccessTokenGuard, RolesGuard],
})
export class AuthModule {}
