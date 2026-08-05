import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceAlongRoute,
  computeRouteProgress,
  polylineLengthMeters,
} from './routeProgress';

// A short straight "route" along a line of constant longitude, so distances
// scale ~linearly with latitude difference — easy to reason about by hand.
const straightRoute = [
  { latitude: 59.9, longitude: 30.3 },
  { latitude: 59.91, longitude: 30.3 },
  { latitude: 59.92, longitude: 30.3 },
  { latitude: 59.93, longitude: 30.3 },
];

test('computeRouteProgress splits traveled/remaining at the projected position', () => {
  const progress = computeRouteProgress(straightRoute, {
    latitude: 59.915,
    longitude: 30.3,
  });

  assert.equal(progress.segmentIndex, 1);
  assert.ok(progress.traveled.length >= 2);
  assert.ok(progress.remaining.length >= 2);
  // The projected split point is shared by both halves' boundary.
  const splitFromTraveled = progress.traveled[progress.traveled.length - 1]!;
  const splitFromRemaining = progress.remaining[0]!;
  assert.equal(splitFromTraveled.latitude, splitFromRemaining.latitude);
});

test('computeRouteProgress puts everything in remaining at the route start', () => {
  const progress = computeRouteProgress(straightRoute, straightRoute[0]!);
  assert.equal(progress.traveled.length, 1);
  assert.equal(progress.remaining.length, straightRoute.length);
});

test('computeRouteProgress puts everything in traveled at the route end', () => {
  const progress = computeRouteProgress(
    straightRoute,
    straightRoute[straightRoute.length - 1]!,
  );
  assert.equal(progress.remaining.length, 1);
});

test('computeRouteProgress reports off-route distance for a point away from the line', () => {
  const progress = computeRouteProgress(straightRoute, {
    latitude: 59.915,
    longitude: 30.31,
  });
  assert.ok(progress.distanceFromRouteMeters > 400); // ~0.01 deg longitude at this latitude
});

test('computeRouteProgress degrades gracefully for a single-point geometry', () => {
  const progress = computeRouteProgress([{ latitude: 59.9, longitude: 30.3 }], {
    latitude: 59.91,
    longitude: 30.3,
  });
  assert.equal(progress.traveled.length, 0);
  assert.equal(progress.remaining.length, 1);
  assert.ok(progress.distanceFromRouteMeters > 0);
});

test('polylineLengthMeters sums segment distances', () => {
  const length = polylineLengthMeters(straightRoute);
  assert.ok(length > 3_000 && length < 3_500); // ~0.03 deg latitude ≈ 3.3km
});

test('advanceAlongRoute walks forward by the requested distance', () => {
  const { point, index } = advanceAlongRoute(straightRoute, 0, 1_000);
  assert.equal(index, 0);
  assert.ok(point.latitude > straightRoute[0]!.latitude);
  assert.ok(point.latitude < straightRoute[1]!.latitude);
});

test('advanceAlongRoute clamps to the route end when distance exceeds its length', () => {
  const { point } = advanceAlongRoute(straightRoute, 0, 1_000_000);
  assert.deepEqual(point, straightRoute[straightRoute.length - 1]);
});
