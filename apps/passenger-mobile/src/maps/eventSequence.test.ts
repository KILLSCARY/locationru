import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomSequenceTracker } from './eventSequence';

test('applies the next-in-order sequence and advances', () => {
  const tracker = new RoomSequenceTracker(0);
  assert.deepEqual(tracker.observe(1), { type: 'apply' });
  assert.equal(tracker.current, 1);
});

test('flags an out-of-order/duplicate event without advancing', () => {
  const tracker = new RoomSequenceTracker(5);
  assert.deepEqual(tracker.observe(5), { type: 'duplicate_or_old' });
  assert.deepEqual(tracker.observe(3), { type: 'duplicate_or_old' });
  assert.equal(tracker.current, 5);
});

test('detects a gap when a sequence skips ahead', () => {
  const tracker = new RoomSequenceTracker(5);
  const outcome = tracker.observe(8);
  assert.deepEqual(outcome, {
    type: 'gap_detected',
    lastApplied: 5,
    received: 8,
  });
  assert.equal(tracker.current, 5); // does not advance until resync fills the gap
});

test('fastForwardTo applies the replay result and unblocks later events', () => {
  const tracker = new RoomSequenceTracker(5);
  tracker.observe(8); // gap detected
  tracker.fastForwardTo(8);
  assert.equal(tracker.current, 8);
  assert.deepEqual(tracker.observe(9), { type: 'apply' });
});

test('fastForwardTo never moves the sequence backward', () => {
  const tracker = new RoomSequenceTracker(10);
  tracker.fastForwardTo(3);
  assert.equal(tracker.current, 10);
});
