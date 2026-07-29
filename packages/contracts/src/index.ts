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
