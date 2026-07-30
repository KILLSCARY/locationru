import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

import { DevelopmentMapsProvider } from './development-maps.provider.js';
import type { MapsProvider } from './maps-provider.interface.js';
import { YandexMapsProvider } from './yandex-maps.provider.js';

/**
 * Selects the maps provider from configuration.
 *
 * - `development` is fully offline and MUST NOT run in production (enforced here
 *   and in env validation). It is also refused in staging unless
 *   MAPS_ALLOW_DEVELOPMENT_IN_STAGING=true — env validation is the actual
 *   gate for that (it rejects MAPS_PROVIDER=development in staging without
 *   the flag before the app even reaches this factory), so this function
 *   only needs its own production check as defence in depth.
 * - `yandex` is the real adapter. If its API key is missing outside production,
 *   we fall back to the development provider so local runs work without a key.
 */
export function createMapsProvider(config: ConfigService): MapsProvider {
  const logger = new Logger('MapsProviderFactory');
  const provider = config.getOrThrow<'development' | 'yandex'>('maps.provider');
  const environment = config.getOrThrow<AppEnvironment>('app.appEnvironment');
  const isProduction = environment === AppEnvironment.PRODUCTION;

  if (provider === 'development') {
    if (isProduction) {
      throw new Error(
        'DevelopmentMapsProvider is forbidden in production; set MAPS_PROVIDER=yandex',
      );
    }
    return new DevelopmentMapsProvider();
  }

  const apiKey = config.get<string>('maps.apiKey') ?? '';
  if (!apiKey) {
    if (isProduction) {
      throw new Error('MAPS_API_KEY is required when MAPS_PROVIDER=yandex');
    }
    logger.warn(
      'MAPS_API_KEY is empty; falling back to DevelopmentMapsProvider for local development',
    );
    return new DevelopmentMapsProvider();
  }

  return new YandexMapsProvider({
    apiKey,
    apiBaseUrl: config.getOrThrow<string>('maps.apiBaseUrl'),
    timeoutMs: config.getOrThrow<number>('maps.timeoutMs'),
    maxRetries: config.getOrThrow<number>('maps.maxRetries'),
    userAgent: config.getOrThrow<string>('maps.userAgent'),
  });
}
