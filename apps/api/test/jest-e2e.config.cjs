const base = require('../jest.config.cjs');

module.exports = {
  ...base,
  rootDir: '..',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
};
