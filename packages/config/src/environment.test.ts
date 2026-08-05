import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AppEnvironment,
  environmentFlags,
  isAppEnvironment,
  parseAppEnvironment,
} from './environment.js';

test('isAppEnvironment accepts only the four known values', () => {
  assert.equal(isAppEnvironment('development'), true);
  assert.equal(isAppEnvironment('test'), true);
  assert.equal(isAppEnvironment('staging'), true);
  assert.equal(isAppEnvironment('production'), true);
  assert.equal(isAppEnvironment('prod'), false);
  assert.equal(isAppEnvironment(''), false);
});

test('parseAppEnvironment throws on an invalid or missing value', () => {
  assert.equal(parseAppEnvironment('staging'), AppEnvironment.STAGING);
  assert.throws(() => parseAppEnvironment('prod'));
  assert.throws(() => parseAppEnvironment(undefined));
});

test('environmentFlags marks staging and production as deployed and hardened', () => {
  const staging = environmentFlags(AppEnvironment.STAGING);
  assert.equal(staging.isStaging, true);
  assert.equal(staging.isDeployed, true);
  assert.equal(staging.requiresHardenedConfig, true);

  const development = environmentFlags(AppEnvironment.DEVELOPMENT);
  assert.equal(development.isDeployed, false);
  assert.equal(development.requiresHardenedConfig, false);

  const production = environmentFlags(AppEnvironment.PRODUCTION);
  assert.equal(production.isDeployed, true);
  assert.equal(production.requiresHardenedConfig, true);
});
