import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTRACT_PACKAGE_VERSION,
  CONTRACT_VERSION,
  CoordinateSchema,
  CreateTripRequestSchema,
  DriverBidSchema,
  DriverLocationUpdateSchema,
  NotificationTypeSchema,
  PushDataPayloadSchema,
  PushNotificationPayloadSchema,
  RealtimeEventSchemas,
  RegisterDeviceRequestSchema,
  TripStatusSchema,
} from '../dist/index.js';

const ids = {
  bidId: '00000000-0000-4000-8000-000000000001',
  driverId: '00000000-0000-4000-8000-000000000002',
  tripId: '00000000-0000-4000-8000-000000000003',
  vehicleId: '00000000-0000-4000-8000-000000000004',
};
const timestamp = '2026-07-27T12:00:00.000Z';

test('validates coordinates and rejects values outside the world bounds', () => {
  assert.deepEqual(
    CoordinateSchema.parse({ latitude: 55.75, longitude: 37.62 }),
    {
      latitude: 55.75,
      longitude: 37.62,
    },
  );
  assert.equal(
    CoordinateSchema.safeParse({ latitude: 91, longitude: 37.62 }).success,
    false,
  );
});

test('validates passenger trip requests and integer kopecks', () => {
  const request = {
    pickup: { latitude: 55.75, longitude: 37.62 },
    destination: { latitude: 55.76, longitude: 37.63 },
    pickupAddress: 'Pickup',
    destinationAddress: 'Destination',
    passengerPriceKopecks: 12_500,
  };
  assert.equal(CreateTripRequestSchema.safeParse(request).success, true);
  assert.equal(
    CreateTripRequestSchema.safeParse({
      ...request,
      passengerPriceKopecks: 12.5,
    }).success,
    false,
  );
});

test('validates driver bids, driver locations and stable status enums', () => {
  assert.equal(TripStatusSchema.safeParse('SEARCHING').success, true);
  assert.equal(TripStatusSchema.safeParse('ARBITRARY_STATUS').success, false);
  assert.equal(
    DriverBidSchema.safeParse({
      ...ids,
      id: ids.bidId,
      offeredPriceKopecks: 12_500,
      estimatedPickupSeconds: 300,
      distanceToPickupMeters: 1_000,
      status: 'ACTIVE',
      expiresAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 0,
    }).success,
    true,
  );
  assert.equal(
    DriverLocationUpdateSchema.safeParse({
      latitude: 55.75,
      longitude: 37.62,
      recordedAt: timestamp,
      accuracyMeters: 10,
      speedMetersPerSecond: null,
      bearingDegrees: null,
      altitudeMeters: null,
      provider: 'gps',
      confidence: 'HIGH',
      suspectedSpoofing: false,
      satellitesVisible: null,
      cellCount: null,
    }).success,
    true,
  );
});

test('validates websocket envelopes and exposes the v1 contract identity', () => {
  assert.equal(CONTRACT_VERSION, 'v1');
  assert.equal(CONTRACT_PACKAGE_VERSION, '1.0.0');
  assert.equal(
    RealtimeEventSchemas['trip.searching'].safeParse({
      eventId: ids.bidId,
      room: `trip:${ids.tripId}`,
      sequence: 1,
      occurredAt: timestamp,
      payload: {
        tripId: ids.tripId,
        status: 'SEARCHING',
        version: 1,
      },
    }).success,
    true,
  );
  assert.equal(
    RealtimeEventSchemas['trip.searching'].safeParse({
      eventId: ids.bidId,
      room: `trip:${ids.tripId}`,
      sequence: 0,
      occurredAt: timestamp,
      payload: { tripId: ids.tripId, status: 'SEARCHING', version: 1 },
    }).success,
    false,
  );
});

test('validates the full push notification manifest', () => {
  assert.equal(NotificationTypeSchema.safeParse('DRIVER_NEW_TRIP_AVAILABLE').success, true);
  assert.equal(NotificationTypeSchema.safeParse('MARKETING_BLAST').success, false);
  assert.equal(
    PushNotificationPayloadSchema.safeParse({
      notificationId: ids.bidId,
      type: 'PASSENGER_DRIVER_ARRIVED',
      entityType: 'TRIP',
      entityId: ids.tripId,
      occurredAt: timestamp,
      sequence: 1,
      deepLink: `resilienttaxi://trips/${ids.tripId}`,
      title: 'Водитель прибыл',
      body: 'Машина ожидает в точке подачи.',
      dataVersion: 1,
    }).success,
    true,
  );
});

test('rejects any push data payload field beyond the allowed minimal set', () => {
  const valid = {
    notificationId: ids.bidId,
    type: 'PASSENGER_BID_RECEIVED',
    tripId: ids.tripId,
    bidId: ids.bidId,
    sequence: 1,
    occurredAt: timestamp,
  };
  assert.equal(PushDataPayloadSchema.safeParse(valid).success, true);

  for (const forbiddenKey of [
    'accessToken',
    'refreshToken',
    'otp',
    'phone',
    'bankAccount',
    'webhookSecret',
  ]) {
    assert.equal(
      PushDataPayloadSchema.safeParse({ ...valid, [forbiddenKey]: 'leak' })
        .success,
      false,
      `expected ${forbiddenKey} to be rejected`,
    );
  }
});

test('validates a device registration request and rejects an empty push token', () => {
  const request = {
    deviceId: 'device-1',
    deviceSessionId: ids.tripId,
    application: 'PASSENGER',
    platform: 'IOS',
    provider: 'APNS',
    pushToken: 'a'.repeat(64),
    notificationsPermission: true,
  };
  assert.equal(RegisterDeviceRequestSchema.safeParse(request).success, true);
  assert.equal(
    RegisterDeviceRequestSchema.safeParse({ ...request, pushToken: '' })
      .success,
    false,
  );
});
