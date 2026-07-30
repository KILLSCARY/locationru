import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriverMarkerInterpolator } from './DriverMarkerInterpolator';

const OPTIONS = {
  defaultDurationMs: 1_000,
  maxDurationMs: 5_000,
  maxPlausibleSpeedMetersPerSecond: 55,
};

test('snaps immediately to the first sample (no previous position to animate from)', () => {
  const interpolator = new DriverMarkerInterpolator(OPTIONS);
  const outcome = interpolator.ingest(
    {
      location: { latitude: 59.93, longitude: 30.35 },
      bearingDegrees: 90,
      recordedAt: '2026-01-01T00:00:00.000Z',
    },
    0,
  );
  assert.equal(outcome, 'accepted');
  assert.deepEqual(interpolator.positionAt(0).location, {
    latitude: 59.93,
    longitude: 30.35,
  });
});

// ~11 m/s (≈40 km/h) over 1 second — a plausible driving speed, ~0.0001 deg latitude.
const PLAUSIBLE_STEP_LAT = 0.0001;

test('interpolates position smoothly between two samples over the animation window', () => {
  const interpolator = new DriverMarkerInterpolator(OPTIONS);
  interpolator.ingest(
    {
      location: { latitude: 59.9, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:00.000Z',
    },
    0,
  );
  interpolator.ingest(
    {
      location: { latitude: 59.9 + PLAUSIBLE_STEP_LAT, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:01.000Z',
    },
    0,
  );

  const midway = interpolator.positionAt(500);
  assert.ok(
    midway.location.latitude > 59.9 &&
      midway.location.latitude < 59.9 + PLAUSIBLE_STEP_LAT,
  );

  const end = interpolator.positionAt(1_000);
  assert.equal(end.location.latitude, 59.9 + PLAUSIBLE_STEP_LAT);
});

test('never renders past the target (clamps t to 1 after the animation window)', () => {
  const interpolator = new DriverMarkerInterpolator(OPTIONS);
  interpolator.ingest(
    {
      location: { latitude: 59.9, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:00.000Z',
    },
    0,
  );
  interpolator.ingest(
    {
      location: { latitude: 59.9 + PLAUSIBLE_STEP_LAT, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:01.000Z',
    },
    0,
  );
  assert.deepEqual(interpolator.positionAt(10_000).location, {
    latitude: 59.9 + PLAUSIBLE_STEP_LAT,
    longitude: 30.3,
  });
});

test('ignores a stale/duplicate sample instead of moving the marker backward', () => {
  const interpolator = new DriverMarkerInterpolator(OPTIONS);
  interpolator.ingest(
    {
      location: { latitude: 59.91, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:05.000Z',
    },
    0,
  );
  const outcome = interpolator.ingest(
    {
      location: { latitude: 59.9, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:03.000Z',
    },
    100,
  );
  assert.equal(outcome, 'stale_ignored');
  assert.deepEqual(interpolator.positionAt(100).location, {
    latitude: 59.91,
    longitude: 30.3,
  });
});

test('rejects a sample implying an impossible speed', () => {
  const interpolator = new DriverMarkerInterpolator(OPTIONS);
  interpolator.ingest(
    {
      location: { latitude: 59.93, longitude: 30.35 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:00.000Z',
    },
    0,
  );
  // ~65km away 2 seconds later => ~32,500 m/s, far beyond any plausible speed.
  const outcome = interpolator.ingest(
    {
      location: { latitude: 60.5, longitude: 31.0 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:02.000Z',
    },
    100,
  );
  assert.equal(outcome, 'implausible_speed_ignored');
  // The rejected sample must not become the new target.
  assert.deepEqual(interpolator.positionAt(100).location, {
    latitude: 59.93,
    longitude: 30.35,
  });
});

test('accepts a legitimate large jump after a long gap (plausible average speed)', () => {
  const interpolator = new DriverMarkerInterpolator(OPTIONS);
  interpolator.ingest(
    {
      location: { latitude: 59.9, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:00.000Z',
    },
    0,
  );
  // ~1km away, 2 minutes later => ~8.3 m/s — ordinary driving speed.
  const outcome = interpolator.ingest(
    {
      location: { latitude: 59.909, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:02:00.000Z',
    },
    120_000,
  );
  assert.equal(outcome, 'accepted');
});

test('caps the animation duration for a very stale gap (does not crawl for minutes)', () => {
  const interpolator = new DriverMarkerInterpolator(OPTIONS);
  interpolator.ingest(
    {
      location: { latitude: 59.9, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:00.000Z',
    },
    0,
  );
  interpolator.ingest(
    {
      location: { latitude: 59.909, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:02:00.000Z',
    },
    120_000,
  );
  // Animation duration is capped at maxDurationMs (5s), so it's essentially done by +6s.
  assert.deepEqual(interpolator.positionAt(126_000).location, {
    latitude: 59.909,
    longitude: 30.3,
  });
});

test('interpolates bearing across the 0/360 wraparound via the shortest path', () => {
  const interpolator = new DriverMarkerInterpolator(OPTIONS);
  interpolator.ingest(
    {
      location: { latitude: 59.9, longitude: 30.3 },
      bearingDegrees: 350,
      recordedAt: '2026-01-01T00:00:00.000Z',
    },
    0,
  );
  interpolator.ingest(
    {
      location: { latitude: 59.9 + PLAUSIBLE_STEP_LAT, longitude: 30.3 },
      bearingDegrees: 10,
      recordedAt: '2026-01-01T00:00:01.000Z',
    },
    0,
  );
  const midway = interpolator.positionAt(500);
  // Shortest path from 350 to 10 passes through 0/360, so midway should be ~0 (or 360), not ~180.
  const bearing = midway.bearingDegrees!;
  const distanceFromZero = Math.min(bearing, 360 - bearing);
  assert.ok(distanceFromZero < 5, `expected bearing near 0, got ${bearing}`);
});

test('hasPosition reflects whether any sample has been accepted yet', () => {
  const interpolator = new DriverMarkerInterpolator(OPTIONS);
  assert.equal(interpolator.hasPosition(), false);
  interpolator.ingest(
    {
      location: { latitude: 59.9, longitude: 30.3 },
      bearingDegrees: 0,
      recordedAt: '2026-01-01T00:00:00.000Z',
    },
    0,
  );
  assert.equal(interpolator.hasPosition(), true);
});
