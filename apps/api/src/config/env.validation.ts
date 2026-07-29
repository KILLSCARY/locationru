import Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  API_PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  AUTH_JWT_SECRET: Joi.string().min(32).required(),
  AUTH_OTP_HASH_SECRET: Joi.string().min(32).required(),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).default(900),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: Joi.number()
    .integer()
    .min(300)
    .default(2_592_000),
  AUTH_OTP_TTL_SECONDS: Joi.number().integer().min(30).default(300),
  AUTH_OTP_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  AUTH_OTP_REQUEST_LIMIT: Joi.number().integer().min(1).default(3),
  AUTH_OTP_REQUEST_WINDOW_SECONDS: Joi.number().integer().min(1).default(60),
  SMS_PROVIDER: Joi.string()
    .valid('development', 'http')
    .default('development')
    // The development provider only logs OTP codes; production needs a gateway.
    .when('NODE_ENV', { is: 'production', then: Joi.valid('http') }),
  SMS_API_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('SMS_PROVIDER', {
      is: 'http',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  SMS_API_KEY: Joi.string().min(1).when('SMS_PROVIDER', {
    is: 'http',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  SMS_SENDER: Joi.string().allow('').default(''),
  SMS_REQUEST_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(60_000)
    .default(10_000),
  TRIPS_MIN_PASSENGER_PRICE_KOPECKS: Joi.number()
    .integer()
    .min(1)
    .default(10_000),
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
    .valid('development', 'http')
    .default('development')
    // The development simulator must never move money in production.
    .when('NODE_ENV', { is: 'production', then: Joi.valid('http') }),
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
  PAYMENTS_WEBHOOK_SECRET: Joi.string().min(16).when('PAYMENTS_PROVIDER', {
    is: 'http',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  PAYMENTS_REQUEST_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(60_000)
    .default(10_000),
  REALTIME_LOCATION_EVENT_INTERVAL_SECONDS: Joi.number()
    .integer()
    .min(1)
    .default(2),
  REALTIME_OUTBOX_POLL_INTERVAL_MS: Joi.number()
    .integer()
    .min(100)
    .default(1_000),
  MAPS_PROVIDER: Joi.string()
    .valid('development', 'yandex')
    .default('development')
    // The offline development provider must never run in production.
    .when('NODE_ENV', { is: 'production', then: Joi.valid('yandex') }),
  MAPS_API_KEY: Joi.string()
    .allow('')
    .when('MAPS_PROVIDER', {
      is: 'yandex',
      // Outside production a missing key falls back to the development provider,
      // so it is only strictly required in production.
      then: Joi.when('NODE_ENV', {
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
});
