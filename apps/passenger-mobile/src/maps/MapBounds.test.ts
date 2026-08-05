import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsCenter,
  boundsOfPoints,
  containsPoint,
  padBounds,
  unionBounds,
} from './MapBounds';

test('boundsOfPoints covers every point exactly', () => {
  const bounds = boundsOfPoints([
    { latitude: 59.93, longitude: 30.35 },
    { latitude: 59.8, longitude: 30.26 },
    { latitude: 59.9, longitude: 30.4 },
  ]);
  assert.deepEqual(bounds, {
    minLatitude: 59.8,
    minLongitude: 30.26,
    maxLatitude: 59.93,
    maxLongitude: 30.4,
  });
});

test('boundsOfPoints throws on an empty list', () => {
  assert.throws(() => boundsOfPoints([]));
});

test('unionBounds covers both input boxes', () => {
  const a = {
    minLatitude: 0,
    minLongitude: 0,
    maxLatitude: 1,
    maxLongitude: 1,
  };
  const b = {
    minLatitude: 2,
    minLongitude: 2,
    maxLatitude: 3,
    maxLongitude: 3,
  };
  assert.deepEqual(unionBounds(a, b), {
    minLatitude: 0,
    minLongitude: 0,
    maxLatitude: 3,
    maxLongitude: 3,
  });
});

test('padBounds expands symmetrically by the given ratio', () => {
  const bounds = {
    minLatitude: 10,
    minLongitude: 10,
    maxLatitude: 20,
    maxLongitude: 20,
  };
  const padded = padBounds(bounds, 0.1);
  assert.equal(padded.minLatitude, 9);
  assert.equal(padded.maxLatitude, 21);
  assert.equal(padded.minLongitude, 9);
  assert.equal(padded.maxLongitude, 21);
});

test('boundsCenter is the midpoint', () => {
  const bounds = {
    minLatitude: 0,
    minLongitude: 0,
    maxLatitude: 10,
    maxLongitude: 20,
  };
  assert.deepEqual(boundsCenter(bounds), { latitude: 5, longitude: 10 });
});

test('containsPoint respects box edges inclusively', () => {
  const bounds = {
    minLatitude: 0,
    minLongitude: 0,
    maxLatitude: 10,
    maxLongitude: 10,
  };
  assert.equal(containsPoint(bounds, { latitude: 0, longitude: 0 }), true);
  assert.equal(containsPoint(bounds, { latitude: 10, longitude: 10 }), true);
  assert.equal(containsPoint(bounds, { latitude: 11, longitude: 5 }), false);
});
