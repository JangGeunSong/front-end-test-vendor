const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAnalysis,
  selectExecutionTargets,
  summarizePlaywrightResult,
  validateExecuteRequest,
  validateTargetUrl,
} = require('./controller');

test('target URL validation accepts HTTP(S) and rejects credentials', () => {
  assert.equal(validateTargetUrl('https://example.test/docs'), 'https://example.test/docs');
  assert.throws(() => validateTargetUrl('https://user:secret@example.test'), /credential-free/);
  assert.throws(() => validateTargetUrl('not-a-url'), /absolute HTTP/);
});

test('analysis normalization exposes restore-ready tabs only', () => {
  const report = {
    version: '2.1', summary: { targetUrl: 'https://example.test' }, generatedNavigationTests: [], pageIdentityAssertions: [],
    safeInteractionCandidates: [{ candidateKey: 'key', classification: 'safe', interactionKind: 'tab', text: 'Yarn', pageContext: 'Docs', ariaAttributes: { selected: 'false' }, tabRestore: { target: { text: 'npm' } } }],
    unsafeActionCandidates: [], unresolvedCandidates: [],
  };
  const value = normalizeAnalysis(report, { schemaVersion: '1.0', targetUrl: 'https://example.test' });
  assert.equal(value.summary.executionEligible, 1);
  assert.equal(value.interactions[0].restoreTargetText, 'npm');
});

test('Playwright JSON summary separates navigation, identity, and restoration', () => {
  const raw = { suites: [{ specs: [
    { title: 'Navigation: Docs', file: 'generated_from_plan.spec.js', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
    { title: 'Interaction: Yarn tab selection', file: 'generated_interaction_plan.spec.js', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
  ] }] };
  const result = summarizePlaywrightResult(raw,
    { tests: [{ title: 'GNB: Docs', menuPath: ['Docs'], template: 'navigation.contentIdentity' }] },
    { tests: [{ title: 'Interaction: Yarn tab selection', template: 'interaction.tabSelection' }] }, 1000, 0);
  assert.equal(result.pageNavigation.identityVerified, 1);
  assert.equal(result.softInteractions.restorationPassed, 1);
  assert.equal(result.softInteractions.status, 'passed');
  assert.equal(result.overall, 'PASS');
});

test('execution target selection includes approved interactions with navigation', () => {
  assert.deepEqual(selectExecutionTargets(8, ['interaction:key']), {
    navigation: true,
    interaction: true,
    interactionSkipReason: null,
  });
});

test('execution target selection runs navigation only when candidates exist but none are approved', () => {
  assert.deepEqual(selectExecutionTargets(8, []), {
    navigation: true,
    interaction: false,
    interactionSkipReason: 'no-approved-supported-interactions',
  });
});

test('execution target selection runs navigation only when no eligible candidates exist', () => {
  assert.equal(selectExecutionTargets(41).interaction, false);
});

test('execution target selection rejects a run with no navigation or interactions', () => {
  assert.throws(() => selectExecutionTargets(0, []), /No Page Navigation tests/);
});

test('execute API gate accepts analysis-complete navigation-only state and rejects invalid state', () => {
  assert.doesNotThrow(() => validateExecuteRequest({
    status: 'ready_for_execution',
    analysis: { summary: { navigationCount: 8 } },
  }));
  assert.doesNotThrow(() => validateExecuteRequest({
    status: 'approved',
    approvedCandidateKeys: ['interaction:key'],
    analysis: { summary: { navigationCount: 8 } },
  }));
  assert.throws(() => validateExecuteRequest({
    status: 'analyzing',
    analysis: { summary: { navigationCount: 8 } },
  }), /not ready/);
});

test('navigation-only failure remains overall FAIL while interaction is SKIPPED', () => {
  const raw = { suites: [{ specs: [
    {
      title: 'Navigation: Docs',
      file: 'mvp-run-generated_from_plan.spec.js',
      tests: [{ status: 'expected', results: [{ status: 'failed' }] }],
    },
  ] }] };
  const result = summarizePlaywrightResult(
    raw,
    { tests: [{ menuPath: ['Docs'], template: 'navigation.headingIdentity' }] },
    null,
    500,
    1,
  );
  assert.equal(result.overall, 'FAIL');
  assert.equal(result.pageNavigation.failed, 1);
  assert.equal(result.softInteractions.status, 'skipped');
  assert.equal(result.softInteractions.restorationStatus, 'skipped');
  assert.equal(result.softInteractions.reason, 'no-approved-supported-interactions');
});

test('navigation-only success does not count skipped interaction as failure', () => {
  const raw = { suites: [{ specs: [
    {
      title: 'Navigation: Docs',
      file: 'mvp-run-generated_from_plan.spec.js',
      tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
    },
  ] }] };
  const result = summarizePlaywrightResult(
    raw,
    { tests: [{ menuPath: ['Docs'], template: 'navigation.contentIdentity' }] },
    null,
    500,
    0,
  );
  assert.equal(result.overall, 'PASS');
  assert.equal(result.pageNavigation.identityVerified, 1);
  assert.equal(result.softInteractions.status, 'skipped');
  assert.equal(result.softInteractions.failed, 0);
});
