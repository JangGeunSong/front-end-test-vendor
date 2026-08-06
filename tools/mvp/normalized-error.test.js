const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ERROR_CATEGORIES,
  ERROR_CODES,
  ERROR_RETRYABILITY,
  NORMALIZED_ERROR_SCHEMA_VERSION,
  classifyError,
  createNormalizedError,
  validateNormalizedError,
  writeNormalizedError,
} = require('./normalized-error');
const {
  analyzeRun,
  approveRun,
  createRun,
  executeRun,
  friendlyError,
  getRun,
  publicRun,
} = require('./controller');
const { createRunWorkspace, ensureRunWorkspace } = require('./run-workspace');
const { validateTerminalResult } = require('./terminal-result');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const TEST_WORKSPACE_ROOT = path.join(
  REPOSITORY_ROOT,
  'tools',
  'ai-generator',
  'generated',
  'normalized-error-tests',
);
const FIXED_TIME = new Date('2026-08-06T01:00:00.000Z');

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

function normalizedInput(workspace, overrides = {}) {
  return {
    runId: workspace.runId,
    stage: 'analysis',
    source: 'analysis-orchestrator',
    operation: 'run-analysis',
    cause: new Error('analysis failed at C:\\private\\workspace with token=private-value'),
    ...overrides,
  };
}

function passedReport(status = 'expected') {
  return {
    suites: [{ specs: [{
      title: 'Navigation: Sample Page',
      file: 'generated_from_plan.spec.js',
      tests: [{ status, results: [{ status: status === 'expected' ? 'passed' : 'failed' }] }],
    }] }],
  };
}

function readyRun(t, label) {
  const run = createRun('https://example.test/', {
    runId: uniqueRunId(label),
    workspaceRoot: TEST_WORKSPACE_ROOT,
  });
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
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

test('classifies invalid input without copying the target URL or credentials', (t) => {
  const workspace = workspaceFor(t, 'invalid-input');
  const value = createNormalizedError(normalizedInput(workspace, {
    stage: 'created',
    source: 'request',
    operation: 'validate-target',
    cause: new Error('URL validation failed: https://user:secret@example.test/private?token=value'),
  }), { clock: () => FIXED_TIME });

  assert.equal(value.schemaVersion, NORMALIZED_ERROR_SCHEMA_VERSION);
  assert.equal(value.category, 'user');
  assert.equal(value.code, ERROR_CODES.INVALID_TARGET_URL);
  assert.equal(value.retryability, 'never');
  assert.equal(JSON.stringify(value).includes('example.test'), false);
  assert.equal(JSON.stringify(value).includes('secret'), false);

  const invalidBody = createNormalizedError(normalizedInput(workspace, {
    stage: 'created', source: 'request', operation: 'validate-request',
    cause: new Error('Request body contains private data'),
  }), { clock: () => FIXED_TIME });
  assert.equal(invalidBody.code, ERROR_CODES.INVALID_REQUEST);
  assert.equal(invalidBody.retryability, 'never');
  assert.equal(JSON.stringify(invalidBody).includes('private data'), false);
});

test('covers workspace, target, engine-contract, infrastructure, and internal categories', (t) => {
  const workspace = workspaceFor(t, 'categories');
  const cases = [
    [{ stage: 'created', source: 'workspace', operation: 'provision-workspace' }, 'infrastructure', ERROR_CODES.WORKSPACE_PROVISION_FAILED],
    [{ stage: 'analysis', source: 'analysis-orchestrator', operation: 'run-analysis', invocationResult: { stderr: 'page.goto: net::ERR_NAME_NOT_RESOLVED' } }, 'target', ERROR_CODES.TARGET_UNAVAILABLE],
    [{ stage: 'analysis', source: 'analysis-orchestrator', operation: 'run-analysis', cause: new Error('pipeline stopped') }, 'engine-contract', ERROR_CODES.ANALYSIS_FAILED],
    [{ stage: 'analysis', source: 'engine-process', operation: 'spawn-process', cause: Object.assign(new Error('access denied'), { code: 'EACCES' }), spawnError: true }, 'infrastructure', ERROR_CODES.PROCESS_SPAWN_FAILED],
    [{ stage: 'created', source: 'controller', operation: 'finalize-run', cause: new Error('unexpected') }, 'internal', ERROR_CODES.INTERNAL_UNEXPECTED],
  ];
  for (const [overrides, category, code] of cases) {
    const value = createNormalizedError(normalizedInput(workspace, overrides), { clock: () => FIXED_TIME });
    assert.equal(value.category, category);
    assert.equal(value.code, code);
  }
  assert.deepEqual([...ERROR_CATEGORIES], ['user', 'target', 'engine-contract', 'infrastructure', 'internal']);
  assert.deepEqual([...ERROR_RETRYABILITY], ['never', 'conditional', 'unknown']);
});

test('classifies browser and Python dependency signals without retaining stderr', (t) => {
  const workspace = workspaceFor(t, 'dependencies');
  const browser = createNormalizedError(normalizedInput(workspace, {
    stage: 'execution',
    source: 'playwright',
    operation: 'execute-tests',
    invocationResult: { stderr: "browserType.launch: Executable doesn't exist at C:\\private\\chromium.exe" },
  }), { clock: () => FIXED_TIME });
  const python = createNormalizedError(normalizedInput(workspace, {
    invocationResult: { stderr: "ModuleNotFoundError: No module named 'private_module'" },
  }), { clock: () => FIXED_TIME });

  assert.equal(browser.code, ERROR_CODES.DEPENDENCY_BROWSER_UNAVAILABLE);
  assert.equal(python.code, ERROR_CODES.DEPENDENCY_PYTHON_UNAVAILABLE);
  assert.equal(JSON.stringify(browser).includes('chromium.exe'), false);
  assert.equal(JSON.stringify(python).includes('private_module'), false);
  assert.match(friendlyError('Playwright execution', {
    result: { stderr: "browserType.launch: Executable doesn't exist", stdout: '' },
  }), /playwright install chromium/);
});

test('distinguishes spawn, signaled, and stage-specific non-zero process failures', (t) => {
  const workspace = workspaceFor(t, 'process');
  const executable = createNormalizedError(normalizedInput(workspace, {
    source: 'engine-process',
    operation: 'spawn-process',
    cause: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
  }), { clock: () => FIXED_TIME });
  const signaled = createNormalizedError(normalizedInput(workspace, {
    invocationResult: { code: null, signal: 'SIGTERM' },
  }), { clock: () => FIXED_TIME });
  const nonzero = createNormalizedError(normalizedInput(workspace, {
    invocationResult: { code: 2, signal: null },
  }), { clock: () => FIXED_TIME });

  assert.equal(executable.code, ERROR_CODES.DEPENDENCY_EXECUTABLE_UNAVAILABLE);
  assert.equal(signaled.code, ERROR_CODES.PROCESS_TERMINATED);
  assert.equal(signaled.diagnostic.signaled, true);
  assert.equal(nonzero.code, ERROR_CODES.ANALYSIS_FAILED);
  assert.equal(nonzero.diagnostic.processExitCode, 2);
});

test('classifies deadline expiry with bounded termination diagnostics', (t) => {
  const workspace = workspaceFor(t, 'timeout');
  const value = createNormalizedError(normalizedInput(workspace, {
    stage: 'execution',
    source: 'playwright',
    operation: 'execute-tests',
    invocationResult: {
      timedOut: true,
      timeoutMs: 1200,
      signal: 'SIGTERM',
      stdout: 'private target output',
      stderr: 'private engine output',
      termination: { requested: true, forced: true, method: 'windows-taskkill' },
    },
  }), { clock: () => FIXED_TIME });

  assert.equal(value.code, ERROR_CODES.ENGINE_DEADLINE_EXCEEDED);
  assert.equal(value.category, 'infrastructure');
  assert.equal(value.retryability, 'conditional');
  assert.equal(value.userMessage, 'The engine invocation exceeded its allowed execution time.');
  assert.equal(value.diagnostic.timeoutMs, 1200);
  assert.equal(value.diagnostic.forcedTermination, true);
  assert.equal(value.diagnostic.terminationMethod, 'windows-taskkill');
  assert.equal(JSON.stringify(value).includes('private'), false);

  const invalid = mutable(value);
  invalid.diagnostic.timeoutMs = 0;
  assert.ok(validateNormalizedError(invalid).length > 0);
  const wrongMethod = mutable(value);
  wrongMethod.diagnostic.terminationMethod = 'shell-command';
  assert.ok(validateNormalizedError(wrongMethod).length > 0);
});

test('classifies report missing and malformed without retaining paths or JSON', (t) => {
  const workspace = workspaceFor(t, 'reports');
  const missing = createNormalizedError(normalizedInput(workspace, {
    stage: 'report', source: 'report', operation: 'read-report', reportStatus: 'missing',
    cause: Object.assign(new Error('ENOENT C:\\private\\report.json'), { code: 'ENOENT' }),
  }), { clock: () => FIXED_TIME });
  const malformed = createNormalizedError(normalizedInput(workspace, {
    stage: 'report', source: 'report', operation: 'read-report', reportStatus: 'malformed',
    cause: new SyntaxError('{private-json'),
  }), { clock: () => FIXED_TIME });

  assert.equal(missing.code, ERROR_CODES.REPORT_MISSING);
  assert.equal(malformed.code, ERROR_CODES.REPORT_INVALID);
  assert.equal(JSON.stringify([missing, malformed]).includes('private'), false);
});

test('classifies approval, reconciliation, plan, and renderer failures by lifecycle stage', (t) => {
  const workspace = workspaceFor(t, 'pipeline');
  const cases = [
    [{ stage: 'approval', source: 'approval', operation: 'validate-approval' }, ERROR_CODES.APPROVAL_INVALID],
    [{ stage: 'reconciliation', source: 'approval', operation: 'reconcile-approval' }, ERROR_CODES.RECONCILIATION_FAILED],
    [{ stage: 'plan', source: 'plan', operation: 'build-plan' }, ERROR_CODES.PLAN_BUILD_FAILED],
    [{ stage: 'plan', source: 'plan', operation: 'render-spec' }, ERROR_CODES.SPEC_RENDER_FAILED],
  ];
  for (const [overrides, expected] of cases) {
    const value = createNormalizedError(normalizedInput(workspace, { ...overrides, cause: new Error('failed') }), { clock: () => FIXED_TIME });
    assert.equal(value.code, expected);
  }
});

test('validator rejects unknown pairs, retryability, stage, raw fields, unsafe messages, and timestamps', (t) => {
  const workspace = workspaceFor(t, 'validation');
  const baseline = createNormalizedError(normalizedInput(workspace), { clock: () => FIXED_TIME });
  const mutations = [
    (value) => { value.category = 'unknown'; },
    (value) => { value.category = 'internal'; },
    (value) => { value.code = 'UNKNOWN_CODE'; },
    (value) => { value.retryability = 'likely'; },
    (value) => { value.stage = 'unknown'; },
    (value) => { value.userMessage = 'Failure at C:\\private\\file.txt'; },
    (value) => { value.occurredAt = 'not-a-date'; },
    (value) => { value.diagnostic.stderr = 'private'; },
    (value) => { value.stack = 'private stack'; },
  ];
  for (const mutate of mutations) {
    const invalid = mutable(baseline);
    mutate(invalid);
    assert.ok(validateNormalizedError(invalid).length > 0);
  }
});

test('writes stable atomic JSON, overwrites idempotently, and isolates runs', (t) => {
  const first = workspaceFor(t, 'write-a');
  const second = workspaceFor(t, 'write-b');
  const value = createNormalizedError(normalizedInput(first), { clock: () => FIXED_TIME });
  writeNormalizedError({ workspace: first, normalizedError: value });
  writeNormalizedError({ workspace: first, normalizedError: value });
  const contents = fs.readFileSync(first.paths.normalizedError, 'utf8');

  assert.equal(contents.endsWith('\n'), true);
  assert.deepEqual(validateNormalizedError(JSON.parse(contents)), []);
  assert.equal(fs.existsSync(`${first.paths.normalizedError}.tmp`), false);
  assert.notEqual(first.paths.normalizedError, second.paths.normalizedError);
  assert.equal(fs.existsSync(second.paths.normalizedError), false);
});

test('atomic write failure removes its temporary file without touching another run', (t) => {
  const first = workspaceFor(t, 'atomic-failure-a');
  const second = workspaceFor(t, 'atomic-failure-b');
  const value = createNormalizedError(normalizedInput(first), { clock: () => FIXED_TIME });
  fs.writeFileSync(second.paths.status, 'preserved\n');
  const fsImpl = {
    writeFileSync: fs.writeFileSync.bind(fs),
    renameSync: () => { throw new Error('rename unavailable'); },
    existsSync: fs.existsSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
  };

  assert.throws(() => writeNormalizedError({ workspace: first, normalizedError: value }, { fsImpl }), /Unable to write/);
  assert.equal(fs.existsSync(`${first.paths.normalizedError}.tmp`), false);
  assert.equal(fs.readFileSync(second.paths.status, 'utf8'), 'preserved\n');
});

test('normalized errors contain only allowlisted diagnostics and no private process data', (t) => {
  const workspace = workspaceFor(t, 'privacy');
  const value = createNormalizedError(normalizedInput(workspace, {
    invocationResult: {
      code: 7,
      signal: null,
      stdout: 'secret stdout',
      stderr: 'secret stderr at C:\\private\\file',
      command: 'private command',
      args: ['--token', 'private'],
      env: { API_KEY: 'private' },
    },
  }), { clock: () => FIXED_TIME });
  const serialized = JSON.stringify(value);

  assert.deepEqual(Object.keys(value.diagnostic), [
    'source', 'operation', 'processExitCode', 'signaled', 'artifactId', 'manifestStatus', 'reportStatus',
    'timeoutMs', 'forcedTermination', 'terminationMethod',
  ]);
  for (const forbidden of ['stdout', 'stderr', 'command', 'args', 'API_KEY', REPOSITORY_ROOT, 'secret']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(/[A-Za-z]:\\/.test(serialized), false);
});

test('controller persists an analysis primary error and references it from terminal result', async (t) => {
  const run = createRun('https://example.test/', { runId: uniqueRunId('controller-analysis'), workspaceRoot: TEST_WORKSPACE_ROOT });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
  await analyzeRun(run, {
    normalizedErrorClock: () => FIXED_TIME,
    runCommandImpl: async () => { throw new Error('private analysis detail'); },
  });

  const error = JSON.parse(fs.readFileSync(run.workspace.paths.normalizedError, 'utf8'));
  const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));
  const status = JSON.parse(fs.readFileSync(run.workspace.paths.status, 'utf8'));
  assert.equal(error.code, ERROR_CODES.ANALYSIS_FAILED);
  assert.equal(error.stage, 'analysis');
  assert.equal(result.errorReference.status, 'present');
  assert.equal(result.errorReference.code, error.code);
  assert.equal(result.hasError, true);
  assert.deepEqual(validateTerminalResult(result), []);
  assert.equal(Object.hasOwn(status, '_terminalContext'), false);
  assert.equal(Object.hasOwn(publicRun(run), 'normalizedError'), false);

  const mutations = [
    (value) => { value.errorReference.code = 'UNKNOWN_CODE'; },
    (value) => { value.errorReference.category = 'internal'; },
    (value) => { value.errorReference.stage = 'report'; },
    (value) => { value.errorReference.relativePath = '../normalized-error.json'; },
    (value) => { value.hasError = false; },
    (value) => { value.outcome = 'succeeded'; },
  ];
  for (const mutate of mutations) {
    const invalid = mutable(result);
    mutate(invalid);
    assert.ok(validateTerminalResult(invalid).length > 0);
  }
});

test('controller persists an execution process failure separately from assertions', async (t) => {
  const run = readyRun(t, 'controller-process');
  await executeRun(run, {
    normalizedErrorClock: () => FIXED_TIME,
    runCommandImpl: async () => { throw new Error('browser process did not start'); },
  });
  const error = JSON.parse(fs.readFileSync(run.workspace.paths.normalizedError, 'utf8'));
  const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));

  assert.equal(run.status, 'failed');
  assert.equal(error.code, ERROR_CODES.EXECUTION_PROCESS_FAILED);
  assert.equal(error.stage, 'execution');
  assert.equal(result.process.outcome, 'failed');
  assert.equal(result.execution.assertionOutcome, 'unavailable');
  assert.equal(result.errorReference.status, 'present');
});

test('controller keeps execution as primary when non-zero or signaled Playwright has no report', async (t) => {
  for (const [label, invocation, expectedCode] of [
    ['nonzero-no-report', { code: 2, signal: null }, ERROR_CODES.EXECUTION_PROCESS_FAILED],
    ['signaled-no-report', { code: null, signal: 'SIGTERM' }, ERROR_CODES.PROCESS_TERMINATED],
  ]) {
    const run = readyRun(t, `controller-${label}`);
    await executeRun(run, {
      runCommandImpl: async () => ({ ...invocation, stdout: '', stderr: '' }),
    });
    const error = JSON.parse(fs.readFileSync(run.workspace.paths.normalizedError, 'utf8'));
    const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));

    assert.equal(run.status, 'failed');
    assert.equal(error.code, expectedCode);
    assert.equal(error.stage, 'execution');
    assert.equal(result.lifecycle.failedStage, 'execution');
    assert.equal(result.execution.assertionOutcome, 'unavailable');
    assert.equal(result.errorReference.status, 'present');
  }
});

test('controller does not create an infrastructure error for assertion failures', async (t) => {
  const run = readyRun(t, 'controller-assertion');
  await executeRun(run, {
    runCommandImpl: async () => {
      fs.writeFileSync(run.workspace.paths.playwrightJsonReport, JSON.stringify(passedReport('unexpected')));
      fs.writeFileSync(run.workspace.paths.playwrightHtmlReportIndex, '<html></html>');
      return { code: 1, signal: null, stdout: '', stderr: '' };
    },
  });
  const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));

  assert.equal(result.outcome, 'completed-with-test-failures');
  assert.equal(result.process.outcome, 'succeeded');
  assert.equal(result.hasError, false);
  assert.equal(result.errorReference.status, 'none');
  assert.equal(fs.existsSync(run.workspace.paths.normalizedError), false);
});

test('controller classifies missing and malformed Playwright JSON as report failures', async (t) => {
  for (const [label, body, code] of [
    ['missing', null, ERROR_CODES.REPORT_MISSING],
    ['malformed', '{not-json', ERROR_CODES.REPORT_INVALID],
  ]) {
    const run = readyRun(t, `controller-report-${label}`);
    await executeRun(run, {
      runCommandImpl: async () => {
        if (body !== null) fs.writeFileSync(run.workspace.paths.playwrightJsonReport, body);
        return { code: 0, signal: null, stdout: '', stderr: '' };
      },
    });
    const error = JSON.parse(fs.readFileSync(run.workspace.paths.normalizedError, 'utf8'));
    const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));
    assert.equal(error.code, code);
    assert.equal(error.stage, 'report');
    assert.equal(result.errorReference.code, code);
  }
});

test('controller retains a plan failedStage when rendered interaction input is malformed', async (t) => {
  const run = readyRun(t, 'controller-malformed-interaction-plan');
  run.approvedCandidateKeys = ['candidate-key'];
  run.approvalPath = run.workspace.paths.interactionApprovals;
  await executeRun(run, {
    runCommandImpl: async (_run, label) => {
      if (label === 'interaction plan build') fs.writeFileSync(run.workspace.paths.interactionPlan, '{not-json');
      if (label === 'interaction spec render') fs.writeFileSync(run.workspace.paths.interactionSpec, '// generated\n');
      return { code: 0, signal: null, stdout: '', stderr: '' };
    },
  });
  const error = JSON.parse(fs.readFileSync(run.workspace.paths.normalizedError, 'utf8'));
  const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));

  assert.equal(run.status, 'failed');
  assert.equal(error.code, ERROR_CODES.SPEC_RENDER_FAILED);
  assert.equal(error.stage, 'plan');
  assert.equal(result.lifecycle.failedStage, 'plan');
  assert.equal(result.errorReference.status, 'present');
});

test('normalized-error write failure remains secondary and preserves Local terminal status', async (t) => {
  const run = createRun('https://example.test/', { runId: uniqueRunId('write-failure'), workspaceRoot: TEST_WORKSPACE_ROOT });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
  await analyzeRun(run, {
    runCommandImpl: async () => { throw new Error('analysis stopped'); },
    writeNormalizedErrorImpl: () => { throw new Error('write unavailable'); },
  });
  const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));

  assert.equal(run.status, 'failed');
  assert.equal(fs.existsSync(run.workspace.paths.normalizedError), false);
  assert.equal(result.hasError, true);
  assert.equal(result.errorReference.status, 'unavailable');
  assert.equal(result.errorReference.code, ERROR_CODES.ANALYSIS_FAILED);
});

test('manifest refresh failure remains secondary to the primary normalized error', async (t) => {
  const run = createRun('https://example.test/', {
    runId: uniqueRunId('manifest-secondary'),
    workspaceRoot: TEST_WORKSPACE_ROOT,
  });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
  await analyzeRun(run, {
    runCommandImpl: async () => { throw new Error('analysis stopped'); },
    writeArtifactManifestImpl: () => { throw new Error('manifest unavailable'); },
  });
  const error = JSON.parse(fs.readFileSync(run.workspace.paths.normalizedError, 'utf8'));
  const result = JSON.parse(fs.readFileSync(run.workspace.paths.terminalResult, 'utf8'));

  assert.equal(error.code, ERROR_CODES.ANALYSIS_FAILED);
  assert.equal(result.errorReference.status, 'present');
  assert.equal(result.artifacts.manifestStatus, 'invalid');
  assert.equal(run.debugLog.some((entry) => entry.label === 'artifact manifest'), true);
});

test('approval failure keeps the current non-terminal lifecycle and creates no primary error artifact', async (t) => {
  const run = createRun('https://example.test/', {
    runId: uniqueRunId('approval-nonterminal'),
    workspaceRoot: TEST_WORKSPACE_ROOT,
  });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
  run.status = 'ready_for_execution';
  run.analysisReport = run.workspace.paths.analysisReviewJson;
  run.analysis = {
    interactions: [{ candidateKey: 'candidate-key', executionEligible: true }],
  };
  await assert.rejects(() => approveRun(
    run,
    [],
    'local-ui-user',
    '',
  ), /Select at least one/);
  assert.equal(run.status, 'ready_for_execution');
  assert.equal(fs.existsSync(run.workspace.paths.normalizedError), false);
  assert.equal(fs.existsSync(run.workspace.paths.terminalResult), false);
});

test('workspace provisioning failure has a stable boundary without registering the run', (t) => {
  const runId = uniqueRunId('workspace-failure');
  const classification = classifyError({
    stage: 'created', source: 'workspace', operation: 'provision-workspace', cause: new Error('private path'),
  });
  assert.equal(classification.code, ERROR_CODES.WORKSPACE_PROVISION_FAILED);
  assert.throws(() => createRun('https://example.test/', {
    runId,
    workspaceRoot: TEST_WORKSPACE_ROOT,
    ensureWorkspace: () => { throw new Error('workspace unavailable'); },
  }), /workspace unavailable/);
  assert.throws(() => getRun(runId), /not found/);
});

test('classification and persistence do not mutate cwd or environment', (t) => {
  const cwd = process.cwd();
  const environment = { ...process.env };
  const workspace = workspaceFor(t, 'globals');
  const value = createNormalizedError(normalizedInput(workspace), { clock: () => FIXED_TIME });
  writeNormalizedError({ workspace, normalizedError: value });
  assert.equal(process.cwd(), cwd);
  assert.deepEqual({ ...process.env }, environment);
});
