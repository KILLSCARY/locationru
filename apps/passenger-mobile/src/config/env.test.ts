import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveAppEnv, resolveUseMocks } from './env';

test('resolveAppEnv defaults to development when unset', () => {
  delete process.env.EXPO_PUBLIC_APP_ENV;
  assert.equal(resolveAppEnv(), 'development');
});

test('resolveAppEnv recognizes staging', () => {
  process.env.EXPO_PUBLIC_APP_ENV = 'staging';
  assert.equal(resolveAppEnv(), 'staging');
  delete process.env.EXPO_PUBLIC_APP_ENV;
});

test('resolveAppEnv recognizes production', () => {
  process.env.EXPO_PUBLIC_APP_ENV = 'production';
  assert.equal(resolveAppEnv(), 'production');
  delete process.env.EXPO_PUBLIC_APP_ENV;
});

test('resolveAppEnv falls back to development for an unrecognized value', () => {
  process.env.EXPO_PUBLIC_APP_ENV = 'nonsense';
  assert.equal(resolveAppEnv(), 'development');
  delete process.env.EXPO_PUBLIC_APP_ENV;
});

test('resolveUseMocks is false by default', () => {
  delete process.env.EXPO_PUBLIC_USE_MOCKS;
  assert.equal(resolveUseMocks(), false);
});

test('resolveUseMocks is true only for the literal string "true"', () => {
  process.env.EXPO_PUBLIC_USE_MOCKS = 'true';
  assert.equal(resolveUseMocks(), true);
  process.env.EXPO_PUBLIC_USE_MOCKS = '1';
  assert.equal(resolveUseMocks(), false);
  delete process.env.EXPO_PUBLIC_USE_MOCKS;
});
