import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bearingBetween,
  haversineMeters,
  lerpPoint,
  projectOntoSegment,
} from './geo';

test('haversineMeters is zero for identical points', () => {
  const p = { latitude: 59.93, longitude: 30.35 };
  assert.equal(haversineMeters(p, p), 0);
});

test('haversineMeters matches a known distance (~1 deg latitude ≈ 111.2 km)', () => {
  const distance = haversineMeters(
    { latitude: 0, longitude: 0 },
    { latitude: 1, longitude: 0 },
  );
  assert.ok(distance > 110_000 && distance < 112_000);
});

test('lerpPoint at t=0 and t=1 returns the endpoints', () => {
  const a = { latitude: 0, longitude: 0 };
  const b = { latitude: 10, longitude: 20 };
  assert.deepEqual(lerpPoint(a, b, 0), a);
  assert.deepEqual(lerpPoint(a, b, 1), b);
});

test('bearingBetween points due north is ~0', () => {
  const bearing = bearingBetween(
    { latitude: 59.9, longitude: 30.3 },
    { latitude: 59.91, longitude: 30.3 },
  );
  assert.ok(bearing < 1 || bearing > 359);
});

test('bearingBetween points due east is ~90', () => {
  const bearing = bearingBetween(
    { latitude: 59.9, longitude: 30.3 },
    { latitude: 59.9, longitude: 30.31 },
  );
  assert.ok(Math.abs(bearing - 90) < 1);
});

test('projectOntoSegment clamps t to the segment endpoints', () => {
  const a = { latitude: 0, longitude: 0 };
  const b = { latitude: 0, longitude: 1 };
  const beforeStart = projectOntoSegment({ latitude: 0, longitude: -1 }, a, b);
  assert.equal(beforeStart.t, 0);
  const afterEnd = projectOntoSegment({ latitude: 0, longitude: 2 }, a, b);
  assert.equal(afterEnd.t, 1);
});
