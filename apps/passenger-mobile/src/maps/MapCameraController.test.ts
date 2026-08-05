import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapCameraController } from './MapCameraController';

test('fitRouteBounds issues a fitBounds command and turns off following', () => {
  const controller = new MapCameraController();
  const bounds = {
    minLatitude: 0,
    minLongitude: 0,
    maxLatitude: 1,
    maxLongitude: 1,
  };
  const command = controller.fitRouteBounds(bounds);
  assert.deepEqual(command, { type: 'fitBounds', bounds });
  assert.equal(controller.isFollowing, false);
});

test('startFollowingDriver enables follow mode', () => {
  const controller = new MapCameraController();
  controller.startFollowingDriver({ latitude: 1, longitude: 1 }, 90);
  assert.equal(controller.isFollowing, true);
});

test('a manual camera move disables follow mode', () => {
  const controller = new MapCameraController();
  controller.startFollowingDriver({ latitude: 1, longitude: 1 }, 90);
  controller.onManualCameraMove();
  assert.equal(controller.isFollowing, false);
});

test('updateDriverPosition is a no-op while not following', () => {
  const controller = new MapCameraController();
  const command = controller.updateDriverPosition(
    { latitude: 1, longitude: 1 },
    0,
  );
  assert.equal(command, null);
});

test('updateDriverPosition ignores tiny jitter (protects against constant sharp jumps)', () => {
  const controller = new MapCameraController({
    minMoveMetersToRecenter: 50,
    minBearingChangeDegrees: 20,
  });
  controller.startFollowingDriver({ latitude: 59.93, longitude: 30.35 }, 90);
  // ~1 metre away, same bearing — should not trigger a new command.
  const command = controller.updateDriverPosition(
    { latitude: 59.930001, longitude: 30.35 },
    91,
  );
  assert.equal(command, null);
});

test('updateDriverPosition recentres once movement exceeds the threshold', () => {
  const controller = new MapCameraController({
    minMoveMetersToRecenter: 10,
    minBearingChangeDegrees: 20,
  });
  controller.startFollowingDriver({ latitude: 59.93, longitude: 30.35 }, 90);
  // ~1.1km south — well past the 10m threshold.
  const command = controller.updateDriverPosition(
    { latitude: 59.92, longitude: 30.35 },
    90,
  );
  assert.ok(command);
  assert.equal(command!.type, 'followDriver');
});

test('updateDriverPosition recentres on a large bearing change even with little movement', () => {
  const controller = new MapCameraController({
    minMoveMetersToRecenter: 1_000,
    minBearingChangeDegrees: 15,
  });
  controller.startFollowingDriver({ latitude: 59.93, longitude: 30.35 }, 10);
  const command = controller.updateDriverPosition(
    { latitude: 59.930001, longitude: 30.35 },
    200,
  );
  assert.ok(command);
});

test('resumeFollowing re-enables follow at the last known driver position', () => {
  const controller = new MapCameraController();
  controller.startFollowingDriver({ latitude: 59.93, longitude: 30.35 }, 90);
  controller.onManualCameraMove();
  assert.equal(controller.isFollowing, false);

  const command = controller.resumeFollowing();
  assert.equal(controller.isFollowing, true);
  assert.deepEqual(command, {
    type: 'followDriver',
    point: { latitude: 59.93, longitude: 30.35 },
    bearingDegrees: 90,
  });
});

test('resumeFollowing is a no-op when the driver has never been seen', () => {
  const controller = new MapCameraController();
  assert.equal(controller.resumeFollowing(), null);
});
