import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module.js';
import { createSmsProvider } from '../auth/providers/sms-provider.factory.js';
import { SMS_PROVIDER } from '../auth/providers/sms-provider.interface.js';
import { RedisService } from '../redis/redis.service.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminController, AdminAuthController],
  providers: [
    AdminService,
    AdminAuthService,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) =>
        createSmsProvider(config, redis),
    },
  ],
})
export class AdminModule {}
