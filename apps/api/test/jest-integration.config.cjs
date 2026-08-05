const base = require('../jest.config.cjs');

module.exports = {
  ...base,
  rootDir: '..',
  testMatch: [
    '<rootDir>/test/dispatch.postgis.integration.e2e-spec.ts',
    '<rootDir>/test/maps.integration-spec.ts',
  ],
};
