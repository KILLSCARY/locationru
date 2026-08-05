export type AppEnv = 'development' | 'staging' | 'production';

/**
 * The passenger app's own environment marker — distinct from Expo's build
 * profile name, set explicitly via EXPO_PUBLIC_APP_ENV (see
 * .env.staging.example) so a staging build is never accidentally
 * indistinguishable from a production one at runtime.
 */
export function resolveAppEnv(): AppEnv {
  const raw = process.env.EXPO_PUBLIC_APP_ENV;
  return raw === 'staging' || raw === 'production' ? raw : 'development';
}

export const APP_ENV = resolveAppEnv();

/**
 * When true, forces every provider-backed screen (maps today) onto its
 * offline/deterministic development implementation regardless of what
 * EXPO_PUBLIC_MAP_PROVIDER says — useful for a staging QA/demo build that
 * needs consistent screenshots without depending on a real map API key or
 * live network conditions.
 */
export function resolveUseMocks(): boolean {
  return process.env.EXPO_PUBLIC_USE_MOCKS === 'true';
}

export const USE_MOCKS = resolveUseMocks();
