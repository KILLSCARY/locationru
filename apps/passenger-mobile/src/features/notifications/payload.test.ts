import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePushDataPayload, routeForDeepLink } from './payload';

test('parsePushDataPayload accepts a full payload', () => {
  const payload = parsePushDataPayload({
    notificationId: 'notif-1',
    type: 'PASSENGER_DRIVER_SELECTED',
    tripId: 'trip-1',
    sequence: 12345,
    deepLink: 'resilienttaxi://trips/trip-1',
    occurredAt: '2026-01-01T00:00:00Z',
  });

  assert.equal(payload?.notificationId, 'notif-1');
  assert.equal(payload?.tripId, 'trip-1');
  assert.equal(payload?.sequence, 12345);
  assert.equal(payload?.paymentId, undefined);
});

test('parsePushDataPayload returns null when notificationId is missing', () => {
  assert.equal(
    parsePushDataPayload({ type: 'PASSENGER_DRIVER_SELECTED' }),
    null,
  );
});

test('parsePushDataPayload returns null when type is missing', () => {
  assert.equal(parsePushDataPayload({ notificationId: 'notif-1' }), null);
});

test('parsePushDataPayload tolerates a non-numeric sequence rather than crashing', () => {
  const payload = parsePushDataPayload({
    notificationId: 'notif-1',
    type: 'SYSTEM_SERVICE_NOTICE',
    sequence: 'not-a-number',
  });
  assert.equal(payload?.sequence, undefined);
});

test('routeForDeepLink maps a trips deep link to the trip screen', () => {
  assert.equal(
    routeForDeepLink('resilienttaxi://trips/trip-1'),
    '/trip/trip-1',
  );
});

test('routeForDeepLink returns null for a deep link with no matching screen', () => {
  assert.equal(routeForDeepLink('resilienttaxi://payments/payment-1'), null);
  assert.equal(routeForDeepLink('resilienttaxi://account/security'), null);
});

test('routeForDeepLink returns null when there is no deep link', () => {
  assert.equal(routeForDeepLink(undefined), null);
});
