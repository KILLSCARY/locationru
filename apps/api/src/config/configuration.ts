export interface ApplicationConfig {
  app: {
    environment: 'development' | 'production' | 'test';
    port: number;
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  auth: {
    accessTokenTtlSeconds: number;
    jwtSecret: string;
    otpHashSecret: string;
    otpMaxAttempts: number;
    otpRequestLimit: number;
    otpRequestWindowSeconds: number;
    otpTtlSeconds: number;
    refreshTokenTtlSeconds: number;
  };
  sms: {
    provider: 'development' | 'http';
    apiBaseUrl: string;
    apiKey: string;
    sender: string;
    requestTimeoutMs: number;
  };
  trips: {
    boardingCodeHashSecret: string;
    boardingCodeMaxAttempts: number;
    boardingCodeTtlSeconds: number;
    minPassengerPriceKopecks: number;
  };
  driverLocations: {
    batchMaxSize: number;
    futureToleranceSeconds: number;
    maxPlausibleSpeedMetersPerSecond: number;
    rateLimitPerMinute: number;
    staleAfterSeconds: number;
    latestPositionTtlSeconds: number;
  };
  dispatch: {
    averageSpeedMetersPerSecond: number;
    initialRadiusMeters: number;
    locationMaxAgeSeconds: number;
    maxCandidates: number;
    maxRadiusMeters: number;
    radiusMultiplier: number;
  };
  bids: {
    ttlSeconds: number;
  };
  finance: {
    globalCommissionBasisPoints: number;
    minimumCommissionKopecks: number;
  };
  payments: {
    provider: 'development' | 'http';
    apiBaseUrl: string;
    apiKey: string;
    webhookSecret: string;
    requestTimeoutMs: number;
  };
  realtime: {
    locationEventIntervalSeconds: number;
    outboxPollIntervalMs: number;
  };
}

export default (): ApplicationConfig => ({
  app: {
    environment: (process.env.NODE_ENV ??
      'development') as ApplicationConfig['app']['environment'],
    port: Number(process.env.API_PORT ?? 3000),
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? '',
  },
  auth: {
    accessTokenTtlSeconds: Number(
      process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS ?? 900,
    ),
    jwtSecret: process.env.AUTH_JWT_SECRET ?? '',
    otpHashSecret: process.env.AUTH_OTP_HASH_SECRET ?? '',
    otpMaxAttempts: Number(process.env.AUTH_OTP_MAX_ATTEMPTS ?? 5),
    otpRequestLimit: Number(process.env.AUTH_OTP_REQUEST_LIMIT ?? 3),
    otpRequestWindowSeconds: Number(
      process.env.AUTH_OTP_REQUEST_WINDOW_SECONDS ?? 60,
    ),
    otpTtlSeconds: Number(process.env.AUTH_OTP_TTL_SECONDS ?? 300),
    refreshTokenTtlSeconds: Number(
      process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS ?? 2_592_000,
    ),
  },
  sms: {
    provider: (process.env.SMS_PROVIDER ??
      'development') as ApplicationConfig['sms']['provider'],
    apiBaseUrl: process.env.SMS_API_BASE_URL ?? '',
    apiKey: process.env.SMS_API_KEY ?? '',
    sender: process.env.SMS_SENDER ?? '',
    requestTimeoutMs: Number(process.env.SMS_REQUEST_TIMEOUT_MS ?? 10_000),
  },
  trips: {
    boardingCodeHashSecret: process.env.TRIPS_BOARDING_CODE_HASH_SECRET ?? '',
    boardingCodeMaxAttempts: Number(
      process.env.TRIPS_BOARDING_CODE_MAX_ATTEMPTS ?? 5,
    ),
    boardingCodeTtlSeconds: Number(
      process.env.TRIPS_BOARDING_CODE_TTL_SECONDS ?? 300,
    ),
    minPassengerPriceKopecks: Number(
      process.env.TRIPS_MIN_PASSENGER_PRICE_KOPECKS ?? 10_000,
    ),
  },
  driverLocations: {
    batchMaxSize: Number(process.env.DRIVER_LOCATIONS_BATCH_MAX_SIZE ?? 100),
    futureToleranceSeconds: Number(
      process.env.DRIVER_LOCATIONS_FUTURE_TOLERANCE_SECONDS ?? 300,
    ),
    maxPlausibleSpeedMetersPerSecond: Number(
      process.env.DRIVER_LOCATIONS_MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND ?? 70,
    ),
    rateLimitPerMinute: Number(
      process.env.DRIVER_LOCATIONS_RATE_LIMIT_PER_MINUTE ?? 120,
    ),
    staleAfterSeconds: Number(
      process.env.DRIVER_LOCATIONS_STALE_AFTER_SECONDS ?? 120,
    ),
    latestPositionTtlSeconds: Number(
      process.env.DRIVER_LOCATIONS_LATEST_POSITION_TTL_SECONDS ?? 300,
    ),
  },
  dispatch: {
    averageSpeedMetersPerSecond: Number(
      process.env.DISPATCH_AVERAGE_SPEED_METERS_PER_SECOND ?? 8.33,
    ),
    initialRadiusMeters: Number(
      process.env.DISPATCH_INITIAL_RADIUS_METERS ?? 1_000,
    ),
    locationMaxAgeSeconds: Number(
      process.env.DISPATCH_LOCATION_MAX_AGE_SECONDS ?? 120,
    ),
    maxCandidates: Number(process.env.DISPATCH_MAX_CANDIDATES ?? 10),
    maxRadiusMeters: Number(process.env.DISPATCH_MAX_RADIUS_METERS ?? 5_000),
    radiusMultiplier: Number(process.env.DISPATCH_RADIUS_MULTIPLIER ?? 2),
  },
  bids: {
    ttlSeconds: Number(process.env.BIDS_TTL_SECONDS ?? 120),
  },
  finance: {
    globalCommissionBasisPoints: Number(
      process.env.FINANCE_GLOBAL_COMMISSION_BASIS_POINTS ?? 800,
    ),
    minimumCommissionKopecks: Number(
      process.env.FINANCE_MIN_COMMISSION_KOPECKS ?? 0,
    ),
  },
  payments: {
    provider: (process.env.PAYMENTS_PROVIDER ??
      'development') as ApplicationConfig['payments']['provider'],
    apiBaseUrl: process.env.PAYMENTS_API_BASE_URL ?? '',
    apiKey: process.env.PAYMENTS_API_KEY ?? '',
    webhookSecret: process.env.PAYMENTS_WEBHOOK_SECRET ?? '',
    requestTimeoutMs: Number(process.env.PAYMENTS_REQUEST_TIMEOUT_MS ?? 10_000),
  },
  realtime: {
    locationEventIntervalSeconds: Number(
      process.env.REALTIME_LOCATION_EVENT_INTERVAL_SECONDS ?? 2,
    ),
    outboxPollIntervalMs: Number(
      process.env.REALTIME_OUTBOX_POLL_INTERVAL_MS ?? 1_000,
    ),
  },
});
