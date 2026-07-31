import Joi from 'joi';

/**
 * Values known to appear only in committed example env files
 * (.env.example, .env.prod.example, .env.staging.example). A staging or
 * production boot must never proceed with one of these still in place —
 * that would mean nobody actually generated a real secret.
 */
const KNOWN_DEMO_SECRETS = [
  'change-me-access-token-secret-at-least-32-chars',
  'change-me-otp-hash-secret-at-least-32-chars',
  'change-me-boarding-code-secret-at-least-32-chars',
  'change-me-payment-webhook-secret',
];

/** Marks a field required in staging/production, optional (but still validated) elsewhere. */
function requiredWhenDeployed<T extends Joi.AnySchema>(schema: T): T {
  return schema.when('APP_ENV', {
    is: Joi.valid('staging', 'production'),
    then: schema.required(),
    otherwise: schema.optional(),
  }) as T;
}

/** Rejects a "*" entry anywhere in a comma-separated origin list. */
function rejectWildcardOriginList(value: string, helpers: Joi.CustomHelpers) {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.includes('*')) {
    return helpers.error('any.invalid');
  }
  return value;
}

export const environmentValidationSchema = Joi.object({
  // --- Node ecosystem vs. application deployment tier ---
  // NODE_ENV only governs npm/framework behavior (dependency pruning,
  // dev-mode warnings). APP_ENV is the single axis application code branches
  // on for security-relevant behavior — never `process.env.NODE_ENV !== 'production'`.
  // Defaulting APP_ENV to NODE_ENV keeps every environment that predates
  // APP_ENV working unchanged; staging is the one tier with no NODE_ENV
  // equivalent and must be set explicitly.
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  APP_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default(Joi.ref('NODE_ENV')),

  API_HOST: Joi.string().default('0.0.0.0'),
  API_PORT: Joi.number().port().default(3000),
  API_PUBLIC_URL: requiredWhenDeployed(
    Joi.string().uri({ scheme: ['http', 'https'] }),
  ),
  ADMIN_PUBLIC_URL: requiredWhenDeployed(
    Joi.string().uri({ scheme: ['http', 'https'] }),
  ),
  HTTP_BODY_LIMIT_BYTES: Joi.number().integer().min(1_024).default(262_144),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),

  // --- CORS / WebSocket origins ---
  // "*" is never accepted, in any environment — a wildcard origin plus
  // credentialed requests (cookies/auth headers) is the textbook CSRF setup.
  CORS_ALLOWED_ORIGINS: requiredWhenDeployed(
    Joi.string().custom(rejectWildcardOriginList),
  ).default(''),
  WEBSOCKET_ALLOWED_ORIGINS: Joi.string()
    .custom(rejectWildcardOriginList)
    .default(''),

  // --- Auth ---
  AUTH_JWT_SECRET: Joi.string()
    .min(32)
    .invalid(...KNOWN_DEMO_SECRETS)
    .required(),
  AUTH_OTP_HASH_SECRET: Joi.string()
    .min(32)
    .invalid(...KNOWN_DEMO_SECRETS)
    .required(),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).default(900),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: Joi.number()
    .integer()
    .min(300)
    .default(2_592_000),
  AUTH_MAX_ACTIVE_SESSIONS: Joi.number().integer().min(1).default(10),

  // --- OTP policy (owned by OtpService, independent of the SMS transport) ---
  OTP_SMS_CODE_LENGTH: Joi.number().integer().min(4).max(10).default(6),
  OTP_TTL_SECONDS: Joi.number().integer().min(30).default(300),
  OTP_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  OTP_RESEND_INITIAL_SECONDS: Joi.number().integer().min(10).default(60),
  OTP_MAX_SENDS_PER_PHONE_HOUR: Joi.number().integer().min(1).default(5),
  OTP_MAX_SENDS_PER_IP_HOUR: Joi.number().integer().min(1).default(20),
  OTP_BLOCK_SECONDS: Joi.number().integer().min(60).default(900),

  AUTH_RATE_LIMIT_REQUEST_CODE_PER_DEVICE_HOUR: Joi.number()
    .integer()
    .min(1)
    .default(10),
  AUTH_RATE_LIMIT_REQUEST_CODE_GLOBAL_PER_MINUTE: Joi.number()
    .integer()
    .min(1)
    .default(500),
  AUTH_RATE_LIMIT_VERIFY_CODE_PER_REQUEST_PER_MINUTE: Joi.number()
    .integer()
    .min(1)
    .default(10),

  // Reserved, hard-disabled outside development: no code path currently
  // grants either behavior, but a staging/production boot must never be
  // able to enable them even once such a path exists. See docs/staging/security.md.
  ENABLE_DEVELOPMENT_OTP: Joi.boolean()
    .default(false)
    .when('APP_ENV', {
      is: Joi.valid('staging', 'production'),
      then: Joi.valid(false),
    }),
  ENABLE_DEVELOPMENT_PAYMENTS: Joi.boolean()
    .default(false)
    .when('APP_ENV', {
      is: Joi.valid('staging', 'production'),
      then: Joi.valid(false),
    }),

  ENABLE_SWAGGER: Joi.boolean()
    .default(false)
    .when('APP_ENV', {
      is: Joi.valid('staging', 'production'),
      then: Joi.valid(false),
    }),

  // NOTE: the allowed-values list lives inside the when() branches, not in a
  // preceding .valid() call — Joi treats a base .valid() as an additional OR
  // alternative rather than a set the conditional narrows, so
  // `.valid(a,b,c).when(...)` would let all three through unconditionally.
  SMS_PROVIDER: Joi.string()
    .default('development')
    .when('APP_ENV', {
      is: 'production',
      then: Joi.valid('sms-ru'),
      otherwise: Joi.when('APP_ENV', {
        is: 'staging',
        then: Joi.valid('staging', 'sms-ru'),
        otherwise: Joi.valid('development', 'staging', 'sms-ru'),
      }),
    }),
  // Optional in every tier: SMS.RU accepts sends without a registered sender
  // ID (delivered from a shared shortcode instead of a named sender), so a
  // missing value must never block boot.
  SMS_SENDER_ID: Joi.string().allow('').default(''),
  SMS_RU_API_ID: Joi.string().min(1).when('SMS_PROVIDER', {
    is: 'sms-ru',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  SMS_RU_API_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('https://sms.ru'),
  SMS_RU_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(60_000)
    .default(10_000),
  SMS_RU_MAX_RETRIES: Joi.number().integer().min(0).max(5).default(2),
  SMS_RU_CIRCUIT_FAILURE_THRESHOLD: Joi.number().integer().min(1).default(5),
  SMS_RU_CIRCUIT_OPEN_MS: Joi.number().integer().min(1_000).default(30_000),
  // Primary webhook authenticity guard: a shared secret embedded in the
  // callback URL registered in the SMS.RU cabinet (?token=...), since SMS.RU
  // does not sign its status callbacks. See docs/auth/sms-ru-webhook.md.
  SMS_RU_WEBHOOK_SECRET: Joi.string()
    .min(16)
    .invalid(...KNOWN_DEMO_SECRETS)
    .when('SMS_PROVIDER', {
      is: 'sms-ru',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  // Secondary check only — never the sole authenticity guard on the webhook
  // (see handleStatusWebhook / docs/auth/sms-ru-webhook.md).
  SMS_RU_WEBHOOK_IP_ALLOWLIST: Joi.string().allow('').default(''),

  TRIPS_MIN_PASSENGER_PRICE_KOPECKS: Joi.number()
    .integer()
    .min(1)
    .default(10_000),
  TRIPS_BOARDING_CODE_HASH_SECRET: Joi.string()
    .min(32)
    .invalid(...KNOWN_DEMO_SECRETS)
    .required(),
  TRIPS_BOARDING_CODE_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  TRIPS_BOARDING_CODE_TTL_SECONDS: Joi.number().integer().min(30).default(300),

  DRIVER_LOCATIONS_BATCH_MAX_SIZE: Joi.number()
    .integer()
    .min(1)
    .max(500)
    .default(100),
  DRIVER_LOCATIONS_FUTURE_TOLERANCE_SECONDS: Joi.number()
    .integer()
    .min(0)
    .default(300),
  DRIVER_LOCATIONS_MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND: Joi.number()
    .positive()
    .default(70),
  DRIVER_LOCATIONS_RATE_LIMIT_PER_MINUTE: Joi.number()
    .integer()
    .min(1)
    .default(120),
  DRIVER_LOCATIONS_STALE_AFTER_SECONDS: Joi.number()
    .integer()
    .min(1)
    .default(120),
  DRIVER_LOCATIONS_LATEST_POSITION_TTL_SECONDS: Joi.number()
    .integer()
    .min(1)
    .default(300),

  DISPATCH_AVERAGE_SPEED_METERS_PER_SECOND: Joi.number()
    .positive()
    .default(8.33),
  DISPATCH_INITIAL_RADIUS_METERS: Joi.number()
    .integer()
    .min(100)
    .default(1_000),
  DISPATCH_LOCATION_MAX_AGE_SECONDS: Joi.number().integer().min(1).default(120),
  DISPATCH_MAX_CANDIDATES: Joi.number().integer().min(1).max(100).default(10),
  DISPATCH_MAX_RADIUS_METERS: Joi.number()
    .integer()
    .min(Joi.ref('DISPATCH_INITIAL_RADIUS_METERS'))
    .default(5_000),
  DISPATCH_RADIUS_MULTIPLIER: Joi.number().greater(1).default(2),
  // Straight-line ETA is a valid production model, so it is not forced to http.
  DISPATCH_ROUTING_PROVIDER: Joi.string()
    .valid('straight-line', 'http')
    .default('straight-line'),
  DISPATCH_ROUTING_API_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('DISPATCH_ROUTING_PROVIDER', {
      is: 'http',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  DISPATCH_ROUTING_API_KEY: Joi.string()
    .min(1)
    .when('DISPATCH_ROUTING_PROVIDER', {
      is: 'http',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  DISPATCH_ROUTING_REQUEST_TIMEOUT_MS: Joi.number()
    .integer()
    .min(500)
    .max(30_000)
    .default(3_000),

  BIDS_TTL_SECONDS: Joi.number().integer().min(15).default(120),

  FINANCE_GLOBAL_COMMISSION_BASIS_POINTS: Joi.number()
    .integer()
    .min(0)
    .max(10_000)
    .default(800),
  FINANCE_MIN_COMMISSION_KOPECKS: Joi.number().integer().min(0).default(0),

  PAYMENTS_PROVIDER: Joi.string()
    .default('development')
    .when('APP_ENV', {
      is: 'production',
      then: Joi.valid('http'),
      otherwise: Joi.when('APP_ENV', {
        is: 'staging',
        then: Joi.valid('staging', 'http'),
        otherwise: Joi.valid('development', 'staging', 'http'),
      }),
    }),
  PAYMENTS_API_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('PAYMENTS_PROVIDER', {
      is: 'http',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  PAYMENTS_API_KEY: Joi.string().min(1).when('PAYMENTS_PROVIDER', {
    is: 'http',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  PAYMENTS_WEBHOOK_SECRET: Joi.string()
    .min(16)
    .invalid(...KNOWN_DEMO_SECRETS)
    .when('PAYMENTS_PROVIDER', {
      is: Joi.valid('http', 'staging'),
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  PAYMENTS_REQUEST_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(60_000)
    .default(10_000),
  // Staging-only: the synthetic outcome StagingPaymentProvider produces when
  // no per-trip override was set through the admin tool. A client can never
  // set this — see docs/staging/security.md.
  STAGING_PAYMENT_DEFAULT_SCENARIO: Joi.string()
    .valid(
      'SUCCESS',
      'DECLINED',
      'TIMEOUT',
      'DUPLICATE_WEBHOOK',
      'REFUND',
      'PAYOUT_FAILED',
    )
    .default('SUCCESS'),

  REALTIME_LOCATION_EVENT_INTERVAL_SECONDS: Joi.number()
    .integer()
    .min(1)
    .default(2),
  REALTIME_OUTBOX_POLL_INTERVAL_MS: Joi.number()
    .integer()
    .min(100)
    .default(1_000),

  WEBSOCKET_MAX_CONNECTIONS_PER_USER: Joi.number().integer().min(1).default(10),
  WEBSOCKET_HEARTBEAT_INTERVAL_MS: Joi.number()
    .integer()
    .min(1_000)
    .default(25_000),
  WEBSOCKET_HEARTBEAT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .default(20_000),
  WEBSOCKET_EVENT_RATE_LIMIT_PER_MINUTE: Joi.number()
    .integer()
    .min(1)
    .default(300),

  MAPS_PROVIDER: Joi.string()
    .default('development')
    .when('APP_ENV', {
      is: 'production',
      then: Joi.valid('yandex'),
      otherwise: Joi.when('APP_ENV', {
        is: 'staging',
        then: Joi.when('MAPS_ALLOW_DEVELOPMENT_IN_STAGING', {
          is: true,
          then: Joi.valid('development', 'yandex'),
          otherwise: Joi.valid('yandex'),
        }),
        otherwise: Joi.valid('development', 'yandex'),
      }),
    }),
  MAPS_ALLOW_DEVELOPMENT_IN_STAGING: Joi.boolean().default(false),
  MAPS_API_KEY: Joi.string()
    .allow('')
    .when('MAPS_PROVIDER', {
      is: 'yandex',
      // Outside production a missing key falls back to the development provider,
      // so it is only strictly required in production.
      then: Joi.when('APP_ENV', {
        is: 'production',
        then: Joi.string().min(1).required(),
      }),
    }),
  MAPS_API_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('https://geocode-maps.yandex.ru'),
  MAPS_TIMEOUT_MS: Joi.number().integer().min(500).max(30_000).default(5_000),
  MAPS_MAX_RETRIES: Joi.number().integer().min(0).max(5).default(2),
  MAPS_USER_AGENT: Joi.string().min(1).default('ResilientTaxi/1.0'),
  MAPS_SUGGESTIONS_TTL_SECONDS: Joi.number().integer().min(1).default(300),
  MAPS_GEOCODING_TTL_SECONDS: Joi.number().integer().min(1).default(86_400),
  MAPS_ROUTE_TTL_SECONDS: Joi.number().integer().min(1).default(1_800),
  MAPS_SUGGESTIONS_RATE_LIMIT_PER_MINUTE: Joi.number()
    .integer()
    .min(1)
    .default(60),
  MAPS_ROUTES_RATE_LIMIT_PER_MINUTE: Joi.number().integer().min(1).default(30),

  PRICING_BASE_FARE_KOPECKS: Joi.number().integer().min(0).default(15_000),
  PRICING_PER_KILOMETER_KOPECKS: Joi.number().integer().min(0).default(3_000),
  PRICING_PER_MINUTE_KOPECKS: Joi.number().integer().min(0).default(800),
  PRICING_MINIMUM_FARE_KOPECKS: Joi.number().integer().min(0).default(15_000),
  PRICING_LOWER_MULTIPLIER_BASIS_POINTS: Joi.number()
    .integer()
    .min(0)
    .max(10_000)
    .default(9_000),
  PRICING_UPPER_MULTIPLIER_BASIS_POINTS: Joi.number()
    .integer()
    .min(10_000)
    .max(50_000)
    .default(13_000),

  // --- Object storage (documents: driver/vehicle photos, etc.) ---
  OBJECT_STORAGE_ENDPOINT: requiredWhenDeployed(
    Joi.string().uri({ scheme: ['http', 'https'] }),
  ),
  OBJECT_STORAGE_REGION: Joi.string().min(1).default('us-east-1'),
  OBJECT_STORAGE_BUCKET: requiredWhenDeployed(Joi.string().min(1)),
  OBJECT_STORAGE_ACCESS_KEY: requiredWhenDeployed(Joi.string().min(1)),
  OBJECT_STORAGE_SECRET_KEY: requiredWhenDeployed(
    Joi.string()
      .min(1)
      .invalid(...KNOWN_DEMO_SECRETS),
  ),
  OBJECT_STORAGE_FORCE_PATH_STYLE: Joi.boolean().default(true),
  OBJECT_STORAGE_MAX_UPLOAD_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(10 * 1024 * 1024),
  OBJECT_STORAGE_ALLOWED_MIME_TYPES: Joi.string().default(
    'image/jpeg,image/png,application/pdf',
  ),
  OBJECT_STORAGE_UPLOAD_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(30)
    .default(300),
  OBJECT_STORAGE_DOWNLOAD_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(30)
    .default(300),

  // --- Observability ---
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('info'),
  ERROR_REPORTER: Joi.string().valid('noop', 'staging').default('noop'),
  ERROR_REPORTER_DSN: Joi.string().allow('').default(''),

  SEED_ADMIN_PHONE: Joi.string().allow('').default(''),
});
