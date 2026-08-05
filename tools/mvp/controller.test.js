const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  analyzeRun,
  createRun,
  executeRun,
  generateRunId,
  getRun,
  normalizeAnalysis,
  selectExecutionTargets,
  summarizePlaywrightResult,
  friendlyError,
  runCommand,
  validateExecuteRequest,
  validateTargetUrl,
} = require('./controller');
const { createRunWorkspace, ensureRunWorkspace } = require('./run-workspace');
const { ARTIFACT_IDS } = require('./artifact-manifest');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const CONTROLLER_TEST_WORKSPACE_ROOT = path.join(
  REPOSITORY_ROOT,
  'tools',
  'ai-generator',
  'generated',
  'controller-workspace-tests',
);

function testRunId(label) {
  return `${Date.now()}-${process.pid}-${label}`;
}

function createTestWorkspace(t, label) {
  const workspace = createRunWorkspace({
    repositoryRoot: REPOSITORY_ROOT,
    workspaceRoot: CONTROLLER_TEST_WORKSPACE_ROOT,
    runId: testRunId(label),
  });
  ensureRunWorkspace(workspace);
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }));
  return workspace;
}

test('controller delegates exact command, args, cwd, and environment to the invocation adapter', async (t) => {
  const workspace = createTestWorkspace(t, 'invocation');
  const run = { workspace, dir: workspace.root, debugLog: [] };
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

test('run creation uses a validated workspace contract and preserves the generated run ID shape', (t) => {
  const runId = testRunId('create');
  const run = createRun('https://example.test/', {
    runId,
    workspaceRoot: CONTROLLER_TEST_WORKSPACE_ROOT,
  });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));

  assert.equal(run.id, runId);
  assert.equal(run.dir, run.workspace.root);
  assert.equal(run.specDir, run.workspace.specDir);
  assert.equal(fs.existsSync(run.workspace.paths.status), true);
  assert.match(generateRunId(), /^\d{13}-[0-9a-f]{8}$/);
});

test('workspace provisioning failure is propagated without registering or contaminating another run', (t) => {
  const healthyId = testRunId('healthy');
  const failedId = testRunId('failed');
  const healthy = createRun('https://example.test/', {
    runId: healthyId,
    workspaceRoot: CONTROLLER_TEST_WORKSPACE_ROOT,
  });
  t.after(() => fs.rmSync(healthy.workspace.root, { recursive: true, force: true }));

  assert.throws(() => createRun('https://example.test/', {
    runId: failedId,
    workspaceRoot: CONTROLLER_TEST_WORKSPACE_ROOT,
    ensureWorkspace: () => { throw new Error('workspace unavailable'); },
  }), /workspace unavailable/);
  assert.throws(() => getRun(failedId), /not found/);
  assert.equal(getRun(healthyId), healthy);
  assert.equal(healthy.status, 'created');
});

test('analysis invokes the orchestrator and review tools with workspace-derived paths', async (t) => {
  const run = createRun('https://example.test/', {
    runId: testRunId('analysis'),
    workspaceRoot: CONTROLLER_TEST_WORKSPACE_ROOT,
  });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
  const calls = [];
  await analyzeRun(run, {
    runCommandImpl: async (_run, label, _executable, args) => {
      calls.push({ label, args });
      if (label === 'website analysis and navigation plan') {
        fs.writeFileSync(run.workspace.paths.scoutResult, '{"pageProfiles":[]}\n', 'utf8');
        fs.writeFileSync(run.workspace.paths.menuMap, '{"menus":[]}\n', 'utf8');
        fs.writeFileSync(run.workspace.paths.navigationPlan, JSON.stringify({ schemaVersion: '1.0', targetUrl: run.url, tests: [] }), 'utf8');
        fs.writeFileSync(run.workspace.paths.navigationSpec, '// generated\n', 'utf8');
      } else if (label === 'interaction discovery') {
        fs.writeFileSync(run.workspace.paths.analysisReviewJson, JSON.stringify({
          version: '2.1',
          summary: { targetUrl: run.url },
          generatedNavigationTests: [],
          pageIdentityAssertions: [],
          safeInteractionCandidates: [],
          unsafeActionCandidates: [],
          unresolvedCandidates: [],
        }), 'utf8');
      } else if (label === 'analysis report rendering') {
        fs.writeFileSync(run.workspace.paths.analysisReviewMarkdown, '# Review\n', 'utf8');
      }
      return { code: 0, signal: null, stdout: '', stderr: '' };
    },
  });

  assert.equal(run.status, 'ready_for_execution');
  assert.deepEqual(calls[0].args.slice(-4), [
    '--generated-dir', run.workspace.analysisDir,
    '--navigation-spec-output', run.workspace.paths.navigationSpec,
  ]);
  assert.equal(calls[1].args.includes(run.workspace.paths.scoutResult), true);
  assert.equal(calls[1].args.includes(run.workspace.paths.menuMap), true);
  assert.equal(calls[1].args.includes(run.workspace.paths.navigationPlan), true);
  assert.equal(calls[2].args.includes(run.workspace.paths.analysisReviewMarkdown), true);
});

test('navigation execution isolates Playwright testDir, outputDir, JSON, and HTML paths', async (t) => {
  const run = createRun('https://example.test/', {
    runId: testRunId('execute'),
    workspaceRoot: CONTROLLER_TEST_WORKSPACE_ROOT,
  });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
  run.status = 'ready_for_execution';
  run.analysis = { summary: { navigationCount: 1 } };
  run.navigationSpec = run.workspace.paths.navigationSpec;
  fs.writeFileSync(run.workspace.paths.navigationPlan, JSON.stringify({
    targetUrl: run.url,
    tests: [{ menuPath: ['Sample Page'], template: 'navigation.urlOnly' }],
  }), 'utf8');
  fs.writeFileSync(run.navigationSpec, '// generated\n', 'utf8');
  let playwrightCall;
  await executeRun(run, {
    runCommandImpl: async (_run, label, executable, args, options) => {
      assert.equal(label, 'Playwright execution');
      playwrightCall = { executable, args, options };
      fs.writeFileSync(run.workspace.paths.playwrightJsonReport, JSON.stringify({
        suites: [{ specs: [{
          title: 'Navigation: Sample Page',
          file: 'generated_from_plan.spec.js',
          tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
        }] }],
      }), 'utf8');
      fs.writeFileSync(run.workspace.paths.playwrightHtmlReportIndex, '<html></html>', 'utf8');
      return { code: 0, signal: null, stdout: '', stderr: '' };
    },
  });

  assert.equal(run.status, 'completed');
  assert.equal(playwrightCall.args.includes('generated_from_plan.spec.js'), true);
  assert.equal(playwrightCall.options.env.MVP_PLAYWRIGHT_TEST_DIR, run.workspace.specDir);
  assert.equal(playwrightCall.options.env.MVP_PLAYWRIGHT_OUTPUT_DIR, run.workspace.testResultsDir);
  assert.equal(playwrightCall.options.env.PLAYWRIGHT_JSON_OUTPUT_NAME, run.workspace.paths.playwrightJsonReport);
  assert.equal(playwrightCall.options.env.PLAYWRIGHT_HTML_OUTPUT_DIR, run.workspace.playwrightHtmlReportDir);
  assert.equal(run.result.reportUrl, `/api/runs/${run.id}/report`);
  const manifest = JSON.parse(fs.readFileSync(run.workspace.paths.artifactManifest, 'utf8'));
  assert.equal(manifest.artifacts.find((entry) => entry.artifactId === ARTIFACT_IDS.PLAYWRIGHT_JSON).presence, 'present');
  assert.equal(manifest.artifacts.find((entry) => entry.artifactId === ARTIFACT_IDS.PLAYWRIGHT_HTML).presence, 'present');
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
