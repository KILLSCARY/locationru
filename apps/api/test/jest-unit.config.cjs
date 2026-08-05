const base = require('../jest.config.cjs');

module.exports = {
  ...base,
  rootDir: '..',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
