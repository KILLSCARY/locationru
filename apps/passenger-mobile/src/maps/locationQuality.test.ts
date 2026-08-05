import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLocationQuality,
  DEFAULT_LOCATION_QUALITY_THRESHOLDS,
} from './locationQuality';

const base = {
  location: { latitude: 59.93, longitude: 30.35 },
  accuracyMeters: 10,
  recordedAt: '2026-01-01T00:00:00.000Z',
};
const nowMs = Date.parse(base.recordedAt);

test('classifies a fresh, accurate, slow-moving sample as STABLE', () => {
  const result = classifyLocationQuality(base, null, nowMs);
  assert.equal(result.status, 'STABLE');
});

test('classifies a low-accuracy sample as DEGRADED', () => {
  const result = classifyLocationQuality(
    { ...base, accuracyMeters: 80 },
    null,
    nowMs,
  );
  assert.equal(result.status, 'DEGRADED');
});

test('classifies a sample older than staleAfterSeconds as STALE', () => {
  const laterMs =
    nowMs + (DEFAULT_LOCATION_QUALITY_THRESHOLDS.staleAfterSeconds + 1) * 1_000;
  const result = classifyLocationQuality(base, null, laterMs);
  assert.equal(result.status, 'STALE');
});

test('classifies a sample older than unavailableAfterSeconds as UNAVAILABLE', () => {
  const laterMs =
    nowMs +
    (DEFAULT_LOCATION_QUALITY_THRESHOLDS.unavailableAfterSeconds + 1) * 1_000;
  const result = classifyLocationQuality(base, null, laterMs);
  assert.equal(result.status, 'UNAVAILABLE');
});

test('classifies an impossible jump from the previous sample as SPOOFING_SUSPECTED', () => {
  const previous = {
    location: { latitude: 59.93, longitude: 30.35 },
    accuracyMeters: 10,
    recordedAt: '2026-01-01T00:00:00.000Z',
  };
  const jumped = {
    location: { latitude: 60.5, longitude: 31.0 }, // ~65km away
    accuracyMeters: 10,
    recordedAt: '2026-01-01T00:00:02.000Z', // 2 seconds later
  };
  const result = classifyLocationQuality(
    jumped,
    previous,
    Date.parse(jumped.recordedAt),
  );
  assert.equal(result.status, 'SPOOFING_SUSPECTED');
});

test('does not flag a legitimate long gap as spoofing when average speed is plausible', () => {
  const previous = {
    location: { latitude: 59.93, longitude: 30.35 },
    accuracyMeters: 10,
    recordedAt: '2026-01-01T00:00:00.000Z',
  };
  // ~1km away, 2 minutes later => ~8.3 m/s, well within plausible city driving speed.
  const later = {
    location: { latitude: 59.939, longitude: 30.35 },
    accuracyMeters: 10,
    recordedAt: '2026-01-01T00:02:00.000Z',
  };
  const result = classifyLocationQuality(
    later,
    previous,
    Date.parse(later.recordedAt),
  );
  assert.equal(result.status, 'STABLE');
});

test('staleness takes priority over spoofing/accuracy checks', () => {
  const laterMs =
    nowMs + (DEFAULT_LOCATION_QUALITY_THRESHOLDS.staleAfterSeconds + 5) * 1_000;
  const result = classifyLocationQuality(
    { ...base, accuracyMeters: 999 },
    null,
    laterMs,
  );
  assert.equal(result.status, 'STALE');
});
