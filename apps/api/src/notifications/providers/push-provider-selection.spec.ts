import { AppEnvironment } from '@resilient-taxi/config';

import {
  PushPlatform,
  PushProviderType,
} from '../../generated/prisma/enums.js';
import { determinePushProviderType } from './push-provider-selection.js';

describe('determinePushProviderType', () => {
  it('always uses DevelopmentPushProvider in development, regardless of configured provider or platform', () => {
    expect(
      determinePushProviderType(
        AppEnvironment.DEVELOPMENT,
        PushPlatform.ANDROID,
        PushProviderType.FCM,
      ),
    ).toBe(PushProviderType.DEVELOPMENT);
    expect(
      determinePushProviderType(
        AppEnvironment.DEVELOPMENT,
        PushPlatform.IOS,
        PushProviderType.APNS,
      ),
    ).toBe(PushProviderType.DEVELOPMENT);
  });

  it('always routes production by platform to real FCM/APNS, regardless of configured provider', () => {
    expect(
      determinePushProviderType(
        AppEnvironment.PRODUCTION,
        PushPlatform.ANDROID,
        PushProviderType.STAGING,
      ),
    ).toBe(PushProviderType.FCM);
    expect(
      determinePushProviderType(
        AppEnvironment.PRODUCTION,
        PushPlatform.IOS,
        PushProviderType.STAGING,
      ),
    ).toBe(PushProviderType.APNS);
  });

  it('defaults staging to the safe StagingPushProvider fake', () => {
    expect(
      determinePushProviderType(
        AppEnvironment.STAGING,
        PushPlatform.ANDROID,
        PushProviderType.STAGING,
      ),
    ).toBe(PushProviderType.STAGING);
    expect(
      determinePushProviderType(
        AppEnvironment.STAGING,
        PushPlatform.IOS,
        PushProviderType.DEVELOPMENT,
      ),
    ).toBe(PushProviderType.STAGING);
  });

  it('routes staging by platform to real FCM/APNS when explicitly configured, for staging:test:push', () => {
    expect(
      determinePushProviderType(
        AppEnvironment.STAGING,
        PushPlatform.ANDROID,
        PushProviderType.FCM,
      ),
    ).toBe(PushProviderType.FCM);
    expect(
      determinePushProviderType(
        AppEnvironment.STAGING,
        PushPlatform.IOS,
        PushProviderType.FCM,
      ),
    ).toBe(PushProviderType.APNS);
  });

  it('falls back to StagingPushProvider in the test environment (safe default for automated tests)', () => {
    expect(
      determinePushProviderType(
        AppEnvironment.TEST,
        PushPlatform.ANDROID,
        PushProviderType.STAGING,
      ),
    ).toBe(PushProviderType.STAGING);
  });
});
