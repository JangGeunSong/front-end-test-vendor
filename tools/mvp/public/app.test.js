const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  identityBuckets,
  interactionMatchesFilter,
  runButtonLabel,
  shouldIgnoreCardToggle,
} = require('./app');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');

test('navigation review is collapsed by default and keeps identity summaries', () => {
  assert.match(html, /<details id="navigation-details" class="review-details">/);
  assert.doesNotMatch(html, /<details id="navigation-details"[^>]*\sopen/);
  assert.deepEqual(identityBuckets([
    { identityType: 'heading' },
    { identityType: 'content' },
    { identityType: 'tab' },
    { identityType: 'none' },
  ]), {
    'Heading identity': 1,
    'Content identity': 1,
    'Tab identity': 1,
    Other: 1,
  });
});

test('Ready to test is the default filter and Selected uses current selection', () => {
  assert.match(html, /data-filter="ready" aria-pressed="true"/);
  const ready = { candidateKey: 'ready', executionEligible: true };
  const review = { candidateKey: 'review', executionEligible: false };
  assert.equal(interactionMatchesFilter(ready, 'ready', new Set()), true);
  assert.equal(interactionMatchesFilter(review, 'ready', new Set()), false);
  assert.equal(interactionMatchesFilter(review, 'review', new Set()), true);
  assert.equal(interactionMatchesFilter(ready, 'selected', new Set(['ready'])), true);
});

test('run label permits navigation-only and includes approved selection count', () => {
  assert.equal(runButtonLabel(41, 0), 'Run 41 navigation tests');
  assert.equal(runButtonLabel(8, 2), 'Run 10 tests');
});

test('candidate cards have selected styling and interactive descendants do not toggle cards', () => {
  assert.match(css, /\.interaction-card\.selected/);
  assert.match(css, /\.selected-badge/);
  assert.equal(shouldIgnoreCardToggle({ closest: () => ({}) }), true);
  assert.equal(shouldIgnoreCardToggle({ closest: () => null }), false);
});

test('run summary is sticky and debugging details are collapsed by default', () => {
  assert.match(css, /\.run-bar\s*\{[^}]*position:\s*sticky/s);
  assert.match(html, /<details><summary>Debugging details<\/summary>/);
  assert.match(html, /<details><summary>Show debugging details<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
});

test('navigation-only result copy uses SKIPPED instead of 0 / 0 PASS', () => {
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(app, /metric\('Soft Interaction', 'SKIPPED'\)/);
  assert.match(app, /metric\('Restoration', 'SKIPPED'\)/);
  assert.match(app, /value\.status === 'pending' \? 'not started'/);
});
