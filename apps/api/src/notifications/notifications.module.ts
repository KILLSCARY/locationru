import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DeviceTokenRateLimitService } from './device-token-rate-limit.service.js';
import { DeviceTokenController } from './device-token.controller.js';
import { DeviceTokenService } from './device-token.service.js';
import { PushTokenCryptoService } from './infrastructure/push-token-crypto.service.js';
import { ApnsPushProvider } from './providers/apns-push.provider.js';
import { DevelopmentPushProvider } from './providers/development-push.provider.js';
import { FirebasePushProvider } from './providers/firebase-push.provider.js';
import { PushProviderResolver } from './providers/push-provider.resolver.js';
import { StagingPushProvider } from './providers/staging-push.provider.js';
import { NotificationOutboxService } from './notification-outbox.service.js';
import { NotificationOutboxWorker } from './notification-outbox.worker.js';
import { NotificationService } from './notification.service.js';
import { DevicePushTokenRepository } from './repositories/device-push-token.repository.js';
import { NotificationTemplateService } from './templates/notification-template.service.js';

@Module({
  imports: [AuthModule],
  controllers: [DeviceTokenController],
  providers: [
    DeviceTokenService,
    DeviceTokenRateLimitService,
    DevicePushTokenRepository,
    PushTokenCryptoService,
    NotificationTemplateService,
    NotificationService,
    NotificationOutboxService,
    NotificationOutboxWorker,
    PushProviderResolver,
    DevelopmentPushProvider,
    StagingPushProvider,
    FirebasePushProvider,
    ApnsPushProvider,
  ],
  exports: [
    DevicePushTokenRepository,
    NotificationTemplateService,
    NotificationService,
    NotificationOutboxService,
    NotificationOutboxWorker,
    PushProviderResolver,
  ],
})
export class NotificationsModule {}
