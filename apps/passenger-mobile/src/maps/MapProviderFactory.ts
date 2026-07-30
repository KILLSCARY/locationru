import type { ComponentType } from 'react';
import { USE_MOCKS } from '@/config/env';
import type { MapAdapterProps, MapProviderName } from './MapAdapter';
import { DevelopmentMapView } from './DevelopmentMapView';

/**
 * Selects the map view implementation from `EXPO_PUBLIC_MAP_PROVIDER`. Mirrors
 * the backend's `createMapsProvider` factory: `development` is a fully
 * offline view and MUST NOT ship in production; `yandex` is the real
 * provider, and — because no native Yandex MapKit React Native binding is
 * wired into this build yet (see docs/maps/mobile-map-architecture.md for the
 * seam) — it currently falls back to the development view outside
 * production and throws in production rather than silently pretending to be
 * a real map.
 */
export function resolveMapProviderName(): MapProviderName {
  const raw = process.env.EXPO_PUBLIC_MAP_PROVIDER ?? 'development';
  return raw === 'yandex' ? 'yandex' : 'development';
}

export function getMapView(): ComponentType<
  MapAdapterProps & { ref?: React.Ref<import('./MapAdapter').MapAdapterHandle> }
> {
  const provider = resolveMapProviderName();
  const isProduction = process.env.NODE_ENV === 'production';

  // Never honored in production — USE_MOCKS is a staging QA/demo
  // convenience, not a way to bypass the production safety check below.
  if (USE_MOCKS && !isProduction) return DevelopmentMapView;

  if (provider === 'development') {
    if (isProduction) {
      throw new Error(
        'DevelopmentMapView is forbidden in production builds; set EXPO_PUBLIC_MAP_PROVIDER=yandex',
      );
    }
    return DevelopmentMapView;
  }

  const apiKey = process.env.EXPO_PUBLIC_MAP_API_KEY ?? '';
  if (!apiKey) {
    if (isProduction) {
      throw new Error(
        'EXPO_PUBLIC_MAP_API_KEY is required when EXPO_PUBLIC_MAP_PROVIDER=yandex',
      );
    }
    console.warn(
      'EXPO_PUBLIC_MAP_API_KEY is empty; falling back to DevelopmentMapView for local development',
    );
    return DevelopmentMapView;
  }

  // No real map SDK is wired into this build yet — see docs/maps/mobile-map-architecture.md.
  console.warn(
    'A Yandex map API key is configured, but no native map SDK is wired into this build yet; using DevelopmentMapView',
  );
  return DevelopmentMapView;
}
