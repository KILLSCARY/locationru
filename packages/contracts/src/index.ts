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

/** Provider-neutral geographic contracts. Coordinate order is always lat/lon
 * on the wire; GeoJSON geometry below follows the standard lon/lat order. */
export const GeoPointSchema = CoordinateSchema;
export type GeoPoint = z.infer<typeof GeoPointSchema>;

export const AddressComponentsSchema = z.object({
  country: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  house: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
});
export type AddressComponents = z.infer<typeof AddressComponentsSchema>;

export const AddressSuggestionSchema = z.object({
  id: z.string().min(1).max(512),
  title: z.string().min(1).max(512),
  subtitle: z.string().max(512).nullable(),
  fullAddress: z.string().min(1).max(512),
  location: GeoPointSchema.nullable(),
  provider: z.string().min(1).max(64),
  providerPlaceId: z.string().max(512).nullable(),
});
export type AddressSuggestion = z.infer<typeof AddressSuggestionSchema>;

export const ResolvedAddressSchema = z.object({
  formattedAddress: z.string().min(1).max(512),
  location: GeoPointSchema,
  providerPlaceId: z.string().max(512).nullable(),
  provider: z.string().min(1).max(64),
  components: AddressComponentsSchema,
});
export type ResolvedAddress = z.infer<typeof ResolvedAddressSchema>;

export const RouteTransportModeSchema = z.enum(['CAR']);
export type RouteTransportMode = z.infer<typeof RouteTransportModeSchema>;

export const RouteRequestSchema = z.object({
  origin: GeoPointSchema,
  destination: GeoPointSchema,
  waypoints: z.array(GeoPointSchema).max(10).default([]),
  transportMode: RouteTransportModeSchema.default('CAR'),
  avoidTolls: z.boolean().default(false),
  avoidUnpavedRoads: z.boolean().default(false),
});
export type RouteRequest = z.infer<typeof RouteRequestSchema>;

export const RouteLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z
    .array(
      z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    )
    .min(2),
});
export type RouteLineString = z.infer<typeof RouteLineStringSchema>;

export const RouteBoundsSchema = z.object({
  southWest: GeoPointSchema,
  northEast: GeoPointSchema,
});
export type RouteBounds = z.infer<typeof RouteBoundsSchema>;

export const RouteResultSchema = z.object({
  distanceMeters: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
  geometry: RouteLineStringSchema,
  encodedPolyline: z.string().nullable(),
  bounds: RouteBoundsSchema,
  snappedWaypoints: z.array(GeoPointSchema),
  provider: z.string().min(1).max(64),
  providerRouteId: z.string().max(512).nullable(),
  warnings: z.array(z.string().max(512)),
});
export type RouteResult = z.infer<typeof RouteResultSchema>;

export const AddressSuggestionsRequestSchema = z.object({
  query: z.string().trim().min(3).max(256),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
export type AddressSuggestionsRequest = z.infer<
  typeof AddressSuggestionsRequestSchema
>;
export const AddressSuggestionsResponseSchema = z.object({
  suggestions: z.array(AddressSuggestionSchema).max(10),
});
export type AddressSuggestionsResponse = z.infer<
  typeof AddressSuggestionsResponseSchema
>;

export const GeocodeAddressRequestSchema = z.object({
  address: z.string().trim().min(3).max(512),
  providerPlaceId: z.string().max(512).nullable().optional(),
});
export type GeocodeAddressRequest = z.infer<typeof GeocodeAddressRequestSchema>;
export const ReverseGeocodeRequestSchema = GeoPointSchema;
export type ReverseGeocodeRequest = z.infer<typeof ReverseGeocodeRequestSchema>;
export const ResolvedAddressResponseSchema = z.object({
  address: ResolvedAddressSchema,
});
export type ResolvedAddressResponse = z.infer<
  typeof ResolvedAddressResponseSchema
>;

export const PricingEstimateSchema = z.object({
  recommendedPriceKopecks: KopecksSchema,
  minimumSuggestedPriceKopecks: KopecksSchema,
  maximumSuggestedPriceKopecks: KopecksSchema,
  distanceMeters: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
});
export type PricingEstimate = z.infer<typeof PricingEstimateSchema>;

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

export const TripAddressPointSchema = GeoPointSchema.extend({
  formattedAddress: z.string().min(1).max(512),
  providerPlaceId: z.string().max(512).nullable(),
});
export type TripAddressPoint = z.infer<typeof TripAddressPointSchema>;

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
  pickup: TripAddressPointSchema,
  destination: TripAddressPointSchema,
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

export const TripStopRequestSchema = TripAddressPointSchema.extend({
  sequence: z.number().int().min(1).max(10),
});
export type TripStopRequest = z.infer<typeof TripStopRequestSchema>;

export const CreateTripRequestSchema = z.object({
  pickup: TripAddressPointSchema,
  destination: TripAddressPointSchema,
  passengerPriceKopecks: KopecksSchema,
  waypoints: z.array(TripStopRequestSchema).max(10).optional(),
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

export const TripMutationResponseSchema = z.object({
  id: z.string().uuid(),
  status: TripStatusSchema,
  version: z.number().int().nonnegative(),
});
export type TripMutationResponse = z.infer<typeof TripMutationResponseSchema>;

export const CreateTripResponseSchema = TripMutationResponseSchema;
export type CreateTripResponse = z.infer<typeof CreateTripResponseSchema>;

export const PassengerTripDetailsSchema = TripMutationResponseSchema.extend({
  passengerPriceKopecks: KopecksSchema,
  finalPriceKopecks: KopecksSchema.nullable(),
  selectedDriverId: z.string().uuid().nullable(),
  selectedVehicleId: z.string().uuid().nullable(),
  pickup: TripAddressPointSchema,
  destination: TripAddressPointSchema,
  estimatedDistanceMeters: z.number().int().nonnegative(),
  estimatedDurationSeconds: z.number().int().nonnegative(),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  cancelledAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  options: z.object({
    childSeat: z.boolean(),
    pet: z.boolean(),
    luggage: z.boolean(),
  }),
  comment: z.string().nullable(),
  waypoints: z.array(TripStopRequestSchema).max(10),
});
export type PassengerTripDetails = z.infer<typeof PassengerTripDetailsSchema>;

export const GetTripResponseSchema = PassengerTripDetailsSchema;
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
