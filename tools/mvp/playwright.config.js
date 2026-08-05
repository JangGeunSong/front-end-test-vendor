const base = require('../../playwright.config');
const path = require('path');
const { channel: _systemBrowserChannel, ...baseUse } = base.use || {};

module.exports = {
  ...base,
  testDir: process.env.MVP_PLAYWRIGHT_TEST_DIR || path.resolve(__dirname, '../../tests'),
  outputDir: process.env.MVP_PLAYWRIGHT_OUTPUT_DIR || base.outputDir,
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
