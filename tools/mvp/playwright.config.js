const base = require('../../playwright.config');
const path = require('path');
const { channel: _systemBrowserChannel, ...baseUse } = base.use || {};

module.exports = {
  ...base,
  testDir: path.resolve(__dirname, '../../tests'),
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    ...baseUse,
    headless: true,
    launchOptions: {
      ...(base.use?.launchOptions || {}),
      slowMo: 0,
    },
    trace: 'on',
  },
};
