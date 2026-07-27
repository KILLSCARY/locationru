const base = require('../jest.config.cjs');

module.exports = {
  ...base,
  rootDir: '..',
  testMatch: ['<rootDir>/test/journey.integration-spec.ts'],
  testTimeout: 120_000,
};
