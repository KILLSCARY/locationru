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
    developmentOtpCode: string | undefined;
    jwtSecret: string;
    otpHashSecret: string;
    otpMaxAttempts: number;
    otpRequestLimit: number;
    otpRequestWindowSeconds: number;
    otpTtlSeconds: number;
    refreshTokenTtlSeconds: number;
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
  realtime: {
    locationEventIntervalSeconds: number;
    outboxPollIntervalMs: number;
  };
  maps: {
    provider: 'development' | 'yandex';
    apiKey: string | undefined;
    apiUrl: string;
    routingApiUrl: string;
    timeoutMs: number;
    retryAttempts: number;
    circuitBreakerThreshold: number;
    circuitBreakerResetMs: number;
    rateLimitPerMinute: number;
    suggestionsTtlSeconds: number;
    geocodingTtlSeconds: number;
    reverseGeocodingTtlSeconds: number;
    routeTtlSeconds: number;
  };
  pricing: {
    baseFareKopecks: number;
    perKilometerKopecks: number;
    perMinuteKopecks: number;
    minimumFareKopecks: number;
    lowerMultiplierBasisPoints: number;
    upperMultiplierBasisPoints: number;
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
    developmentOtpCode: process.env.AUTH_DEVELOPMENT_OTP_CODE,
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
  realtime: {
    locationEventIntervalSeconds: Number(
      process.env.REALTIME_LOCATION_EVENT_INTERVAL_SECONDS ?? 2,
    ),
    outboxPollIntervalMs: Number(
      process.env.REALTIME_OUTBOX_POLL_INTERVAL_MS ?? 1_000,
    ),
  },
  maps: {
    provider: (process.env.MAPS_PROVIDER ?? 'development') as
      | 'development'
      | 'yandex',
    apiKey: process.env.MAPS_API_KEY || undefined,
    apiUrl: process.env.MAPS_API_URL ?? 'https://geocode-maps.yandex.ru/v1/',
    routingApiUrl:
      process.env.MAPS_ROUTING_API_URL ??
      'https://api.routing.yandex.net/v2/route',
    timeoutMs: Number(process.env.MAPS_TIMEOUT_MS ?? 5_000),
    retryAttempts: Number(process.env.MAPS_RETRY_ATTEMPTS ?? 2),
    circuitBreakerThreshold: Number(
      process.env.MAPS_CIRCUIT_BREAKER_THRESHOLD ?? 5,
    ),
    circuitBreakerResetMs: Number(
      process.env.MAPS_CIRCUIT_BREAKER_RESET_MS ?? 30_000,
    ),
    rateLimitPerMinute: Number(process.env.MAPS_RATE_LIMIT_PER_MINUTE ?? 60),
    suggestionsTtlSeconds: Number(
      process.env.MAPS_SUGGESTIONS_TTL_SECONDS ?? 300,
    ),
    geocodingTtlSeconds: Number(
      process.env.MAPS_GEOCODING_TTL_SECONDS ?? 86_400,
    ),
    reverseGeocodingTtlSeconds: Number(
      process.env.MAPS_REVERSE_GEOCODING_TTL_SECONDS ?? 3_600,
    ),
    routeTtlSeconds: Number(process.env.MAPS_ROUTE_TTL_SECONDS ?? 1_800),
  },
  pricing: {
    baseFareKopecks: Number(process.env.PRICING_BASE_FARE_KOPECKS ?? 15_000),
    perKilometerKopecks: Number(
      process.env.PRICING_PER_KILOMETER_KOPECKS ?? 3_000,
    ),
    perMinuteKopecks: Number(process.env.PRICING_PER_MINUTE_KOPECKS ?? 500),
    minimumFareKopecks: Number(
      process.env.PRICING_MINIMUM_FARE_KOPECKS ?? 20_000,
    ),
    lowerMultiplierBasisPoints: Number(
      process.env.PRICING_LOWER_MULTIPLIER_BASIS_POINTS ?? 9_000,
    ),
    upperMultiplierBasisPoints: Number(
      process.env.PRICING_UPPER_MULTIPLIER_BASIS_POINTS ?? 12_000,
    ),
  },
});
