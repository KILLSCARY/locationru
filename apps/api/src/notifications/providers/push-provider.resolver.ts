import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import { PushProviderType } from '../../generated/prisma/enums.js';
import type { PushProvider } from '../domain/push-provider.interface.js';
import { ApnsPushProvider } from './apns-push.provider.js';
import { DevelopmentPushProvider } from './development-push.provider.js';
import { FirebasePushProvider } from './firebase-push.provider.js';
import { StagingPushProvider } from './staging-push.provider.js';

/**
 * Resolves which concrete PushProvider handles a given send, based on the
 * DevicePushToken's own `provider` column — this is a per-send decision
 * (unlike auth's single SMS_PROVIDER), since a batch of recipients can mix
 * platforms/providers. All four concrete providers are always constructible
 * by Nest DI (Firebase/Apns lazily initialize their SDK client on first
 * use, never in their constructor — see FirebasePushProvider), so this
 * resolver is the only place that enforces "never Development/Staging in
 * production" for push, mirroring createSmsProvider's env gate.
 */
@Injectable()
export class PushProviderResolver {
  constructor(
    private readonly config: ConfigService,
    private readonly development: DevelopmentPushProvider,
    private readonly staging: StagingPushProvider,
    private readonly firebase: FirebasePushProvider,
    private readonly apns: ApnsPushProvider,
  ) {}

  resolve(providerType: PushProviderType): PushProvider {
    const environment =
      this.config.getOrThrow<AppEnvironment>('app.appEnvironment');

    if (
      providerType === PushProviderType.DEVELOPMENT &&
      (environment === AppEnvironment.STAGING ||
        environment === AppEnvironment.PRODUCTION)
    ) {
      throw new Error(
        'DevelopmentPushProvider must not be used in staging or production',
      );
    }
    if (
      providerType === PushProviderType.STAGING &&
      environment === AppEnvironment.PRODUCTION
    ) {
      throw new Error('StagingPushProvider must not be used in production');
    }

    switch (providerType) {
      case PushProviderType.DEVELOPMENT:
        return this.development;
      case PushProviderType.STAGING:
        return this.staging;
      case PushProviderType.FCM:
        return this.firebase;
      case PushProviderType.APNS:
        return this.apns;
    }
  }
}
