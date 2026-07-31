import { ConfigService } from '@nestjs/config';

import { DevelopmentPushProvider } from './development-push.provider.js';
import { PushProviderResolver } from './push-provider.resolver.js';
import { StagingPushProvider } from './staging-push.provider.js';

describe('PushProviderResolver', () => {
  function build(appEnvironment: string) {
    const config = new ConfigService({ app: { appEnvironment } });
    const development = new DevelopmentPushProvider(config);
    const staging =
      appEnvironment === 'production'
        ? undefined
        : new StagingPushProvider(config, {
            checkConnection: async () => undefined,
          } as never);
    const firebase = { name: 'FCM' } as never;
    const apns = { name: 'APNS' } as never;
    const resolver = new PushProviderResolver(
      config,
      development,
      staging as StagingPushProvider,
      firebase,
      apns,
    );
    return { resolver, development, firebase, apns };
  }

  it('resolves each provider type to its matching instance', () => {
    const { resolver, development, firebase, apns } = build('development');
    expect(resolver.resolve('DEVELOPMENT' as never)).toBe(development);
    expect(resolver.resolve('FCM' as never)).toBe(firebase);
    expect(resolver.resolve('APNS' as never)).toBe(apns);
  });

  it('refuses DevelopmentPushProvider in staging or production', () => {
    const { resolver } = build('staging');
    expect(() => resolver.resolve('DEVELOPMENT' as never)).toThrow(
      'must not be used in staging or production',
    );
  });

  it('refuses StagingPushProvider in production', () => {
    const { resolver } = build('production');
    expect(() => resolver.resolve('STAGING' as never)).toThrow(
      'must not be used in production',
    );
  });

  it('allows StagingPushProvider in staging and development', () => {
    const { resolver } = build('staging');
    expect(() => resolver.resolve('STAGING' as never)).not.toThrow();
  });
});
