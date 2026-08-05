import { z } from 'zod';

/**
 * Wire-contract version. Additive changes stay within v1; breaking changes
 * are published under a new major package version and a new contract version.
 */
export const CONTRACT_VERSION = 'v1' as const;
export const CONTRACT_PACKAGE_VERSION = '1.0.0' as const;

export const UserRoleSchema = z.enum(['PASSENGER', 'DRIVER', 'ADMIN']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserStatusSchema = z.enum(['ACTIVE', 'BLOCKED', 'PENDING']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const DriverStatusSchema = z.enum([
  'OFFLINE',
  'ONLINE',
  'BUSY',
  'SUSPENDED',
]);
export type DriverStatus = z.infer<typeof DriverStatusSchema>;

export const DriverVerificationStatusSchema = z.enum([
  'NOT_SUBMITTED',
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export type DriverVerificationStatus = z.infer<
  typeof DriverVerificationStatusSchema
>;

export const VehicleStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'BLOCKED',
]);
export type VehicleStatus = z.infer<typeof VehicleStatusSchema>;

export const TripStatusSchema = z.enum([
  'DRAFT',
  'SEARCHING',
  'OFFERS_RECEIVED',
  'DRIVER_SELECTED',
  'PAYMENT_PENDING',
  'PAYMENT_RESERVED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'SETTLED',
  'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_SYSTEM',
  'PAYMENT_FAILED',
  'DISPUTED',
  'REFUNDED',
]);
export type TripStatus = z.infer<typeof TripStatusSchema>;

export const DriverBidStatusSchema = z.enum([
  'ACTIVE',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'WITHDRAWN',
]);
export type DriverBidStatus = z.infer<typeof DriverBidStatusSchema>;

export const KopecksSchema = z.number().int().nonnegative().brand<'Kopecks'>();
export type Kopecks = z.infer<typeof KopecksSchema>;

export const BasisPointsSchema = z.number().int().min(0).max(10_000);
export type BasisPoints = z.infer<typeof BasisPointsSchema>;

export const CoordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
export type Coordinate = z.infer<typeof CoordinateSchema>;

export const DriverBidSchema = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  driverId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  offeredPriceKopecks: KopecksSchema,
  estimatedPickupSeconds: z.number().int().nonnegative(),
  distanceToPickupMeters: z.number().int().nonnegative(),
  status: DriverBidStatusSchema,
  expiresAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  version: z.number().int().nonnegative(),
});
export type DriverBid = z.infer<typeof DriverBidSchema>;

export const TripSummarySchema = z.object({
  id: z.string().uuid(),
  passengerId: z.string().uuid(),
  selectedDriverId: z.string().uuid().nullable(),
  selectedVehicleId: z.string().uuid().nullable(),
  status: TripStatusSchema,
  passengerPriceKopecks: KopecksSchema,
  finalPriceKopecks: KopecksSchema.nullable(),
  commissionBasisPoints: BasisPointsSchema.nullable(),
  commissionKopecks: KopecksSchema.nullable(),
  driverPayoutKopecks: KopecksSchema.nullable(),
  pickup: CoordinateSchema,
  destination: CoordinateSchema,
  pickupAddress: z.string().min(1).max(512),
  destinationAddress: z.string().min(1).max(512),
  estimatedDistanceMeters: z.number().int().nonnegative(),
  estimatedDurationSeconds: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  version: z.number().int().nonnegative(),
});
export type TripSummary = z.infer<typeof TripSummarySchema>;

export const DriverLocationConfidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type DriverLocationConfidence = z.infer<
  typeof DriverLocationConfidenceSchema
>;

export const DriverLocationUpdateSchema = CoordinateSchema.extend({
  recordedAt: z.string().datetime({ offset: true }),
  accuracyMeters: z.number().finite().min(0).max(100_000),
  speedMetersPerSecond: z.number().finite().min(0).max(200).nullable(),
  bearingDegrees: z.number().finite().min(0).max(359.999_999).nullable(),
  altitudeMeters: z.number().finite().min(-15_000).max(100_000).nullable(),
  provider: z.string().min(1).max(64),
  confidence: DriverLocationConfidenceSchema,
  suspectedSpoofing: z.boolean(),
  satellitesVisible: z.number().int().min(0).max(1_000).nullable(),
  cellCount: z.number().int().min(0).max(1_000).nullable(),
});
export type DriverLocationUpdate = z.infer<typeof DriverLocationUpdateSchema>;

export const AuthDevicePlatformSchema = z.enum(['IOS', 'ANDROID', 'WEB']);
export type AuthDevicePlatform = z.infer<typeof AuthDevicePlatformSchema>;

const PhoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
const AccessTokenSchema = z.string().min(1);

export const RequestCodeRequestSchema = z.object({ phone: PhoneSchema });
export type RequestCodeRequest = z.infer<typeof RequestCodeRequestSchema>;
export const RequestCodeResponseSchema = z.object({
  expiresInSeconds: z.number().int().positive(),
});
export type RequestCodeResponse = z.infer<typeof RequestCodeResponseSchema>;

export const VerifyCodeRequestSchema = z.object({
  phone: PhoneSchema,
  code: z.string().regex(/^\d{6}$/),
  deviceId: z.string().min(1).max(255),
  platform: AuthDevicePlatformSchema,
});
export type VerifyCodeRequest = z.infer<typeof VerifyCodeRequestSchema>;

export const TokenPairSchema = z.object({
  accessToken: AccessTokenSchema,
  refreshToken: z.string().min(1),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;
export const LogoutRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const CurrentUserResponseSchema = z.object({
  id: z.string().uuid(),
  phone: PhoneSchema,
  role: UserRoleSchema,
  status: UserStatusSchema,
});
export type CurrentUserResponse = z.infer<typeof CurrentUserResponseSchema>;

export const TripStopRequestSchema = CoordinateSchema.extend({
  address: z.string().min(1).max(512),
});
export type TripStopRequest = z.infer<typeof TripStopRequestSchema>;

export const CreateTripRequestSchema = z.object({
  pickup: CoordinateSchema,
  destination: CoordinateSchema,
  pickupAddress: z.string().min(1).max(512),
  destinationAddress: z.string().min(1).max(512),
  passengerPriceKopecks: KopecksSchema,
  stops: z.array(TripStopRequestSchema).max(10).optional(),
  options: z
    .object({
      childSeat: z.boolean().optional(),
      pet: z.boolean().optional(),
      luggage: z.boolean().optional(),
    })
    .optional(),
  comment: z.string().max(1_000).optional(),
});
export type CreateTripRequest = z.infer<typeof CreateTripRequestSchema>;

export const CreateTripResponseSchema = z.object({ trip: TripSummarySchema });
export type CreateTripResponse = z.infer<typeof CreateTripResponseSchema>;
export const GetTripResponseSchema = CreateTripResponseSchema;
export type GetTripResponse = z.infer<typeof GetTripResponseSchema>;

export const CreateDriverBidRequestSchema = z.object({
  vehicleId: z.string().uuid(),
  offeredPriceKopecks: KopecksSchema.optional(),
});
export type CreateDriverBidRequest = z.infer<
  typeof CreateDriverBidRequestSchema
>;
export const DriverBidResponseSchema = z.object({ bid: DriverBidSchema });
export type DriverBidResponse = z.infer<typeof DriverBidResponseSchema>;

// ---------------------------------------------------------------------------
// Maps: geocoding, address search and routing.
//
// These contracts are provider-agnostic: business code depends on them, never
// on a concrete maps SDK. `provider` records which backend produced a result
// so callers can reason about freshness and cost without importing an SDK.
// ---------------------------------------------------------------------------

export const GeoPointSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

export const TransportModeSchema = z.enum(['driving', 'walking']);
export type TransportMode = z.infer<typeof TransportModeSchema>;

export const AddressSuggestionSchema = z.object({
  id: z.string().min(1).max(256),
  title: z.string().min(1).max(512),
  subtitle: z.string().max(512),
  fullAddress: z.string().min(1).max(1_024),
  location: GeoPointSchema.nullable(),
  provider: z.string().min(1).max(64),
  providerPlaceId: z.string().min(1).max(256).nullable(),
});
export type AddressSuggestion = z.infer<typeof AddressSuggestionSchema>;

export const AddressComponentsSchema = z.object({
  country: z.string().max(128).nullable(),
  region: z.string().max(128).nullable(),
  city: z.string().max(128).nullable(),
  street: z.string().max(256).nullable(),
  house: z.string().max(64).nullable(),
  postalCode: z.string().max(32).nullable(),
});
export type AddressComponents = z.infer<typeof AddressComponentsSchema>;

export const ResolvedAddressSchema = z.object({
  formattedAddress: z.string().min(1).max(1_024),
  location: GeoPointSchema,
  components: AddressComponentsSchema,
  provider: z.string().min(1).max(64),
  providerPlaceId: z.string().min(1).max(256).nullable(),
});
export type ResolvedAddress = z.infer<typeof ResolvedAddressSchema>;

export const RouteWaypointSchema = GeoPointSchema.extend({
  sequence: z.number().int().min(0).max(24),
});
export type RouteWaypoint = z.infer<typeof RouteWaypointSchema>;

export const RouteOptionsSchema = z.object({
  transportMode: TransportModeSchema.default('driving'),
  avoidTolls: z.boolean().default(false),
  avoidUnpavedRoads: z.boolean().default(false),
});
export type RouteOptions = z.infer<typeof RouteOptionsSchema>;

export const RouteRequestSchema = z.object({
  origin: GeoPointSchema,
  destination: GeoPointSchema,
  waypoints: z.array(RouteWaypointSchema).max(10).default([]),
  transportMode: TransportModeSchema.default('driving'),
  avoidTolls: z.boolean().default(false),
  avoidUnpavedRoads: z.boolean().default(false),
});
export type RouteRequest = z.infer<typeof RouteRequestSchema>;

/** GeoJSON-style bounding box: [west, south, east, north]. */
export const GeoBoundsSchema = z.object({
  minLatitude: z.number().finite().min(-90).max(90),
  minLongitude: z.number().finite().min(-180).max(180),
  maxLatitude: z.number().finite().min(-90).max(90),
  maxLongitude: z.number().finite().min(-180).max(180),
});
export type GeoBounds = z.infer<typeof GeoBoundsSchema>;

export const RouteResultSchema = z.object({
  distanceMeters: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
  /** Ordered polyline of the route as GeoPoints (GeoJSON LineString order). */
  geometry: z.array(GeoPointSchema).min(2),
  encodedPolyline: z.string().nullable(),
  bounds: GeoBoundsSchema,
  provider: z.string().min(1).max(64),
  providerRouteId: z.string().min(1).max(256).nullable(),
  warnings: z.array(z.string().max(512)),
  snappedWaypoints: z.array(GeoPointSchema),
});
export type RouteResult = z.infer<typeof RouteResultSchema>;

export const AddressSuggestionsQuerySchema = z.object({
  query: z.string().min(3).max(256),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});
export type AddressSuggestionsQuery = z.infer<
  typeof AddressSuggestionsQuerySchema
>;

export const AddressSuggestionsResponseSchema = z.object({
  suggestions: z.array(AddressSuggestionSchema),
  provider: z.string().min(1).max(64),
});
export type AddressSuggestionsResponse = z.infer<
  typeof AddressSuggestionsResponseSchema
>;

export const GeocodeRequestSchema = z.object({
  address: z.string().min(3).max(1_024),
});
export type GeocodeRequest = z.infer<typeof GeocodeRequestSchema>;

export const GeocodeResponseSchema = z.object({
  address: ResolvedAddressSchema,
});
export type GeocodeResponse = z.infer<typeof GeocodeResponseSchema>;

export const ReverseGeocodeRequestSchema = GeoPointSchema;
export type ReverseGeocodeRequest = z.infer<typeof ReverseGeocodeRequestSchema>;

export const ReverseGeocodeResponseSchema = GeocodeResponseSchema;
export type ReverseGeocodeResponse = z.infer<
  typeof ReverseGeocodeResponseSchema
>;

export const RouteEstimateResponseSchema = z.object({
  distanceMeters: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
  bounds: GeoBoundsSchema,
  provider: z.string().min(1).max(64),
});
export type RouteEstimateResponse = z.infer<typeof RouteEstimateResponseSchema>;

export const RouteBuildResponseSchema = z.object({ route: RouteResultSchema });
export type RouteBuildResponse = z.infer<typeof RouteBuildResponseSchema>;

// ---------------------------------------------------------------------------
// Pricing: a recommended fare range shown to the passenger. It is a suggestion,
// not the final tariff — the passenger may still name their own price as long
// as it clears the system minimum.
// ---------------------------------------------------------------------------

export const PricingEstimateRequestSchema = z.object({
  distanceMeters: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  route: RouteRequestSchema.optional(),
});
export type PricingEstimateRequest = z.infer<
  typeof PricingEstimateRequestSchema
>;

export const PricingEstimateResponseSchema = z.object({
  recommendedPriceKopecks: KopecksSchema,
  minimumSuggestedPriceKopecks: KopecksSchema,
  maximumSuggestedPriceKopecks: KopecksSchema,
  distanceMeters: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
});
export type PricingEstimateResponse = z.infer<
  typeof PricingEstimateResponseSchema
>;

export const ErrorResponseSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const REALTIME_EVENT_NAMES = [
  'trip.searching',
  'trip.updated',
  'trip.cancelled',
  'bid.created',
  'bid.withdrawn',
  'bid.expired',
  'bid.accepted',
  'driver.location.updated',
  'driver.arrived',
  'trip.started',
  'trip.completed',
] as const;
export const RealtimeEventNameSchema = z.enum(REALTIME_EVENT_NAMES);
export type RealtimeEventName = z.infer<typeof RealtimeEventNameSchema>;

export const TripEventPayloadSchema = z.object({
  tripId: z.string().uuid(),
  status: TripStatusSchema,
  previousStatus: TripStatusSchema.optional(),
  version: z.number().int().nonnegative(),
});
export type TripEventPayload = z.infer<typeof TripEventPayloadSchema>;

export const BidEventPayloadSchema = z.object({
  bidId: z.string().uuid(),
  tripId: z.string().uuid(),
  driverId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  offeredPriceKopecks: KopecksSchema,
  status: DriverBidStatusSchema,
  expiresAt: z.string().datetime({ offset: true }).optional(),
  version: z.number().int().nonnegative(),
});
export type BidEventPayload = z.infer<typeof BidEventPayloadSchema>;

export const DriverLocationUpdatedPayloadSchema = CoordinateSchema.extend({
  driverId: z.string().uuid(),
  accuracyMeters: z.number().finite().min(0).max(100_000),
  recordedAt: z.string().datetime({ offset: true }),
});
export type DriverLocationUpdatedPayload = z.infer<
  typeof DriverLocationUpdatedPayloadSchema
>;

export const RealtimeEventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  room: z.string().min(1).max(128),
  sequence: z.number().int().positive(),
});
export type RealtimeEventEnvelope<TPayload> = z.infer<
  typeof RealtimeEventEnvelopeSchema
> & { payload: TPayload };

function createRealtimeEventSchema<TPayload extends z.ZodTypeAny>(
  payload: TPayload,
) {
  return RealtimeEventEnvelopeSchema.extend({ payload });
}

export const RealtimeEventSchemas = {
  'trip.searching': createRealtimeEventSchema(TripEventPayloadSchema),
  'trip.updated': createRealtimeEventSchema(TripEventPayloadSchema),
  'trip.cancelled': createRealtimeEventSchema(TripEventPayloadSchema),
  'driver.arrived': createRealtimeEventSchema(TripEventPayloadSchema),
  'trip.started': createRealtimeEventSchema(TripEventPayloadSchema),
  'trip.completed': createRealtimeEventSchema(TripEventPayloadSchema),
  'bid.created': createRealtimeEventSchema(BidEventPayloadSchema),
  'bid.withdrawn': createRealtimeEventSchema(BidEventPayloadSchema),
  'bid.expired': createRealtimeEventSchema(BidEventPayloadSchema),
  'bid.accepted': createRealtimeEventSchema(BidEventPayloadSchema),
  'driver.location.updated': createRealtimeEventSchema(
    DriverLocationUpdatedPayloadSchema,
  ),
} as const;

export interface RealtimeEventPayloads {
  'bid.accepted': BidEventPayload;
  'bid.created': BidEventPayload;
  'bid.expired': BidEventPayload;
  'bid.withdrawn': BidEventPayload;
  'driver.arrived': TripEventPayload;
  'driver.location.updated': DriverLocationUpdatedPayload;
  'trip.cancelled': TripEventPayload;
  'trip.completed': TripEventPayload;
  'trip.searching': TripEventPayload;
  'trip.started': TripEventPayload;
  'trip.updated': TripEventPayload;
}

export type RealtimeEventByName<TName extends RealtimeEventName> = z.infer<
  (typeof RealtimeEventSchemas)[TName]
>;

// ---------------------------------------------------------------------------
// Push notifications (Task 28). Push is never the source of truth: opening a
// notification always re-syncs from REST/WebSocket. The two payload shapes
// below are deliberately different —
//   - PushNotificationPayloadSchema is the full manifest (includes the
//     display copy: title/body) used server-side and for the in-app inbox.
//   - PushDataPayloadSchema is what actually rides in the native push
//     message's data block. `.strict()` makes it a hard runtime boundary: an
//     access/refresh token, OTP, phone number, or any other field not listed
//     here fails validation rather than silently being allowed through.
// ---------------------------------------------------------------------------

export const NotificationTypeSchema = z.enum([
  'DRIVER_NEW_TRIP_AVAILABLE',
  'DRIVER_BID_ACCEPTED',
  'DRIVER_BID_REJECTED',
  'DRIVER_TRIP_CANCELLED',
  'DRIVER_PAYMENT_RESERVED',
  'DRIVER_PICKUP_REMINDER',
  'DRIVER_LOCATION_DEGRADED',
  'DRIVER_DOCUMENT_EXPIRING',
  'DRIVER_ACCOUNT_APPROVED',
  'DRIVER_ACCOUNT_REJECTED',
  'DRIVER_PAYOUT_COMPLETED',
  'DRIVER_PAYOUT_FAILED',
  'PASSENGER_BID_RECEIVED',
  'PASSENGER_DRIVER_SELECTED',
  'PASSENGER_DRIVER_EN_ROUTE',
  'PASSENGER_DRIVER_ARRIVED',
  'PASSENGER_TRIP_STARTED',
  'PASSENGER_TRIP_COMPLETED',
  'PASSENGER_TRIP_CANCELLED',
  'PASSENGER_PAYMENT_RESERVED',
  'PASSENGER_PAYMENT_FAILED',
  'PASSENGER_REFUND_COMPLETED',
  'SECURITY_SESSION_REVOKED',
  'SYSTEM_SERVICE_NOTICE',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationCategorySchema = z.enum([
  'TRIP_OFFERS',
  'ACTIVE_TRIP',
  'PAYMENTS',
  'DRIVER_OPERATIONS',
  'ACCOUNT',
  'SECURITY',
]);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

export const NotificationPrioritySchema = z.enum([
  'NORMAL',
  'HIGH',
  'CRITICAL',
]);
export type NotificationPriority = z.infer<typeof NotificationPrioritySchema>;

export const NotificationStatusSchema = z.enum([
  'PENDING',
  'QUEUED',
  'SENT',
  'PARTIALLY_SENT',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;

export const NotificationDeliveryStatusSchema = z.enum([
  'QUEUED',
  'SENT',
  'PROVIDER_ACCEPTED',
  'DELIVERED',
  'OPENED',
  'RETRY_SCHEDULED',
  'FAILED_TEMPORARY',
  'FAILED_PERMANENT',
  'TOKEN_INVALID',
]);
export type NotificationDeliveryStatus = z.infer<
  typeof NotificationDeliveryStatusSchema
>;

export const PushPlatformSchema = z.enum(['ANDROID', 'IOS']);
export type PushPlatform = z.infer<typeof PushPlatformSchema>;

export const PushApplicationSchema = z.enum(['PASSENGER', 'DRIVER']);
export type PushApplication = z.infer<typeof PushApplicationSchema>;

export const PushProviderTypeSchema = z.enum([
  'DEVELOPMENT',
  'STAGING',
  'FCM',
  'APNS',
]);
export type PushProviderType = z.infer<typeof PushProviderTypeSchema>;

export const PushEnvironmentSchema = z.enum([
  'DEVELOPMENT',
  'STAGING',
  'PRODUCTION',
]);
export type PushEnvironment = z.infer<typeof PushEnvironmentSchema>;

export const NotificationPreviewModeSchema = z.enum([
  'FULL',
  'GENERIC',
  'HIDDEN',
]);
export type NotificationPreviewMode = z.infer<
  typeof NotificationPreviewModeSchema
>;

/** The full notification manifest — server-side record and in-app inbox item shape. Never rendered verbatim on a locked screen; see NotificationPreviewMode. */
export const PushNotificationPayloadSchema = z.object({
  notificationId: z.string().uuid(),
  type: NotificationTypeSchema,
  entityType: z.string().min(1).max(32),
  entityId: z.string().uuid().nullable(),
  occurredAt: z.string().datetime({ offset: true }),
  sequence: z.number().int().nonnegative(),
  deepLink: z.string().max(512).nullable(),
  title: z.string().min(1).max(128),
  body: z.string().min(1).max(512),
  dataVersion: z.number().int().positive(),
});
export type PushNotificationPayload = z.infer<
  typeof PushNotificationPayloadSchema
>;

/**
 * The actual `data` block of a native push message — deliberately narrow.
 * `.strict()` rejects any key not listed here, so a token/OTP/phone number/
 * address ending up in a push payload is a validation failure, not a review
 * miss. The client re-fetches everything else from REST/WebSocket after
 * opening the notification.
 */
export const PushDataPayloadSchema = z
  .object({
    notificationId: z.string().uuid(),
    type: NotificationTypeSchema,
    tripId: z.string().uuid().optional(),
    bidId: z.string().uuid().nullable().optional(),
    paymentId: z.string().uuid().nullable().optional(),
    sequence: z.number().int().nonnegative(),
    deepLink: z.string().max(512).optional(),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type PushDataPayload = z.infer<typeof PushDataPayloadSchema>;

export const RegisterDeviceRequestSchema = z.object({
  deviceId: z.string().min(1).max(255),
  deviceSessionId: z.string().uuid(),
  application: PushApplicationSchema,
  platform: PushPlatformSchema,
  provider: PushProviderTypeSchema,
  pushToken: z.string().min(1).max(4_096),
  appVersion: z.string().max(32).optional(),
  osVersion: z.string().max(32).optional(),
  locale: z.string().max(16).optional(),
  notificationsPermission: z.boolean(),
});
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequestSchema>;

export const RegisterDeviceResponseSchema = z.object({
  registrationId: z.string().uuid(),
  status: z.enum(['ACTIVE', 'INVALID', 'REVOKED', 'EXPIRED']),
  registeredAt: z.string().datetime({ offset: true }),
});
export type RegisterDeviceResponse = z.infer<
  typeof RegisterDeviceResponseSchema
>;

export const NotificationPreferenceEntrySchema = z.object({
  category: NotificationCategorySchema,
  pushEnabled: z.boolean(),
  soundEnabled: z.boolean(),
  vibrationEnabled: z.boolean(),
});
export type NotificationPreferenceEntry = z.infer<
  typeof NotificationPreferenceEntrySchema
>;

export const NotificationPreferencesResponseSchema = z.object({
  categories: z.array(NotificationPreferenceEntrySchema),
  previewMode: NotificationPreviewModeSchema,
});
export type NotificationPreferencesResponse = z.infer<
  typeof NotificationPreferencesResponseSchema
>;

export const UpdateNotificationPreferencesRequestSchema = z.object({
  categories: z.array(
    NotificationPreferenceEntrySchema.partial().extend({
      category: NotificationCategorySchema,
    }),
  ),
  previewMode: NotificationPreviewModeSchema.optional(),
});
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof UpdateNotificationPreferencesRequestSchema
>;

export const NotificationInboxItemSchema = z.object({
  id: z.string().uuid(),
  type: NotificationTypeSchema,
  title: z.string().max(128),
  body: z.string().max(512),
  createdAt: z.string().datetime({ offset: true }),
  readAt: z.string().datetime({ offset: true }).nullable(),
  openedAt: z.string().datetime({ offset: true }).nullable(),
  entityType: z.string().max(32),
  entityId: z.string().uuid().nullable(),
  deepLink: z.string().max(512).nullable(),
});
export type NotificationInboxItem = z.infer<typeof NotificationInboxItemSchema>;

export const NotificationInboxResponseSchema = z.object({
  items: z.array(NotificationInboxItemSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationInboxResponse = z.infer<
  typeof NotificationInboxResponseSchema
>;
