import { AppEnvironment } from '@resilient-taxi/config';

import { PushPlatform, PushProviderType } from '../../generated/prisma/enums.js';

/**
 * Decides which PushProviderType a newly-registered device token should be
 * stored with. This runs once at registration time (the result is persisted
 * on DevicePushToken.provider and later just looked up by
 * PushProviderResolver.resolve at send time) — it is not re-evaluated per
 * send.
 *
 * Development and production are hard-wired and ignore the configured
 * PUSH_PROVIDER value entirely, mirroring createSmsProvider's env gate:
 * development always gets the logging-only DevelopmentPushProvider, and
 * production always gets a real, platform-routed provider (FCM for
 * Android, APNS for iOS — see docs/notifications/apns.md for the Variant B
 * FCM->APNs routing this implies).
 *
 * Staging honors PUSH_PROVIDER: 'staging' (the default, a safe in-memory
 * fake) or 'fcm'/'apns' to route through the real *staging* Firebase
 * project — this is what lets `pnpm staging:test:push` deliver an actual
 * push to a registered staging device.
 */
export function determinePushProviderType(
  environment: AppEnvironment,
  platform: PushPlatform,
  configuredProvider: PushProviderType,
): PushProviderType {
  if (environment === AppEnvironment.PRODUCTION) {
    return platform === PushPlatform.IOS
      ? PushProviderType.APNS
      : PushProviderType.FCM;
  }

  if (environment === AppEnvironment.DEVELOPMENT) {
    return PushProviderType.DEVELOPMENT;
  }

  if (
    configuredProvider === PushProviderType.FCM ||
    configuredProvider === PushProviderType.APNS
  ) {
    return platform === PushPlatform.IOS
      ? PushProviderType.APNS
      : PushProviderType.FCM;
  }

  return PushProviderType.STAGING;
}
