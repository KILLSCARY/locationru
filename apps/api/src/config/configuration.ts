import {
  parseAppEnvironment,
  type AppEnvironment,
} from '@resilient-taxi/config';

function parseOriginList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseIntList(value: string | undefined): number[] {
  return parseOriginList(value).map((entry) => Number(entry));
}

/** PUSH_PROVIDER is lowercase in the env (matching SMS_PROVIDER's style); the value this returns matches the Prisma PushProviderType enum casing, since (unlike SMS) it is persisted on DevicePushToken.provider. */
function parsePushProviderEnv(
  value: string | undefined,
): 'DEVELOPMENT' | 'STAGING' | 'FCM' | 'APNS' {
  switch (value) {
    case 'staging':
      return 'STAGING';
    case 'fcm':
      return 'FCM';
    case 'apns':
      return 'APNS';
    default:
      return 'DEVELOPMENT';
  }
}

export interface ApplicationConfig {
  app: {
    /** Node/npm ecosystem concern only (dependency pruning, framework dev warnings). */
    environment: 'development' | 'production' | 'test';
    /** The single axis application code branches on for security-relevant behavior. */
    appEnvironment: AppEnvironment;
    host: string;
    port: number;
    publicUrl: string;
    adminPublicUrl: string;
    bodyLimitBytes: number;
    enableSwagger: boolean;
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  cors: {
    allowedOrigins: string[];
  };
  auth: {
    accessTokenTtlSeconds: number;
    jwtSecret: string;
    otpHashSecret: string;
    refreshTokenTtlSeconds: number;
    enableDevelopmentOtp: boolean;
    maxActiveSessions: number;
  };
  otp: {
    smsCodeLength: number;
    ttlSeconds: number;
    maxAttempts: number;
    resendInitialSeconds: number;
    maxSendsPerPhoneHour: number;
    maxSendsPerIpHour: number;
    blockSeconds: number;
  };
  sms: {
    provider: 'development' | 'staging' | 'sms-ru';
    senderId: string;
    smsRu: {
      apiId: string;
      apiBaseUrl: string;
      timeoutMs: number;
      maxRetries: number;
      circuitFailureThreshold: number;
      circuitOpenMs: number;
      webhookSecret: string;
      webhookIpAllowlist: string[];
    };
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
    routingProvider: 'straight-line' | 'http';
    routingApiBaseUrl: string;
    routingApiKey: string;
    routingRequestTimeoutMs: number;
  };
  bids: {
    ttlSeconds: number;
  };
  finance: {
    globalCommissionBasisPoints: number;
    minimumCommissionKopecks: number;
  };
  payments: {
    provider: 'development' | 'staging' | 'http';
    apiBaseUrl: string;
    apiKey: string;
    webhookSecret: string;
    requestTimeoutMs: number;
    enableDevelopmentPayments: boolean;
    stagingDefaultScenario:
      | 'SUCCESS'
      | 'DECLINED'
      | 'TIMEOUT'
      | 'DUPLICATE_WEBHOOK'
      | 'REFUND'
      | 'PAYOUT_FAILED';
  };
  realtime: {
    locationEventIntervalSeconds: number;
    outboxPollIntervalMs: number;
  };
  websocket: {
    allowedOrigins: string[];
    maxConnectionsPerUser: number;
    heartbeatIntervalMs: number;
    heartbeatTimeoutMs: number;
    eventRateLimitPerMinute: number;
  };
  maps: {
    provider: 'development' | 'yandex';
    allowDevelopmentInStaging: boolean;
    apiKey: string;
    apiBaseUrl: string;
    timeoutMs: number;
    maxRetries: number;
    userAgent: string;
    suggestionsTtlSeconds: number;
    geocodingTtlSeconds: number;
    routeTtlSeconds: number;
    suggestionsRateLimitPerMinute: number;
    routesRateLimitPerMinute: number;
  };
  pricing: {
    baseFareKopecks: number;
    perKilometerKopecks: number;
    perMinuteKopecks: number;
    minimumFareKopecks: number;
    lowerMultiplierBasisPoints: number;
    upperMultiplierBasisPoints: number;
  };
  objectStorage: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    forcePathStyle: boolean;
    maxUploadBytes: number;
    allowedMimeTypes: string[];
    uploadUrlTtlSeconds: number;
    downloadUrlTtlSeconds: number;
  };
  observability: {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    errorReporter: 'noop' | 'staging';
    errorReporterDsn: string;
  };
  seed: {
    adminPhone: string;
  };
  authRateLimit: {
    requestCodeMaxPerDevicePerHour: number;
    requestCodeGlobalMaxPerMinute: number;
    verifyCodeMaxPerMinute: number;
  };
  push: {
    provider: 'DEVELOPMENT' | 'STAGING' | 'FCM' | 'APNS';
    tokenEncryptionKey: string;
    tokenHashSecret: string;
    maxBatchSize: number;
    maxAttempts: number;
    initialRetryDelaySeconds: number;
    maxRetryDelaySeconds: number;
    workerConcurrency: number;
    outboxPollIntervalMs: number;
    ttl: {
      newOrderSeconds: number;
      activeTripSeconds: number;
      paymentSeconds: number;
    };
    fcm: {
      projectId: string;
      clientEmail: string;
      privateKey: string;
    };
    apns: {
      teamId: string;
      keyId: string;
      privateKey: string;
      bundleId: string;
      useSandbox: boolean;
    };
    rateLimit: {
      registerMaxPerUserPerHour: number;
    };
  };
  notification: {
    defaultLocale: string;
    inboxRetentionDays: number;
  };
  driverVerification: {
    dataEncryptionKey: string;
    dataHashSecret: string;
    minimumAge: number;
    enabled: boolean;
    reapplyCooldownSeconds: number;
    maxActiveVehicles: number;
    requiredDriverDocumentTypes: string[];
    requiredVehicleDocumentTypes: string[];
    /** Empty means every city is considered active. */
    activeCityIds: string[];
  };
  documents: {
    imageMaxBytes: number;
    pdfMaxBytes: number;
    pdfMaxPages: number;
    imageMinWidthPx: number;
    imageMinHeightPx: number;
    uploadUrlTtlSeconds: number;
    downloadUrlTtlSeconds: number;
    pendingRetentionHours: number;
    malwareScanner: 'development' | 'clamav' | 'external';
    fileTypeDetector: 'development' | 'magic-bytes';
    previewProvider: 'development' | 'sharp-pdf';
    expirationWarningDays: number[];
    expirationCheckIntervalMs: number;
  };
}

export default (): ApplicationConfig => ({
  app: {
    environment: (process.env.NODE_ENV ??
      'development') as ApplicationConfig['app']['environment'],
    appEnvironment: parseAppEnvironment(
      process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
    ),
    host: process.env.API_HOST ?? '0.0.0.0',
    port: Number(process.env.API_PORT ?? 3000),
    publicUrl: process.env.API_PUBLIC_URL ?? '',
    adminPublicUrl: process.env.ADMIN_PUBLIC_URL ?? '',
    bodyLimitBytes: Number(process.env.HTTP_BODY_LIMIT_BYTES ?? 262_144),
    enableSwagger: process.env.ENABLE_SWAGGER === 'true',
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? '',
  },
  cors: {
    allowedOrigins: parseOriginList(process.env.CORS_ALLOWED_ORIGINS),
  },
  auth: {
    accessTokenTtlSeconds: Number(
      process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS ?? 900,
    ),
    jwtSecret: process.env.AUTH_JWT_SECRET ?? '',
    otpHashSecret: process.env.AUTH_OTP_HASH_SECRET ?? '',
    refreshTokenTtlSeconds: Number(
      process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS ?? 2_592_000,
    ),
    enableDevelopmentOtp: process.env.ENABLE_DEVELOPMENT_OTP === 'true',
    maxActiveSessions: Number(process.env.AUTH_MAX_ACTIVE_SESSIONS ?? 10),
  },
  otp: {
    smsCodeLength: Number(process.env.OTP_SMS_CODE_LENGTH ?? 6),
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 300),
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
    resendInitialSeconds: Number(process.env.OTP_RESEND_INITIAL_SECONDS ?? 60),
    maxSendsPerPhoneHour: Number(process.env.OTP_MAX_SENDS_PER_PHONE_HOUR ?? 5),
    maxSendsPerIpHour: Number(process.env.OTP_MAX_SENDS_PER_IP_HOUR ?? 20),
    blockSeconds: Number(process.env.OTP_BLOCK_SECONDS ?? 900),
  },
  sms: {
    provider: (process.env.SMS_PROVIDER ??
      'development') as ApplicationConfig['sms']['provider'],
    senderId: process.env.SMS_SENDER_ID ?? '',
    smsRu: {
      apiId: process.env.SMS_RU_API_ID ?? '',
      apiBaseUrl: process.env.SMS_RU_API_BASE_URL ?? 'https://sms.ru',
      timeoutMs: Number(process.env.SMS_RU_TIMEOUT_MS ?? 10_000),
      maxRetries: Number(process.env.SMS_RU_MAX_RETRIES ?? 2),
      circuitFailureThreshold: Number(
        process.env.SMS_RU_CIRCUIT_FAILURE_THRESHOLD ?? 5,
      ),
      circuitOpenMs: Number(process.env.SMS_RU_CIRCUIT_OPEN_MS ?? 30_000),
      webhookSecret: process.env.SMS_RU_WEBHOOK_SECRET ?? '',
      webhookIpAllowlist: parseOriginList(
        process.env.SMS_RU_WEBHOOK_IP_ALLOWLIST,
      ),
    },
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
    routingProvider: (process.env.DISPATCH_ROUTING_PROVIDER ??
      'straight-line') as ApplicationConfig['dispatch']['routingProvider'],
    routingApiBaseUrl: process.env.DISPATCH_ROUTING_API_BASE_URL ?? '',
    routingApiKey: process.env.DISPATCH_ROUTING_API_KEY ?? '',
    routingRequestTimeoutMs: Number(
      process.env.DISPATCH_ROUTING_REQUEST_TIMEOUT_MS ?? 3_000,
    ),
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
    enableDevelopmentPayments:
      process.env.ENABLE_DEVELOPMENT_PAYMENTS === 'true',
    stagingDefaultScenario: (process.env.STAGING_PAYMENT_DEFAULT_SCENARIO ??
      'SUCCESS') as ApplicationConfig['payments']['stagingDefaultScenario'],
  },
  realtime: {
    locationEventIntervalSeconds: Number(
      process.env.REALTIME_LOCATION_EVENT_INTERVAL_SECONDS ?? 2,
    ),
    outboxPollIntervalMs: Number(
      process.env.REALTIME_OUTBOX_POLL_INTERVAL_MS ?? 1_000,
    ),
  },
  websocket: {
    allowedOrigins: parseOriginList(
      process.env.WEBSOCKET_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS,
    ),
    maxConnectionsPerUser: Number(
      process.env.WEBSOCKET_MAX_CONNECTIONS_PER_USER ?? 10,
    ),
    heartbeatIntervalMs: Number(
      process.env.WEBSOCKET_HEARTBEAT_INTERVAL_MS ?? 25_000,
    ),
    heartbeatTimeoutMs: Number(
      process.env.WEBSOCKET_HEARTBEAT_TIMEOUT_MS ?? 20_000,
    ),
    eventRateLimitPerMinute: Number(
      process.env.WEBSOCKET_EVENT_RATE_LIMIT_PER_MINUTE ?? 300,
    ),
  },
  maps: {
    provider: (process.env.MAPS_PROVIDER ??
      'development') as ApplicationConfig['maps']['provider'],
    allowDevelopmentInStaging:
      process.env.MAPS_ALLOW_DEVELOPMENT_IN_STAGING === 'true',
    apiKey: process.env.MAPS_API_KEY ?? '',
    apiBaseUrl: process.env.MAPS_API_URL ?? 'https://geocode-maps.yandex.ru',
    timeoutMs: Number(process.env.MAPS_TIMEOUT_MS ?? 5_000),
    maxRetries: Number(process.env.MAPS_MAX_RETRIES ?? 2),
    userAgent: process.env.MAPS_USER_AGENT ?? 'ResilientTaxi/1.0',
    suggestionsTtlSeconds: Number(
      process.env.MAPS_SUGGESTIONS_TTL_SECONDS ?? 300,
    ),
    geocodingTtlSeconds: Number(
      process.env.MAPS_GEOCODING_TTL_SECONDS ?? 86_400,
    ),
    routeTtlSeconds: Number(process.env.MAPS_ROUTE_TTL_SECONDS ?? 1_800),
    suggestionsRateLimitPerMinute: Number(
      process.env.MAPS_SUGGESTIONS_RATE_LIMIT_PER_MINUTE ?? 60,
    ),
    routesRateLimitPerMinute: Number(
      process.env.MAPS_ROUTES_RATE_LIMIT_PER_MINUTE ?? 30,
    ),
  },
  pricing: {
    baseFareKopecks: Number(process.env.PRICING_BASE_FARE_KOPECKS ?? 15_000),
    perKilometerKopecks: Number(
      process.env.PRICING_PER_KILOMETER_KOPECKS ?? 3_000,
    ),
    perMinuteKopecks: Number(process.env.PRICING_PER_MINUTE_KOPECKS ?? 800),
    minimumFareKopecks: Number(
      process.env.PRICING_MINIMUM_FARE_KOPECKS ?? 15_000,
    ),
    lowerMultiplierBasisPoints: Number(
      process.env.PRICING_LOWER_MULTIPLIER_BASIS_POINTS ?? 9_000,
    ),
    upperMultiplierBasisPoints: Number(
      process.env.PRICING_UPPER_MULTIPLIER_BASIS_POINTS ?? 13_000,
    ),
  },
  objectStorage: {
    endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? '',
    region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
    bucket: process.env.OBJECT_STORAGE_BUCKET ?? '',
    accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? '',
    secretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? '',
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== 'false',
    maxUploadBytes: Number(
      process.env.OBJECT_STORAGE_MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024,
    ),
    allowedMimeTypes: (
      process.env.OBJECT_STORAGE_ALLOWED_MIME_TYPES ??
      'image/jpeg,image/png,application/pdf'
    )
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    uploadUrlTtlSeconds: Number(
      process.env.OBJECT_STORAGE_UPLOAD_URL_TTL_SECONDS ?? 300,
    ),
    downloadUrlTtlSeconds: Number(
      process.env.OBJECT_STORAGE_DOWNLOAD_URL_TTL_SECONDS ?? 300,
    ),
  },
  observability: {
    logLevel: (process.env.LOG_LEVEL ??
      'info') as ApplicationConfig['observability']['logLevel'],
    errorReporter: (process.env.ERROR_REPORTER ??
      'noop') as ApplicationConfig['observability']['errorReporter'],
    errorReporterDsn: process.env.ERROR_REPORTER_DSN ?? '',
  },
  seed: {
    adminPhone: process.env.SEED_ADMIN_PHONE ?? '',
  },
  authRateLimit: {
    requestCodeMaxPerDevicePerHour: Number(
      process.env.AUTH_RATE_LIMIT_REQUEST_CODE_PER_DEVICE_HOUR ?? 10,
    ),
    requestCodeGlobalMaxPerMinute: Number(
      process.env.AUTH_RATE_LIMIT_REQUEST_CODE_GLOBAL_PER_MINUTE ?? 500,
    ),
    verifyCodeMaxPerMinute: Number(
      process.env.AUTH_RATE_LIMIT_VERIFY_CODE_PER_REQUEST_PER_MINUTE ?? 10,
    ),
  },
  push: {
    provider: parsePushProviderEnv(process.env.PUSH_PROVIDER),
    tokenEncryptionKey: process.env.PUSH_TOKEN_ENCRYPTION_KEY ?? '',
    tokenHashSecret: process.env.PUSH_TOKEN_HASH_SECRET ?? '',
    maxBatchSize: Number(process.env.PUSH_MAX_BATCH_SIZE ?? 500),
    maxAttempts: Number(process.env.PUSH_MAX_ATTEMPTS ?? 5),
    initialRetryDelaySeconds: Number(
      process.env.PUSH_INITIAL_RETRY_DELAY_SECONDS ?? 5,
    ),
    maxRetryDelaySeconds: Number(
      process.env.PUSH_MAX_RETRY_DELAY_SECONDS ?? 900,
    ),
    workerConcurrency: Number(process.env.PUSH_WORKER_CONCURRENCY ?? 10),
    outboxPollIntervalMs: Number(
      process.env.PUSH_OUTBOX_POLL_INTERVAL_MS ?? 1_000,
    ),
    ttl: {
      newOrderSeconds: Number(process.env.PUSH_NEW_ORDER_TTL_SECONDS ?? 30),
      activeTripSeconds: Number(
        process.env.PUSH_ACTIVE_TRIP_TTL_SECONDS ?? 300,
      ),
      paymentSeconds: Number(process.env.PUSH_PAYMENT_TTL_SECONDS ?? 86_400),
    },
    fcm: {
      projectId: process.env.FIREBASE_PROJECT_ID ?? '',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
      privateKey: process.env.FIREBASE_PRIVATE_KEY ?? '',
    },
    apns: {
      teamId: process.env.APNS_TEAM_ID ?? '',
      keyId: process.env.APNS_KEY_ID ?? '',
      privateKey: process.env.APNS_PRIVATE_KEY ?? '',
      bundleId: process.env.APNS_BUNDLE_ID ?? '',
      useSandbox: process.env.APNS_USE_SANDBOX !== 'false',
    },
    rateLimit: {
      registerMaxPerUserPerHour: Number(
        process.env.PUSH_RATE_LIMIT_REGISTER_MAX_PER_USER_HOUR ?? 20,
      ),
    },
  },
  notification: {
    defaultLocale: process.env.NOTIFICATION_DEFAULT_LOCALE ?? 'ru',
    inboxRetentionDays: Number(
      process.env.NOTIFICATION_INBOX_RETENTION_DAYS ?? 90,
    ),
  },
  driverVerification: {
    dataEncryptionKey: process.env.DRIVER_DATA_ENCRYPTION_KEY ?? '',
    dataHashSecret: process.env.DRIVER_DATA_HASH_SECRET ?? '',
    minimumAge: Number(process.env.DRIVER_MINIMUM_AGE ?? 18),
    enabled: process.env.DRIVER_VERIFICATION_ENABLED !== 'false',
    reapplyCooldownSeconds: Number(
      process.env.DRIVER_REAPPLY_COOLDOWN_SECONDS ?? 86_400,
    ),
    maxActiveVehicles: Number(process.env.DRIVER_MAX_ACTIVE_VEHICLES ?? 3),
    requiredDriverDocumentTypes: parseOriginList(
      process.env.DRIVER_REQUIRED_DOCUMENT_TYPES ??
        'PASSPORT_MAIN_PAGE,DRIVER_LICENSE_FRONT,DRIVER_LICENSE_BACK,PROFILE_PHOTO,SELFIE_WITH_DOCUMENT',
    ),
    requiredVehicleDocumentTypes: parseOriginList(
      process.env.VEHICLE_REQUIRED_DOCUMENT_TYPES ??
        'VEHICLE_REGISTRATION_FRONT,INSURANCE_POLICY,VEHICLE_PHOTO_FRONT,VEHICLE_PHOTO_BACK',
    ),
    activeCityIds: parseOriginList(process.env.DRIVER_ACTIVE_CITY_IDS),
  },
  documents: {
    imageMaxBytes: Number(
      process.env.DOCUMENT_IMAGE_MAX_BYTES ?? 10 * 1024 * 1024,
    ),
    pdfMaxBytes: Number(process.env.DOCUMENT_PDF_MAX_BYTES ?? 15 * 1024 * 1024),
    pdfMaxPages: Number(process.env.DOCUMENT_PDF_MAX_PAGES ?? 10),
    imageMinWidthPx: Number(process.env.DOCUMENT_IMAGE_MIN_WIDTH_PX ?? 600),
    imageMinHeightPx: Number(process.env.DOCUMENT_IMAGE_MIN_HEIGHT_PX ?? 600),
    uploadUrlTtlSeconds: Number(
      process.env.DOCUMENT_UPLOAD_URL_TTL_SECONDS ?? 900,
    ),
    downloadUrlTtlSeconds: Number(
      process.env.DOCUMENT_DOWNLOAD_URL_TTL_SECONDS ?? 300,
    ),
    pendingRetentionHours: Number(
      process.env.DOCUMENT_PENDING_RETENTION_HOURS ?? 24,
    ),
    malwareScanner: (process.env.DOCUMENT_MALWARE_SCANNER ??
      'development') as ApplicationConfig['documents']['malwareScanner'],
    fileTypeDetector: (process.env.DOCUMENT_FILE_TYPE_DETECTOR ??
      'development') as ApplicationConfig['documents']['fileTypeDetector'],
    previewProvider: (process.env.DOCUMENT_PREVIEW_PROVIDER ??
      'development') as ApplicationConfig['documents']['previewProvider'],
    expirationWarningDays: parseIntList(
      process.env.DOCUMENT_EXPIRATION_WARNING_DAYS ?? '30,14,7,1',
    ),
    expirationCheckIntervalMs: Number(
      process.env.DOCUMENT_EXPIRATION_CHECK_INTERVAL_MS ?? 3_600_000,
    ),
  },
});
