const base = require('../../playwright.config');
const path = require('path');

module.exports = {
  ...base,
  testDir: path.resolve(__dirname, '../../tests'),
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    ...base.use,
    headless: true,
    launchOptions: {
      ...(base.use?.launchOptions || {}),
      slowMo: 0,
    },
    trace: 'on',
  },
};
