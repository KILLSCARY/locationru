process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.DATABASE_URL ??=
  'postgresql://resilient_taxi:change-me@localhost:5432/resilient_taxi';
process.env.REDIS_URL ??= 'redis://:change-me@localhost:6379';
process.env.AUTH_JWT_SECRET ??=
  'test-access-token-secret-that-is-at-least-32-characters';
process.env.AUTH_OTP_HASH_SECRET ??=
  'test-otp-hash-secret-that-is-at-least-32-characters';
