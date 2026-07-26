const test = require('node:test');
const assert = require('node:assert/strict');

test('Local MVP uses installed bundled Chromium with deterministic execution settings', () => {
  const config = require('./playwright.config');

  assert.equal(config.use.channel, undefined);
  assert.equal(config.use.headless, true);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
});
