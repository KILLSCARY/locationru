import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PUSH_CHANNELS } from './push-channels-config';

test('channel ids match the backend ANDROID_CHANNEL_BY_CATEGORY mapping', () => {
  // Mirrors firebase-push.provider.ts's ANDROID_CHANNEL_BY_CATEGORY and
  // driver-android's PushNotificationChannel — a drift here would mean a
  // background push lands in the wrong (or a nonexistent) Android channel.
  const ids = PUSH_CHANNELS.map((channel) => channel.id);
  assert.deepEqual(
    [...ids].sort(),
    [
      'account',
      'active_trip',
      'driver_operations',
      'payments',
      'security',
      'trip_offers',
    ].sort(),
  );
});

test('every channel has a non-empty display name', () => {
  for (const channel of PUSH_CHANNELS) {
    assert.ok(channel.name.length > 0, `channel ${channel.id} has no name`);
  }
});
