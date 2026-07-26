import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { PhoneNormalizer } from './phone-normalizer.service.js';
import { DevelopmentSmsProvider } from './providers/development-sms.provider.js';
import { SMS_PROVIDER } from './providers/sms-provider.interface.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PhoneNormalizer,
    AccessTokenGuard,
    RolesGuard,
    DevelopmentSmsProvider,
    {
      provide: SMS_PROVIDER,
      useExisting: DevelopmentSmsProvider,
    },
  ],
  exports: [JwtModule, AccessTokenGuard, RolesGuard],
})
export class AuthModule {}
