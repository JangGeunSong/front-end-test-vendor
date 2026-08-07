const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TERMINAL_RESULT_SCHEMA_VERSION,
  createTerminalResult,
  summarizePlaywrightAssertions,
  validateTerminalResult,
  writeTerminalResult,
} = require('./terminal-result');
const {
  analyzeRun,
  createRun,
  executeRun,
  publicRun,
} = require('./controller');
const {
  createRunWorkspace,
  ensureRunWorkspace,
} = require('./run-workspace');
const { writeArtifactManifest } = require('./artifact-manifest');
const { ERROR_CODES, createNormalizedError } = require('./normalized-error');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const TEST_WORKSPACE_ROOT = path.join(
  REPOSITORY_ROOT,
  'tools',
  'ai-generator',
  'generated',
  'terminal-result-tests',
);
const FIXED_TIME = new Date('2026-08-05T01:00:00.000Z');
const CONTROLLER_STAGES = [
  'Target validation',
  'Website analysis',
  'Page test plan generation',
  'Interaction discovery',
  'Interaction approval validation',
  'Interaction reconciliation',
  'Interaction plan generation',
  'Interaction spec rendering',
  'Playwright execution',
  'Interaction execution',
  'Report preparation',
];

function uniqueRunId(label) {
  return `${Date.now()}-${process.pid}-${label}`;
}

function workspaceFor(t, label) {
  const workspace = createRunWorkspace({
    repositoryRoot: REPOSITORY_ROOT,
    workspaceRoot: TEST_WORKSPACE_ROOT,
    runId: uniqueRunId(label),
  });
  ensureRunWorkspace(workspace);
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }));
  return workspace;
}

function runFor(workspace, overrides = {}) {
  return {
    id: workspace.runId,
    workspace,
    status: 'completed',
    stages: Object.fromEntries(CONTROLLER_STAGES.map((name) => [name, { status: 'pending' }])),
    ...overrides,
  };
}

function mark(run, entries) {
  for (const [name, status] of Object.entries(entries)) run.stages[name] = { status };
  return run;
}

function passedReport() {
  return {
    suites: [{ specs: [{
      title: 'Navigation: Sample Page',
      file: 'generated_from_plan.spec.js',
      tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
    }] }],
  };
}

function mixedReport() {
  return {
    suites: [{ specs: [
      { title: 'passed', tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
      { title: 'failed', tests: [{ status: 'unexpected', results: [{ status: 'failed' }] }] },
      { title: 'skipped', tests: [{ status: 'skipped', results: [{ status: 'skipped' }] }] },
      { title: 'flaky', tests: [{ status: 'flaky', results: [{ status: 'failed' }, { status: 'passed' }] }] },
    ] }],
  };
}

function prepareAvailableResult(workspace, run, raw = passedReport()) {
  fs.writeFileSync(workspace.paths.status, '{}\n', 'utf8');
  fs.writeFileSync(workspace.paths.analysisReviewJson, '{}\n', 'utf8');
  fs.writeFileSync(workspace.paths.playwrightJsonReport, `${JSON.stringify(raw)}\n`, 'utf8');
  run.result = { overall: 'PASS' };
  writeArtifactManifest(workspace, { clock: () => FIXED_TIME });
}

function fullSuccessInput(t, label = 'success') {
  const workspace = workspaceFor(t, label);
  const run = mark(runFor(workspace), {
    'Target validation': 'success',
    'Website analysis': 'success',
    'Page test plan generation': 'success',
    'Interaction discovery': 'success',
    'Playwright execution': 'success',
    'Report preparation': 'success',
  });
  prepareAvailableResult(workspace, run);
  return {
    workspace,
    run,
    input: {
      run,
      workspace,
      process: { attempted: true, outcome: 'succeeded', exitCode: 0, signaled: false },
      execution: { attempted: true, assertions: summarizePlaywrightAssertions(passedReport()) },
    },
  };
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

test('normalizes a full successful run with a valid manifest and available result', (t) => {
  const { input } = fullSuccessInput(t);
  const result = createTerminalResult(input, { clock: () => FIXED_TIME });

  assert.equal(result.schemaVersion, TERMINAL_RESULT_SCHEMA_VERSION);
  assert.equal(result.outcome, 'succeeded');
  assert.deepEqual(result.lifecycle, { lastCompletedStage: 'report', failedStage: null });
  assert.deepEqual(result.process, {
    attempted: true, outcome: 'succeeded', exitCode: 0, signaled: false, timedOut: false, cancelled: false,
  });
  assert.deepEqual(result.execution, {
    attempted: true,
    assertionOutcome: 'passed',
    counts: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0 },
  });
  assert.equal(result.artifacts.manifestValid, true);
  assert.equal(result.artifacts.resultAvailability, 'available');
  assert.deepEqual(validateTerminalResult(result), []);
});

test('separates a completed Playwright assertion failure from process failure', (t) => {
  const workspace = workspaceFor(t, 'assertion-failure');
  const run = mark(runFor(workspace), {
    'Target validation': 'success',
    'Website analysis': 'success',
    'Page test plan generation': 'success',
    'Interaction discovery': 'success',
    'Playwright execution': 'failed',
    'Report preparation': 'success',
  });
  const report = mixedReport();
  prepareAvailableResult(workspace, run, report);
  run.result.overall = 'FAIL';
  const result = createTerminalResult({
    run,
    workspace,
    process: { attempted: true, outcome: 'succeeded', exitCode: 1, signaled: false },
    execution: { attempted: true, assertions: summarizePlaywrightAssertions(report) },
  }, { clock: () => FIXED_TIME });

  assert.equal(result.outcome, 'completed-with-test-failures');
  assert.equal(result.process.outcome, 'succeeded');
  assert.equal(result.process.exitCode, 1);
  assert.equal(result.execution.assertionOutcome, 'mixed');
  assert.deepEqual(result.execution.counts, { total: 4, passed: 1, failed: 1, skipped: 1, flaky: 1 });
  assert.equal(result.lifecycle.failedStage, 'execution');
  assert.equal(result.hasError, false);
});

test('treats an empty or all-skipped Playwright report as assertion unavailable with known counts', () => {
  assert.deepEqual(summarizePlaywrightAssertions({ suites: [] }), {
    assertionOutcome: 'unavailable',
    counts: { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 },
  });
  assert.deepEqual(summarizePlaywrightAssertions({
    suites: [{ specs: [{ tests: [{ status: 'skipped', results: [{ status: 'skipped' }] }] }] }],
  }), {
    assertionOutcome: 'unavailable',
    counts: { total: 1, passed: 0, failed: 0, skipped: 1, flaky: 0 },
  });
  assert.throws(() => summarizePlaywrightAssertions({}), /suites array/);
});

test('normalizes an execution process failure with unavailable assertions', (t) => {
  const workspace = workspaceFor(t, 'process-failure');
  const run = mark(runFor(workspace, { status: 'failed', error: 'Playwright execution failed.', analysis: {} }), {
    'Target validation': 'success',
    'Website analysis': 'success',
    'Page test plan generation': 'success',
    'Interaction discovery': 'success',
    'Playwright execution': 'failed',
  });
  fs.writeFileSync(workspace.paths.status, '{}\n');
  fs.writeFileSync(workspace.paths.analysisReviewJson, '{}\n');
  writeArtifactManifest(workspace, { clock: () => FIXED_TIME });
  const result = createTerminalResult({
    run,
    workspace,
    process: { attempted: true, outcome: 'failed', exitCode: null, signaled: false },
    execution: { attempted: true, assertions: null },
  }, { clock: () => FIXED_TIME });

  assert.equal(result.outcome, 'partially-succeeded');
  assert.equal(result.lifecycle.failedStage, 'execution');
  assert.equal(result.process.outcome, 'failed');
  assert.equal(result.execution.assertionOutcome, 'unavailable');
  assert.equal(result.execution.counts, null);
  assert.equal(result.artifacts.resultAvailability, 'partial');
});

test('represents deadline expiry as process failure rather than assertion failure', (t) => {
  const workspace = workspaceFor(t, 'timeout');
  const run = mark(runFor(workspace, { status: 'failed', error: 'Playwright execution failed.', analysis: {} }), {
    'Target validation': 'success',
    'Website analysis': 'success',
    'Page test plan generation': 'success',
    'Interaction discovery': 'success',
    'Playwright execution': 'failed',
  });
  fs.writeFileSync(workspace.paths.status, '{}\n');
  fs.writeFileSync(workspace.paths.analysisReviewJson, '{}\n');
  writeArtifactManifest(workspace, { clock: () => FIXED_TIME });
  const normalizedError = createNormalizedError({
    runId: run.id,
    stage: 'execution',
    source: 'playwright',
    operation: 'execute-tests',
    invocationResult: {
      timedOut: true,
      timeoutMs: 25,
      termination: { forced: true, method: 'windows-taskkill' },
    },
  }, { clock: () => FIXED_TIME });
  const result = createTerminalResult({
    run,
    workspace,
    process: { attempted: true, outcome: 'failed', exitCode: null, signaled: false, timedOut: true },
    execution: { attempted: true, assertions: null },
    normalizedError,
    normalizedErrorPersisted: true,
  }, { clock: () => FIXED_TIME });

  assert.equal(result.process.timedOut, true);
  assert.equal(result.execution.assertionOutcome, 'unavailable');
  assert.equal(result.errorReference.code, ERROR_CODES.ENGINE_DEADLINE_EXCEEDED);
  assert.equal(result.outcome, 'partially-succeeded');
  const assertionOnly = mutable(result);
  assertionOnly.process.timedOut = false;
  assert.ok(validateTerminalResult(assertionOnly).some((error) => error.includes('deadline-exceeded')));
});

test('normalizes analysis failure without useful result artifacts as failed', (t) => {
  const workspace = workspaceFor(t, 'analysis-failure');
  const run = mark(runFor(workspace, { status: 'failed', error: 'Website analysis failed.' }), {
    'Target validation': 'success',
    'Website analysis': 'failed',
  });
  fs.writeFileSync(workspace.paths.status, '{}\n');
  writeArtifactManifest(workspace, { clock: () => FIXED_TIME });
  const result = createTerminalResult({
    run,
    workspace,
    process: { attempted: true, outcome: 'failed', exitCode: 1, signaled: false },
    execution: { attempted: false },
  }, { clock: () => FIXED_TIME });

  assert.equal(result.outcome, 'failed');
  assert.deepEqual(result.lifecycle, { lastCompletedStage: 'created', failedStage: 'analysis' });
  assert.equal(result.execution.assertionOutcome, 'not-run');
  assert.equal(result.artifacts.resultAvailability, 'unavailable');
});

test('uses partial completion when review exists but downstream execution did not complete', (t) => {
  const workspace = workspaceFor(t, 'partial');
  const run = mark(runFor(workspace, { status: 'failed', error: 'Reconciliation failed.', analysis: {} }), {
    'Target validation': 'success',
    'Website analysis': 'success',
    'Page test plan generation': 'success',
    'Interaction discovery': 'success',
    'Interaction approval validation': 'success',
    'Interaction reconciliation': 'failed',
  });
  fs.writeFileSync(workspace.paths.status, '{}\n');
  fs.writeFileSync(workspace.paths.analysisReviewJson, '{}\n');
  writeArtifactManifest(workspace, { clock: () => FIXED_TIME });
  const result = createTerminalResult({
    run,
    workspace,
    process: { attempted: true, outcome: 'failed', exitCode: 2, signaled: false },
    execution: { attempted: false },
  }, { clock: () => FIXED_TIME });

  assert.equal(result.outcome, 'partially-succeeded');
  assert.equal(result.lifecycle.lastCompletedStage, 'approval');
  assert.equal(result.lifecycle.failedStage, 'reconciliation');
  assert.equal(result.artifacts.resultAvailability, 'partial');
});

test('does not create a terminal result for analysis-complete decision or execution waiting states', (t) => {
  const workspace = workspaceFor(t, 'non-terminal');
  const run = runFor(workspace, { status: 'ready_for_execution', analysis: { summary: { navigationCount: 0 } } });
  assert.throws(() => createTerminalResult({ run, workspace }), /completed, failed, or cancelled/);
  assert.equal(fs.existsSync(workspace.paths.terminalResult), false);
});

test('normalizes queued and running cancellation without a failed stage or primary error', (t) => {
  for (const attempted of [false, true]) {
    const workspace = workspaceFor(t, attempted ? 'cancelled-running' : 'cancelled-queued');
    const run = mark(runFor(workspace, {
      status: 'cancelled',
      cancellation: {
        state: 'completed', requested: true,
        requestedAt: FIXED_TIME.toISOString(), completedAt: FIXED_TIME.toISOString(),
      },
    }), {
      'Target validation': attempted ? 'success' : 'pending',
      'Website analysis': attempted ? 'cancelled' : 'pending',
    });
    fs.writeFileSync(workspace.paths.status, '{}\n', 'utf8');
    writeArtifactManifest(workspace, { clock: () => FIXED_TIME });
    const result = createTerminalResult({
      run,
      workspace,
      process: {
        attempted,
        outcome: 'cancelled',
        exitCode: null,
        signaled: attempted ? true : null,
        timedOut: false,
        cancelled: true,
      },
      execution: { attempted: false },
    }, { clock: () => FIXED_TIME });
    assert.equal(result.outcome, 'cancelled');
    assert.equal(result.lifecycle.failedStage, null);
    assert.equal(result.process.attempted, attempted);
    assert.equal(result.process.cancelled, true);
    assert.equal(result.hasError, false);
    assert.equal(result.errorReference.status, 'none');
    assert.deepEqual(validateTerminalResult(result), []);

    const invalidRace = mutable(result);
    invalidRace.process.timedOut = true;
    assert.match(validateTerminalResult(invalidRace).join(' '), /cannot be timed out and cancelled|Cancelled outcome/);
  }
});

test('preserves run outcome while distinguishing unavailable and invalid manifests', (t) => {
  const workspace = workspaceFor(t, 'manifest-states');
  const run = mark(runFor(workspace, { result: { overall: 'PASS' } }), {
    'Target validation': 'success',
    'Website analysis': 'success',
    'Page test plan generation': 'success',
    'Interaction discovery': 'success',
    'Playwright execution': 'success',
    'Report preparation': 'success',
  });
  const input = {
    run,
    workspace,
    process: { attempted: true, outcome: 'succeeded', exitCode: 0, signaled: false },
    execution: { attempted: true, assertions: summarizePlaywrightAssertions(passedReport()) },
  };
  const unavailable = createTerminalResult(input, { clock: () => FIXED_TIME });
  assert.equal(unavailable.outcome, 'succeeded');
  assert.equal(unavailable.artifacts.manifestStatus, 'unavailable');
  assert.equal(unavailable.artifacts.resultAvailability, 'partial');

  fs.writeFileSync(workspace.paths.artifactManifest, '{"schemaVersion":"1.0","artifacts":[]}\n');
  const invalid = createTerminalResult(input, { clock: () => FIXED_TIME });
  assert.equal(invalid.outcome, 'succeeded');
  assert.equal(invalid.artifacts.manifestStatus, 'invalid');
  assert.equal(invalid.artifacts.manifestValid, false);
});

test('produces deterministic output without absolute paths or private process data', (t) => {
  const { input } = fullSuccessInput(t, 'deterministic');
  const first = createTerminalResult(input, { clock: () => FIXED_TIME });
  const second = createTerminalResult(input, { clock: () => FIXED_TIME });
  const serialized = JSON.stringify(first);

  assert.deepEqual(first, second);
  assert.equal(serialized.includes(REPOSITORY_ROOT), false);
  assert.equal(/[A-Za-z]:\\/.test(serialized), false);
  assert.equal(serialized.includes('stdout'), false);
  assert.equal(serialized.includes('stderr'), false);
  assert.equal(serialized.includes('environment'), false);
  assert.equal(serialized.includes('secret'), false);
});

test('rejects inconsistent outcomes, stages, counts, paths, and unknown fields', (t) => {
  const { input } = fullSuccessInput(t, 'validation');
  const baseline = createTerminalResult(input, { clock: () => FIXED_TIME });
  const mutations = [
    (value) => { value.outcome = 'unknown'; },
    (value) => { value.lifecycle.failedStage = 'unknown'; },
    (value) => { value.process.outcome = 'failed'; },
    (value) => { value.execution.attempted = false; },
    (value) => { value.execution.counts.failed = -1; },
    (value) => { value.execution.counts.total = 2; },
    (value) => { value.artifacts.manifestRelativePath = '../artifact-manifest.json'; },
    (value) => { value.rawStdout = 'private'; },
  ];
  for (const mutate of mutations) {
    const invalid = mutable(baseline);
    mutate(invalid);
    assert.ok(validateTerminalResult(invalid).length > 0);
  }
});

test('writes parseable atomic JSON repeatedly and isolates run paths', (t) => {
  const first = fullSuccessInput(t, 'write-a');
  const second = fullSuccessInput(t, 'write-b');
  writeTerminalResult(first.input, { clock: () => FIXED_TIME });
  writeTerminalResult(first.input, { clock: () => FIXED_TIME });
  const contents = fs.readFileSync(first.workspace.paths.terminalResult, 'utf8');

  assert.equal(contents.endsWith('\n'), true);
  assert.deepEqual(validateTerminalResult(JSON.parse(contents)), []);
  assert.equal(fs.existsSync(`${first.workspace.paths.terminalResult}.tmp`), false);
  assert.notEqual(first.workspace.paths.terminalResult, second.workspace.paths.terminalResult);
  assert.equal(fs.existsSync(second.workspace.paths.terminalResult), false);
});

test('controller writes terminal results for success, assertion failure, and analysis failure', async (t) => {
  const createControllerRun = (label) => {
    const run = createRun('https://example.test/', { runId: uniqueRunId(label), workspaceRoot: TEST_WORKSPACE_ROOT });
    t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
    return run;
  };

  const analysisFailure = createControllerRun('controller-analysis-failure');
  await analyzeRun(analysisFailure, { runCommandImpl: async () => { throw new Error('analysis stopped'); } });
  assert.equal(analysisFailure.status, 'failed');
  assert.equal(JSON.parse(fs.readFileSync(analysisFailure.workspace.paths.terminalResult)).outcome, 'failed');

  for (const [label, exitCode, expectedOutcome] of [
    ['controller-success', 0, 'succeeded'],
    ['controller-assertion', 1, 'completed-with-test-failures'],
  ]) {
    const run = createControllerRun(label);
    run.status = 'ready_for_execution';
    run.analysis = { summary: { navigationCount: 1 } };
    run.navigationSpec = run.workspace.paths.navigationSpec;
    fs.writeFileSync(run.workspace.paths.navigationPlan, JSON.stringify({
      targetUrl: run.url,
      tests: [{ menuPath: ['Sample Page'], template: 'navigation.urlOnly' }],
    }));
    fs.writeFileSync(run.workspace.paths.analysisReviewJson, '{}\n');
    fs.writeFileSync(run.navigationSpec, '// generated\n');
    await executeRun(run, {
      terminalResultClock: () => FIXED_TIME,
      runCommandImpl: async () => {
        const report = exitCode === 0 ? passedReport() : {
          suites: [{ specs: [{
            title: 'Navigation: Sample Page',
            file: 'generated_from_plan.spec.js',
            tests: [{ status: 'unexpected', results: [{ status: 'failed' }] }],
          }] }],
        };
        fs.writeFileSync(run.workspace.paths.playwrightJsonReport, JSON.stringify(report));
        fs.writeFileSync(run.workspace.paths.playwrightHtmlReportIndex, '<html></html>');
        return { code: exitCode, signal: null, stdout: '', stderr: '' };
      },
    });
    const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));
    const statusSnapshot = JSON.parse(fs.readFileSync(run.workspace.paths.status, 'utf8'));
    assert.equal(run.status, 'completed');
    assert.equal(result.outcome, expectedOutcome);
    assert.equal(Object.hasOwn(publicRun(run), 'terminalResult'), false);
    assert.equal(Object.hasOwn(statusSnapshot, '_terminalContext'), false);
    assert.equal(Object.hasOwn(statusSnapshot, 'terminalResult'), false);
  }
});

test('controller distinguishes Playwright process failure from missing or malformed reporter JSON', async (t) => {
  const readyRun = (label) => {
    const run = createRun('https://example.test/', { runId: uniqueRunId(label), workspaceRoot: TEST_WORKSPACE_ROOT });
    t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
    run.status = 'ready_for_execution';
    run.analysis = { summary: { navigationCount: 1 } };
    run.navigationSpec = run.workspace.paths.navigationSpec;
    fs.writeFileSync(run.workspace.paths.navigationPlan, JSON.stringify({
      targetUrl: run.url,
      tests: [{ menuPath: ['Sample Page'], template: 'navigation.urlOnly' }],
    }));
    fs.writeFileSync(run.workspace.paths.analysisReviewJson, '{}\n');
    fs.writeFileSync(run.navigationSpec, '// generated\n');
    return run;
  };

  const processFailure = readyRun('controller-process-failure');
  await executeRun(processFailure, { runCommandImpl: async () => { throw new Error('launch failed'); } });
  const failedProcessResult = JSON.parse(fs.readFileSync(processFailure.workspace.paths.terminalResult, 'utf8'));
  assert.equal(processFailure.status, 'failed');
  assert.equal(failedProcessResult.process.outcome, 'failed');
  assert.equal(failedProcessResult.execution.assertionOutcome, 'unavailable');
  assert.equal(failedProcessResult.lifecycle.failedStage, 'execution');

  for (const [label, reporterBody] of [
    ['controller-missing-report', null],
    ['controller-malformed-report', '{not-json'],
  ]) {
    const run = readyRun(label);
    await executeRun(run, {
      runCommandImpl: async () => {
        if (reporterBody !== null) fs.writeFileSync(run.workspace.paths.playwrightJsonReport, reporterBody);
        return { code: 0, signal: null, stdout: '', stderr: '' };
      },
    });
    const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));
    assert.equal(run.status, 'failed');
    assert.equal(result.process.outcome, 'succeeded');
    assert.equal(result.execution.assertionOutcome, 'unavailable');
    assert.equal(result.lifecycle.failedStage, 'report');
    assert.equal(result.outcome, 'partially-succeeded');
  }
});

test('controller preserves assertion success while marking missing HTML report as partial', async (t) => {
  const run = createRun('https://example.test/', { runId: uniqueRunId('missing-html'), workspaceRoot: TEST_WORKSPACE_ROOT });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
  run.status = 'ready_for_execution';
  run.analysis = { summary: { navigationCount: 1 } };
  run.navigationSpec = run.workspace.paths.navigationSpec;
  fs.writeFileSync(run.workspace.paths.navigationPlan, JSON.stringify({
    targetUrl: run.url,
    tests: [{ menuPath: ['Sample Page'], template: 'navigation.urlOnly' }],
  }));
  fs.writeFileSync(run.workspace.paths.analysisReviewJson, '{}\n');
  fs.writeFileSync(run.navigationSpec, '// generated\n');
  await executeRun(run, {
    runCommandImpl: async () => {
      fs.writeFileSync(run.workspace.paths.playwrightJsonReport, JSON.stringify(passedReport()));
      return { code: 0, signal: null, stdout: '', stderr: '' };
    },
  });
  const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));
  assert.equal(run.status, 'completed');
  assert.equal(result.outcome, 'partially-succeeded');
  assert.equal(result.process.outcome, 'succeeded');
  assert.equal(result.execution.assertionOutcome, 'passed');
  assert.equal(result.lifecycle.failedStage, 'report');
});

test('controller preserves terminal status when result persistence fails', async (t) => {
  const run = createRun('https://example.test/', { runId: uniqueRunId('write-failure'), workspaceRoot: TEST_WORKSPACE_ROOT });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
  await analyzeRun(run, {
    runCommandImpl: async () => { throw new Error('analysis stopped'); },
    writeTerminalResultImpl: () => { throw new Error('result unavailable'); },
  });

  assert.equal(run.status, 'failed');
  assert.equal(fs.existsSync(run.workspace.paths.status), true);
  assert.equal(fs.existsSync(run.workspace.paths.terminalResult), false);
  assert.equal(Object.hasOwn(publicRun(run), 'terminalResult'), false);
});

test('does not mutate process cwd or environment', (t) => {
  const cwd = process.cwd();
  const environment = { ...process.env };
  const { input } = fullSuccessInput(t, 'globals');
  createTerminalResult(input, { clock: () => FIXED_TIME });
  assert.equal(process.cwd(), cwd);
  assert.deepEqual({ ...process.env }, environment);
});
