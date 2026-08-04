const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  normalizeAnalysis,
  selectExecutionTargets,
  summarizePlaywrightResult,
  friendlyError,
  runCommand,
  validateExecuteRequest,
  validateTargetUrl,
} = require('./controller');

test('controller delegates exact command, args, cwd, and environment to the invocation adapter', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmv-001-controller-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = { dir, debugLog: [] };
  let captured;
  const result = await runCommand(
    run,
    'website analysis and navigation plan',
    'C:\\repo\\.venv\\Scripts\\python.exe',
    ['tools/ai-generator/agent_orchestrator.py', '--generation-mode', 'plan', '--url', 'https://example.test/', '--no-profile-cache'],
    { env: { EXPLICIT: 'override' } },
    {
      parentEnv: { INHERITED: 'parent', EXPLICIT: 'parent' },
      invokeEngineProcessImpl: async (invocation) => {
        captured = invocation;
        return { exitCode: 0, signal: null, stdout: 'ok', stderr: '', spawnError: null };
      },
    },
  );
  assert.equal(captured.command, 'C:\\repo\\.venv\\Scripts\\python.exe');
  assert.deepEqual(captured.args, [
    'tools/ai-generator/agent_orchestrator.py', '--generation-mode', 'plan', '--url', 'https://example.test/', '--no-profile-cache',
  ]);
  assert.equal(captured.cwd, path.resolve(__dirname, '..', '..'));
  assert.deepEqual(captured.env, {
    INHERITED: 'parent',
    EXPLICIT: 'override',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  });
  assert.deepEqual(result, { code: 0, signal: null, stdout: 'ok', stderr: '' });
});

test('target URL validation accepts HTTP(S) and rejects credentials', () => {
  assert.equal(validateTargetUrl('https://example.test/docs'), 'https://example.test/docs');
  assert.throws(() => validateTargetUrl('https://user:secret@example.test'), /credential-free/);
  assert.throws(() => validateTargetUrl('not-a-url'), /absolute HTTP/);
});

test('analysis normalization exposes restore-ready tabs only', () => {
  const report = {
    version: '2.1', summary: { targetUrl: 'https://example.test' }, generatedNavigationTests: [], pageIdentityAssertions: [],
    safeInteractionCandidates: [{ candidateKey: 'key', classification: 'safe', interactionKind: 'tab', text: 'Product A', pageContext: 'Sample Page', ariaAttributes: { selected: 'false' }, tabRestore: { target: { text: 'Product B' } } }],
    unsafeActionCandidates: [], unresolvedCandidates: [],
  };
  const value = normalizeAnalysis(report, { schemaVersion: '1.0', targetUrl: 'https://example.test' });
  assert.equal(value.summary.executionEligible, 1);
  assert.equal(value.interactions[0].restoreTargetText, 'Product B');
});

test('Playwright JSON summary separates navigation, identity, and restoration', () => {
  const raw = { suites: [{ specs: [
    { title: 'Navigation: Sample Page', file: 'generated_from_plan.spec.js', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
    { title: 'Interaction: Product A tab selection', file: 'generated_interaction_plan.spec.js', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
  ] }] };
  const result = summarizePlaywrightResult(raw,
    { tests: [{ title: 'GNB: Sample Page', menuPath: ['Sample Page'], template: 'navigation.contentIdentity' }] },
    { tests: [{ title: 'Interaction: Product A tab selection', template: 'interaction.tabSelection' }] }, 1000, 0);
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
      title: 'Navigation: Sample Page',
      file: 'mvp-run-generated_from_plan.spec.js',
      tests: [{ status: 'expected', results: [{ status: 'failed' }] }],
    },
  ] }] };
  const result = summarizePlaywrightResult(
    raw,
    { tests: [{ menuPath: ['Sample Page'], template: 'navigation.headingIdentity' }] },
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
      title: 'Navigation: Sample Page',
      file: 'mvp-run-generated_from_plan.spec.js',
      tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
    },
  ] }] };
  const result = summarizePlaywrightResult(
    raw,
    { tests: [{ menuPath: ['Sample Page'], template: 'navigation.contentIdentity' }] },
    null,
    500,
    0,
  );
  assert.equal(result.overall, 'PASS');
  assert.equal(result.pageNavigation.identityVerified, 1);
  assert.equal(result.softInteractions.status, 'skipped');
  assert.equal(result.softInteractions.failed, 0);
});

test('bootstrap failures provide actionable local recovery commands', () => {
  assert.match(
    friendlyError('Website analysis', Object.assign(new Error('spawn ENOENT'), {
      code: 'ENOENT',
      path: '.venv\\Scripts\\python.exe',
    })),
    /Create the project venv/,
  );
  assert.match(
    friendlyError('Website analysis', {
      result: { stderr: "ModuleNotFoundError: No module named 'dotenv'", stdout: '' },
    }),
    /npm run env:sync/,
  );
  assert.match(
    friendlyError('Playwright execution', {
      result: { stderr: "browserType.launch: Executable doesn't exist", stdout: '' },
    }),
    /playwright install chromium/,
  );
  assert.match(
    friendlyError('Website analysis', {
      result: { stderr: 'page.goto: net::ERR_NAME_NOT_RESOLVED', stdout: '' },
    }),
    /network/,
  );
});
