import { environmentValidationSchema } from './env.validation.js';

const BASE_STAGING_ENV = {
  APP_ENV: 'staging',
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://:pass@localhost:6379',
  API_PUBLIC_URL: 'https://staging-api.example.com',
  ADMIN_PUBLIC_URL: 'https://staging-admin.example.com',
  AUTH_JWT_SECRET: 'a-real-generated-secret-that-is-32-chars-plus',
  AUTH_OTP_HASH_SECRET: 'another-real-generated-secret-32-chars-plus',
  TRIPS_BOARDING_CODE_HASH_SECRET: 'yet-another-real-secret-32-chars-plus',
  CORS_ALLOWED_ORIGINS: 'https://staging-admin.example.com',
  SMS_PROVIDER: 'staging',
  PAYMENTS_PROVIDER: 'staging',
  PAYMENTS_WEBHOOK_SECRET: 'a-real-staging-webhook-secret-16plus',
  MAPS_PROVIDER: 'yandex',
  MAPS_API_KEY: 'a-real-maps-key',
  OBJECT_STORAGE_ENDPOINT: 'https://storage.example.com',
  OBJECT_STORAGE_BUCKET: 'resilient-taxi-staging',
  OBJECT_STORAGE_ACCESS_KEY: 'a-real-access-key',
  OBJECT_STORAGE_SECRET_KEY: 'a-real-secret-key',
};

function validate(overrides: Record<string, unknown>) {
  return environmentValidationSchema.validate(
    { ...BASE_STAGING_ENV, ...overrides },
    { abortEarly: false, allowUnknown: true },
  );
}

describe('environmentValidationSchema — staging safety', () => {
  it('accepts a fully-configured, safe staging environment', () => {
    const { error } = validate({});
    expect(error).toBeUndefined();
  });

  it('rejects SMS_PROVIDER=development in staging', () => {
    const { error } = validate({ SMS_PROVIDER: 'development' });
    expect(error).toBeDefined();
  });

  it('rejects PAYMENTS_PROVIDER=development in staging', () => {
    const { error } = validate({ PAYMENTS_PROVIDER: 'development' });
    expect(error).toBeDefined();
  });

  it('rejects MAPS_PROVIDER=development in staging without the override flag', () => {
    const { error } = validate({
      MAPS_PROVIDER: 'development',
      MAPS_API_KEY: '',
    });
    expect(error).toBeDefined();
  });

  it('accepts MAPS_PROVIDER=development in staging with the override flag', () => {
    const { error } = validate({
      MAPS_PROVIDER: 'development',
      MAPS_API_KEY: '',
      MAPS_ALLOW_DEVELOPMENT_IN_STAGING: true,
    });
    expect(error).toBeUndefined();
  });

  it('rejects a demo JWT secret', () => {
    const { error } = validate({
      AUTH_JWT_SECRET: 'change-me-access-token-secret-at-least-32-chars',
    });
    expect(error).toBeDefined();
  });

  it('rejects a demo OTP hash secret', () => {
    const { error } = validate({
      AUTH_OTP_HASH_SECRET: 'change-me-otp-hash-secret-at-least-32-chars',
    });
    expect(error).toBeDefined();
  });

  it('rejects a missing DATABASE_URL', () => {
    const { error } = validate({ DATABASE_URL: undefined });
    expect(error).toBeDefined();
  });

  it('rejects a missing REDIS_URL', () => {
    const { error } = validate({ REDIS_URL: undefined });
    expect(error).toBeDefined();
  });

  it('rejects ENABLE_DEVELOPMENT_OTP=true in staging', () => {
    const { error } = validate({ ENABLE_DEVELOPMENT_OTP: true });
    expect(error).toBeDefined();
  });

  it('rejects ENABLE_DEVELOPMENT_PAYMENTS=true in staging', () => {
    const { error } = validate({ ENABLE_DEVELOPMENT_PAYMENTS: true });
    expect(error).toBeDefined();
  });

  it('rejects ENABLE_SWAGGER=true in staging', () => {
    const { error } = validate({ ENABLE_SWAGGER: true });
    expect(error).toBeDefined();
  });

  it('rejects a wildcard CORS_ALLOWED_ORIGINS', () => {
    const { error } = validate({ CORS_ALLOWED_ORIGINS: '*' });
    expect(error).toBeDefined();
  });

  it('rejects a wildcard hiding among other CORS origins', () => {
    const { error } = validate({
      CORS_ALLOWED_ORIGINS: 'https://staging-admin.example.com,*',
    });
    expect(error).toBeDefined();
  });

  it('rejects a missing CORS_ALLOWED_ORIGINS in staging', () => {
    const { error } = validate({ CORS_ALLOWED_ORIGINS: undefined });
    expect(error).toBeDefined();
  });

  it('rejects a wildcard WEBSOCKET_ALLOWED_ORIGINS in any environment', () => {
    const { error } = environmentValidationSchema.validate(
      {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://:pass@localhost:6379',
        AUTH_JWT_SECRET: 'a-real-generated-secret-that-is-32-chars-plus',
        AUTH_OTP_HASH_SECRET: 'another-real-generated-secret-32-chars-plus',
        TRIPS_BOARDING_CODE_HASH_SECRET: 'yet-another-real-secret-32-chars-plus',
        WEBSOCKET_ALLOWED_ORIGINS: '*',
      },
      { abortEarly: false, allowUnknown: true },
    );
    expect(error).toBeDefined();
  });

  it('rejects PAYMENTS_PROVIDER=http in staging without the required fields', () => {
    const { error } = validate({
      PAYMENTS_PROVIDER: 'http',
      PAYMENTS_API_BASE_URL: undefined,
      PAYMENTS_API_KEY: undefined,
    });
    expect(error).toBeDefined();
  });

  it('rejects any non-http provider in production', () => {
    const { error } = validate({
      APP_ENV: 'production',
      SMS_PROVIDER: 'staging',
    });
    expect(error).toBeDefined();
  });
});

describe('environmentValidationSchema — development stays permissive', () => {
  const DEV_ENV = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://:pass@localhost:6379',
    AUTH_JWT_SECRET: 'a-local-dev-secret-that-is-32-chars-long-plus',
    AUTH_OTP_HASH_SECRET: 'another-local-dev-secret-32-chars-plus',
    TRIPS_BOARDING_CODE_HASH_SECRET: 'yet-another-local-secret-32-chars-plus',
  };

  it('defaults APP_ENV to NODE_ENV when unset', () => {
    const { error, value } = environmentValidationSchema.validate(DEV_ENV, {
      abortEarly: false,
      allowUnknown: true,
    });
    expect(error).toBeUndefined();
    expect(value.APP_ENV).toBe('development');
  });

  it('allows the development SMS/payments/maps providers by default', () => {
    const { error } = environmentValidationSchema.validate(
      {
        ...DEV_ENV,
        SMS_PROVIDER: 'development',
        PAYMENTS_PROVIDER: 'development',
        MAPS_PROVIDER: 'development',
      },
      { abortEarly: false, allowUnknown: true },
    );
    expect(error).toBeUndefined();
  });

  it('allows ENABLE_SWAGGER=true in development', () => {
    const { error } = environmentValidationSchema.validate(
      { ...DEV_ENV, ENABLE_SWAGGER: true },
      { abortEarly: false, allowUnknown: true },
    );
    expect(error).toBeUndefined();
  });
});
