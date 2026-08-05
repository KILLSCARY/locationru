import { ConfigService } from '@nestjs/config';

import { MapsCacheService } from './maps-cache.service.js';
import { MapsService } from './maps.service.js';
import { DevelopmentMapsProvider } from './providers/development-maps.provider.js';
import { YandexMapsProvider } from './providers/yandex-maps.provider.js';

describe('MapsService provider selection', () => {
  const cache = {} as MapsCacheService;

  it('forbids the development provider in production', () => {
    const config = new ConfigService({
      app: { environment: 'production' },
      maps: { provider: 'development' },
    });
    expect(
      () =>
        new MapsService(
          config,
          cache,
          new DevelopmentMapsProvider(),
          new YandexMapsProvider(config),
        ),
    ).toThrow('DevelopmentMapsProvider must not run in production');
  });

  it('falls back offline only outside production when a real key is absent', () => {
    const config = new ConfigService({
      app: { environment: 'development' },
      maps: { provider: 'yandex' },
    });
    const development = new DevelopmentMapsProvider();
    const service = new MapsService(
      config,
      cache,
      development,
      new YandexMapsProvider(config),
    );
    expect(service.provider).toBe(development);
  });
});
