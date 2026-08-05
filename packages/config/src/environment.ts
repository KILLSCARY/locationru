/**
 * The deployment tier the application is running under. Orthogonal to
 * Node's own NODE_ENV (development/production/test), which only governs
 * npm-ecosystem behavior (dependency pruning, framework dev-mode warnings,
 * etc.). APP_ENV is the single axis that application code branches on for
 * security-relevant behavior — never `process.env.NODE_ENV !== 'production'`.
 */
export const AppEnvironment = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  STAGING: 'staging',
  PRODUCTION: 'production',
} as const;

export type AppEnvironment =
  (typeof AppEnvironment)[keyof typeof AppEnvironment];

export const APP_ENVIRONMENT_VALUES: readonly AppEnvironment[] = Object.values(
  AppEnvironment,
) as AppEnvironment[];

export function isAppEnvironment(value: string): value is AppEnvironment {
  return (APP_ENVIRONMENT_VALUES as readonly string[]).includes(value);
}

export function parseAppEnvironment(value: string | undefined): AppEnvironment {
  if (!value || !isAppEnvironment(value)) {
    throw new Error(
      `Invalid APP_ENV "${value ?? ''}"; expected one of: ${APP_ENVIRONMENT_VALUES.join(', ')}`,
    );
  }
  return value;
}

/**
 * Precomputed booleans for the common checks, so call sites never compare
 * against a string literal directly (that's how `!== 'production'` typos
 * happen).
 */
export interface EnvironmentFlags {
  environment: AppEnvironment;
  isDevelopment: boolean;
  isTest: boolean;
  isStaging: boolean;
  isProduction: boolean;
  /** Staging or production — a real, network-reachable deployment. */
  isDeployed: boolean;
  /** Staging or production — where safety guards apply (no dev providers, no demo secrets, ...). */
  requiresHardenedConfig: boolean;
}

export function environmentFlags(
  environment: AppEnvironment,
): EnvironmentFlags {
  const isDevelopment = environment === AppEnvironment.DEVELOPMENT;
  const isTest = environment === AppEnvironment.TEST;
  const isStaging = environment === AppEnvironment.STAGING;
  const isProduction = environment === AppEnvironment.PRODUCTION;

  return {
    environment,
    isDevelopment,
    isTest,
    isStaging,
    isProduction,
    isDeployed: isStaging || isProduction,
    requiresHardenedConfig: isStaging || isProduction,
  };
}
