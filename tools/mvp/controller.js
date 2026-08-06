const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_TERMINATION_GRACE_MS,
  MAX_INVOCATION_TIMEOUT_MS,
  MAX_TERMINATION_GRACE_MS,
  createEngineInvocationRequest,
  invokeEngineProcess,
} = require('./engine-invocation');
const {
  createRunWorkspace,
  ensureRunWorkspace,
} = require('./run-workspace');
const { writeArtifactManifest } = require('./artifact-manifest');
const {
  projectLifecycleStage,
  summarizePlaywrightAssertions,
  writeTerminalResult,
} = require('./terminal-result');
const {
  ERROR_CODES,
  classifyError,
  createNormalizedError,
  writeNormalizedError,
} = require('./normalized-error');

const ROOT = path.resolve(__dirname, '..', '..');
const PYTHON = process.env.MVP_PYTHON || path.join(ROOT, '.venv', 'Scripts', 'python.exe');
const PLAYWRIGHT = process.execPath;
const PLAYWRIGHT_CLI = require.resolve('@playwright/test/cli');
const STAGES = [
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
const NO_APPROVED_INTERACTIONS = 'no-approved-supported-interactions';
const DEFAULT_ENGINE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30 * 60 * 1000;

const runs = new Map();
let operationQueue = Promise.resolve();

function enqueue(operation) {
  const next = operationQueue.then(operation, operation);
  operationQueue = next.catch(() => {});
  return next;
}

function validateTargetUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('URL validation failed: enter an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('URL validation failed: only credential-free HTTP(S) URLs are supported.');
  }
  return parsed.href;
}

function generateRunId() {
  return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function createRun(url, options = {}) {
  const id = options.runId || generateRunId();
  const workspace = createRunWorkspace({
    repositoryRoot: ROOT,
    runId: id,
    workspaceRoot: options.workspaceRoot,
  });
  (options.ensureWorkspace || ensureRunWorkspace)(workspace);
  const run = {
    id,
    url,
    workspace,
    dir: workspace.root,
    specDir: workspace.specDir,
    status: 'created',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: Object.fromEntries(STAGES.map((name) => [name, { status: 'pending' }])),
    debugLog: [],
  };
  runs.set(id, run);
  persist(run);
  refreshArtifactManifest(run, options);
  return run;
}

function persist(run) {
  run.updatedAt = new Date().toISOString();
  const serializable = { ...run };
  delete serializable.workspace;
  delete serializable.dir;
  delete serializable.specDir;
  delete serializable._terminalContext;
  fs.writeFileSync(run.workspace.paths.status, `${JSON.stringify(serializable, null, 2)}\n`, 'utf8');
}

function stage(run, name, status, detail) {
  run.stages[name] = { status, ...(detail ? { detail } : {}) };
  persist(run);
}

function appendLog(run, label, output) {
  if (!output) return;
  run.debugLog.push({ label, output: output.slice(-12000) });
  run.debugLog = run.debugLog.slice(-20);
}

function parseTimeoutSetting(value, fallback, label, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}.`);
  }
  return parsed;
}

function resolveTimeoutPolicy(environment = process.env) {
  return Object.freeze({
    engineTimeoutMs: parseTimeoutSetting(
      environment.MVP_ENGINE_TIMEOUT_MS,
      DEFAULT_ENGINE_TIMEOUT_MS,
      'MVP_ENGINE_TIMEOUT_MS',
      MAX_INVOCATION_TIMEOUT_MS,
    ),
    executionTimeoutMs: parseTimeoutSetting(
      environment.MVP_EXECUTION_TIMEOUT_MS,
      DEFAULT_EXECUTION_TIMEOUT_MS,
      'MVP_EXECUTION_TIMEOUT_MS',
      MAX_INVOCATION_TIMEOUT_MS,
    ),
    terminationGraceMs: parseTimeoutSetting(
      environment.MVP_TERMINATION_GRACE_MS,
      DEFAULT_TERMINATION_GRACE_MS,
      'MVP_TERMINATION_GRACE_MS',
      MAX_TERMINATION_GRACE_MS,
    ),
  });
}

function refreshArtifactManifest(run, dependencies = {}) {
  try {
    (dependencies.writeArtifactManifestImpl || writeArtifactManifest)(run.workspace);
    return true;
  } catch {
    appendLog(run, 'artifact manifest', 'Artifact manifest refresh failed.');
    return false;
  }
}

function recordProcessOutcome(run, outcome) {
  run._terminalContext ||= {};
  run._terminalContext.process = {
    attempted: outcome.attempted === true,
    outcome: outcome.outcome,
    exitCode: Number.isInteger(outcome.exitCode) ? outcome.exitCode : null,
    signaled: typeof outcome.signaled === 'boolean' ? outcome.signaled : null,
    timedOut: outcome.timedOut === true,
    timeoutMs: Number.isSafeInteger(outcome.timeoutMs) && outcome.timeoutMs > 0 ? outcome.timeoutMs : null,
    termination: {
      forced: outcome.termination?.forced === true,
      method: typeof outcome.termination?.method === 'string' ? outcome.termination.method : null,
    },
  };
}

function errorContextForStage(stageName, error) {
  const context = ({
    'Target validation': { source: 'request', operation: 'validate-target' },
    'Website analysis': { source: 'analysis-orchestrator', operation: 'run-analysis' },
    'Page test plan generation': { source: 'analysis-orchestrator', operation: 'run-analysis' },
    'Interaction discovery': { source: 'analysis-orchestrator', operation: 'build-review' },
    'Interaction approval validation': { source: 'approval', operation: 'validate-approval' },
    'Interaction reconciliation': { source: 'approval', operation: 'reconcile-approval' },
    'Interaction plan generation': { source: 'plan', operation: 'build-plan' },
    'Interaction spec rendering': { source: 'plan', operation: 'render-spec' },
    'Playwright execution': { source: 'playwright', operation: 'execute-tests' },
    'Interaction execution': { source: 'playwright', operation: 'execute-tests' },
    'Report preparation': { source: 'report', operation: 'read-report' },
  })[stageName] || { source: 'controller', operation: 'finalize-run' };
  const reportStatus = stageName === 'Report preparation'
    ? (error?.code === 'ENOENT' ? 'missing' : (error instanceof SyntaxError ? 'malformed' : 'unavailable'))
    : null;
  return {
    stage: projectLifecycleStage(stageName) || 'created',
    source: context.source,
    operation: context.operation,
    cause: error,
    invocationResult: error?.result,
    ...(reportStatus ? { reportStatus } : {}),
  };
}

function recordPrimaryError(run, stageName, error, options = {}) {
  run._terminalContext ||= {};
  const context = errorContextForStage(stageName, error);
  if (options.preferRecordedProcess && run._terminalContext.process?.outcome === 'failed') {
    context.cause = undefined;
    context.invocationResult = {
      code: run._terminalContext.process.exitCode,
      signal: run._terminalContext.process.signaled ? 'terminated' : null,
      timedOut: run._terminalContext.process.timedOut,
      timeoutMs: run._terminalContext.process.timeoutMs,
      termination: run._terminalContext.process.termination,
    };
    context.signaled = run._terminalContext.process.signaled === true;
  }
  run._terminalContext.primaryErrorInput = context;
}

function finalizeTerminalRun(run, dependencies = {}) {
  refreshArtifactManifest(run, dependencies);
  let normalizedError = null;
  let normalizedErrorPersisted = false;
  if (run.error) {
    try {
      normalizedError = (dependencies.createNormalizedErrorImpl || createNormalizedError)({
        runId: run.id,
        ...(run._terminalContext?.primaryErrorInput || {
          stage: Object.entries(run.stages)
            .map(([name, value]) => value.status === 'failed' ? projectLifecycleStage(name) : null)
            .find(Boolean) || 'created',
          source: 'controller',
          operation: 'finalize-run',
        }),
      }, { clock: dependencies.normalizedErrorClock });
      (dependencies.writeNormalizedErrorImpl || writeNormalizedError)({
        workspace: run.workspace,
        normalizedError,
      }, { fsImpl: dependencies.normalizedErrorFs });
      normalizedErrorPersisted = true;
    } catch {
      appendLog(run, 'normalized error', 'Normalized error write failed.');
    }
  }
  try {
    (dependencies.writeTerminalResultImpl || writeTerminalResult)({
      run,
      workspace: run.workspace,
      process: run._terminalContext?.process,
      execution: {
        attempted: run._terminalContext?.executionAttempted === true,
        assertions: run._terminalContext?.assertions,
      },
      normalizedError,
      normalizedErrorPersisted,
    }, {
      clock: dependencies.terminalResultClock,
      fsImpl: dependencies.terminalResultFs,
    });
    return true;
  } catch {
    appendLog(run, 'terminal result', 'Normalized terminal result write failed.');
    return false;
  }
}

async function runCommand(run, label, executable, args, options = {}, dependencies = {}) {
  const timeoutPolicy = dependencies.timeoutPolicy || resolveTimeoutPolicy(dependencies.timeoutEnvironment);
  const timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : (label === 'Playwright execution'
    ? timeoutPolicy.executionTimeoutMs
    : timeoutPolicy.engineTimeoutMs);
  const terminationGraceMs = options.terminationGraceMs !== undefined
    ? options.terminationGraceMs
    : timeoutPolicy.terminationGraceMs;
  recordProcessOutcome(run, { attempted: true, outcome: 'failed', exitCode: null, signaled: null, timedOut: false });
  const request = createEngineInvocationRequest({
    command: executable,
    args,
    cwd: ROOT,
    env: {
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      ...(options.env || {}),
    },
    timeoutMs,
    terminationGraceMs,
  }, dependencies);
  const invocation = await (dependencies.invokeEngineProcessImpl || invokeEngineProcess)(
    request,
    dependencies.invocationDependencies,
  );
  if (invocation.spawnError) {
    recordProcessOutcome(run, { attempted: true, outcome: 'failed', exitCode: null, signaled: false, timedOut: false });
    throw invocation.spawnError;
  }
  recordProcessOutcome(run, {
    attempted: true,
    outcome: invocation.exitCode === 0 && !invocation.signal ? 'succeeded' : 'failed',
    exitCode: invocation.exitCode,
    signaled: Boolean(invocation.signal),
    timedOut: invocation.timedOut === true,
    timeoutMs: invocation.timeoutMs,
    termination: invocation.termination,
  });
  appendLog(run, label, [invocation.stdout, invocation.stderr].filter(Boolean).join('\n'));
  persist(run);
  const result = {
    code: invocation.exitCode,
    signal: invocation.signal,
    stdout: invocation.stdout,
    stderr: invocation.stderr,
    ...(invocation.timedOut === true ? {
      timedOut: true,
      timeoutMs: invocation.timeoutMs,
      termination: invocation.termination,
    } : {}),
  };
  if (invocation.timedOut) throw Object.assign(new Error(`${label} timed out`), { result });
  if (invocation.exitCode === 0 || options.allowFailure) return result;
  throw Object.assign(new Error(`${label} failed`), { result });
}

function normalizeAnalysis(report, plan) {
  const identities = new Map(
    (report.pageIdentityAssertions || []).map((item) => [JSON.stringify(item.menuPath || []), item]),
  );
  const navigation = (report.generatedNavigationTests || []).map((test) => {
    const identity = identities.get(JSON.stringify(test.menuPath || [])) || {};
    return {
      id: test.id,
      title: test.title,
      pageContext: (test.menuPath || []).join(' > '),
      navigation: test.href || 'in-page interaction',
      template: test.template,
      identityType: identity.identityType || 'none',
      identitySummary: identity.text || identity.reason || (identity.selector ? 'Collected content container' : 'URL navigation only'),
      executable: test.template !== 'navigation.todoIdentity',
      debug: { ...test, identity },
    };
  });
  const allInteractions = [
    ...(report.safeInteractionCandidates || []),
    ...(report.unsafeActionCandidates || []),
    ...(report.unresolvedCandidates || []).filter((item) => item.candidateKey),
  ];
  const interactions = allInteractions.map((candidate) => {
    const isTab = candidate.interactionKind === 'tab';
    const selected = candidate.ariaAttributes?.selected;
    const eligible = candidate.classification === 'safe' && isTab && selected === 'false' && Boolean(candidate.tabRestore);
    return {
      candidateKey: candidate.candidateKey,
      classification: candidate.classification,
      interactionKind: candidate.interactionKind || candidate.actionKind || 'unknown',
      pageContext: candidate.pageContext || 'Unknown page',
      targetText: candidate.text || '(no text)',
      restoreTargetText: candidate.tabRestore?.target?.text || '',
      expectedTransition: isTab ? 'unselected → selected' : 'not executable in this MVP',
      restore: candidate.tabRestore ? `restore previous selection: ${candidate.tabRestore.target.text || '(no text)'}` : 'unavailable',
      executionEligible: eligible,
      ineligibleReason: eligible ? '' : (candidate.tabRestoreUnavailableReason || (candidate.classification !== 'safe' ? `classification: ${candidate.classification}` : 'tabSelection with exact restore evidence is required')),
      debug: candidate,
    };
  });
  const count = (classification) => interactions.filter((item) => item.classification === classification).length;
  return {
    targetUrl: report.summary?.targetUrl || plan.targetUrl,
    navigation,
    interactions,
    summary: {
      navigationCount: navigation.length,
      interactionCount: interactions.length,
      safe: count('safe'),
      unsafe: count('unsafe'),
      unknown: count('unknown'),
      executionEligible: interactions.filter((item) => item.executionEligible).length,
    },
    artifactVersions: { analysisReviewReport: report.version, navigationPlan: plan.schemaVersion },
  };
}

async function analyzeRun(run, dependencies = {}) {
  const runCommandImpl = dependencies.runCommandImpl
    || ((currentRun, label, executable, args, options = {}) => runCommand(
      currentRun, label, executable, args, options, dependencies,
    ));
  const { paths } = run.workspace;
  run.status = 'analyzing';
  stage(run, 'Target validation', 'success');
  stage(run, 'Website analysis', 'running');
  try {
    await runCommandImpl(run, 'website analysis and navigation plan', PYTHON, [
      'tools/ai-generator/agent_orchestrator.py', '--generation-mode', 'plan', '--url', run.url, '--no-profile-cache',
      '--generated-dir', run.workspace.analysisDir,
      '--navigation-spec-output', paths.navigationSpec,
    ]);
    run.navigationSpec = paths.navigationSpec;
    stage(run, 'Website analysis', 'success');
    stage(run, 'Page test plan generation', 'success');
    stage(run, 'Interaction discovery', 'running');
    run.analysisReport = paths.analysisReviewJson;
    await runCommandImpl(run, 'interaction discovery', PYTHON, [
      'tools/ai-generator/build_analysis_review_report.py',
      '--scout-result', paths.scoutResult,
      '--menu-map', paths.menuMap,
      '--test-plan', paths.navigationPlan,
      '--output', run.analysisReport,
    ]);
    await runCommandImpl(run, 'analysis report rendering', PYTHON, [
      'tools/ai-generator/render_analysis_review_report.py', '--input', run.analysisReport,
      '--output', paths.analysisReviewMarkdown,
    ]);
    const report = JSON.parse(fs.readFileSync(run.analysisReport, 'utf8'));
    const plan = JSON.parse(fs.readFileSync(paths.navigationPlan, 'utf8'));
    run.analysis = normalizeAnalysis(report, plan);
    stage(run, 'Interaction discovery', 'success');
    run.status = 'ready_for_execution';
    persist(run);
  } catch (error) {
    if (!run._terminalContext?.process?.attempted) {
      recordProcessOutcome(run, {
        attempted: true,
        outcome: 'failed',
        exitCode: error?.result?.code,
        signaled: Boolean(error?.result?.signal),
        timedOut: error?.result?.timedOut === true,
        timeoutMs: error?.result?.timeoutMs,
        termination: error?.result?.termination,
      });
    }
    const active = Object.entries(run.stages).find(([, value]) => value.status === 'running');
    if (active) stage(run, active[0], 'failed', friendlyError(active[0], error));
    run.status = 'failed';
    run.error = friendlyError(active?.[0], error);
    recordPrimaryError(run, active?.[0], error);
    persist(run);
  } finally {
    if (run.status === 'failed') finalizeTerminalRun(run, dependencies);
    else refreshArtifactManifest(run, dependencies);
  }
}

function friendlyError(stageName, error) {
  const classification = classifyError(errorContextForStage(stageName, error));
  if (classification.code === ERROR_CODES.DEPENDENCY_EXECUTABLE_UNAVAILABLE) {
    return `Required executable unavailable: ${error?.path || 'unknown executable'}. Create the project venv and install dependencies as described in docs/DEVELOPMENT_ENVIRONMENT.md.`;
  }
  if (classification.code === ERROR_CODES.DEPENDENCY_PYTHON_UNAVAILABLE) {
    return 'Python dependency missing. Run: npm run env:sync';
  }
  if (classification.code === ERROR_CODES.DEPENDENCY_BROWSER_UNAVAILABLE) {
    return 'Playwright Chromium is unavailable. Run: npx playwright install chromium';
  }
  if (classification.code === ERROR_CODES.TARGET_UNAVAILABLE) {
    return 'Target website is unavailable from this network. Check the URL, proxy/firewall policy, and outbound network access.';
  }
  if (classification.code === ERROR_CODES.APPROVAL_EVIDENCE_CHANGED) return 'Evidence changed. Re-analyze and approve the current candidate again.';
  if (classification.code === ERROR_CODES.APPROVAL_CANDIDATE_MISSING) return 'Approved candidate missing. Re-analyze and approve again.';
  const labels = {
    'Website analysis': 'Website analysis failed.',
    'Page test plan generation': 'Page plan generation failed.',
    'Interaction discovery': 'Interaction discovery failed.',
    'Interaction approval validation': 'Approval validation failed.',
    'Interaction reconciliation': 'Reconciliation failed.',
    'Interaction plan generation': 'Interaction plan validation failed.',
    'Interaction spec rendering': 'Interaction spec rendering failed.',
    'Playwright execution': 'Playwright execution failed.',
    'Report preparation': 'HTML report unavailable.',
  };
  return labels[stageName] || error.message || 'Operation failed.';
}

async function approveRun(run, candidateKeys, reviewer, note, dependencies = {}) {
  const runCommandImpl = dependencies.runCommandImpl
    || ((currentRun, label, executable, args, options = {}) => runCommand(
      currentRun, label, executable, args, options, dependencies,
    ));
  if (run.status !== 'ready_for_execution') throw new Error('Run is not ready for interaction approval.');
  const selected = [...new Set(candidateKeys || [])].sort();
  if (selected.length === 0) throw new Error('Select at least one supported interaction to approve.');
  const eligibleKeys = new Set(
    (run.analysis?.interactions || []).filter((item) => item.executionEligible).map((item) => item.candidateKey),
  );
  const unsupported = selected.filter((key) => !eligibleKeys.has(key));
  if (unsupported.length > 0) throw new Error('Only supported, execution-eligible interactions can be approved.');
  try {
    stage(run, 'Interaction approval validation', 'running');
    run.approvalPath = run.workspace.paths.interactionApprovals;
    const args = [
      'tools/ai-generator/write_interaction_approvals.py', '--report', run.analysisReport,
      '--output', run.approvalPath, '--reviewer', reviewer || 'local-ui-user',
    ];
    for (const key of selected) args.push('--candidate-key', key);
    if (note) args.push('--note', note);
    await runCommandImpl(run, 'approval writer', PYTHON, args);
    await runCommandImpl(run, 'approval validator', PYTHON, [
      'tools/ai-generator/validate_interaction_approvals.py', '--input', run.approvalPath,
    ]);
    stage(run, 'Interaction approval validation', 'success');
    run.approvedCandidateKeys = selected;
    run.status = 'approved';
    persist(run);
  } finally {
    refreshArtifactManifest(run, dependencies);
  }
}

function selectExecutionTargets(navigationCount, approvedCandidateKeys = []) {
  const count = Number(navigationCount) || 0;
  if (count <= 0) throw new Error('No Page Navigation tests are available to execute.');
  return {
    navigation: true,
    interaction: approvedCandidateKeys.length > 0,
    interactionSkipReason: approvedCandidateKeys.length > 0 ? null : NO_APPROVED_INTERACTIONS,
  };
}

function validateExecuteRequest(run) {
  if (!['ready_for_execution', 'approved'].includes(run.status)) {
    throw new Error('Run is not ready for execution.');
  }
  selectExecutionTargets(run.analysis?.summary?.navigationCount, run.approvedCandidateKeys || []);
}

function markInteractionSkipped(run, reason = NO_APPROVED_INTERACTIONS) {
  for (const name of [
    'Interaction approval validation',
    'Interaction reconciliation',
    'Interaction plan generation',
    'Interaction spec rendering',
    'Interaction execution',
  ]) {
    stage(run, name, 'skipped', reason);
  }
}

async function executeRun(run, dependencies = {}) {
  const runCommandImpl = dependencies.runCommandImpl
    || ((currentRun, label, executable, args, options = {}) => runCommand(
      currentRun, label, executable, args, options, dependencies,
    ));
  const { paths } = run.workspace;
  if (!['ready_for_execution', 'approved'].includes(run.status)) {
    throw new Error('Run is not ready for execution.');
  }
  const navigationPlan = JSON.parse(fs.readFileSync(paths.navigationPlan, 'utf8'));
  const targets = selectExecutionTargets((navigationPlan.tests || []).length, run.approvedCandidateKeys || []);
  run.status = 'executing';
  const reconciliation = paths.reconciliation;
  const interactionPlan = paths.interactionPlan;
  let interaction = null;
  try {
    if (targets.interaction) {
      stage(run, 'Interaction reconciliation', 'running');
      await runCommandImpl(run, 'approval reconciliation', PYTHON, [
        'tools/ai-generator/reconcile_interaction_approvals.py', '--report', run.analysisReport,
        '--approvals', run.approvalPath, '--output', reconciliation,
      ]);
      stage(run, 'Interaction reconciliation', 'success');
      stage(run, 'Interaction plan generation', 'running');
      await runCommandImpl(run, 'interaction plan build', PYTHON, [
        'tools/ai-generator/build_interaction_plan.py', '--reconciliation', reconciliation,
        '--report', run.analysisReport, '--output', interactionPlan,
      ]);
      await runCommandImpl(run, 'interaction plan validation', PYTHON, [
        'tools/ai-generator/validate_interaction_plan.py', '--input', interactionPlan,
        '--reconciliation', reconciliation, '--report', run.analysisReport,
      ]);
      stage(run, 'Interaction plan generation', 'success');
      stage(run, 'Interaction spec rendering', 'running');
      run.interactionSpec = paths.interactionSpec;
      await runCommandImpl(run, 'interaction spec render', PYTHON, [
        'tools/ai-generator/render_interaction_plan.py', '--input', interactionPlan, '--output', run.interactionSpec,
      ]);
      interaction = JSON.parse(fs.readFileSync(interactionPlan, 'utf8'));
      stage(run, 'Interaction spec rendering', 'success');
    } else {
      markInteractionSkipped(run, targets.interactionSkipReason);
    }
    stage(run, 'Playwright execution', 'running');
    const resultJson = paths.playwrightJsonReport;
    run.reportDir = run.workspace.playwrightHtmlReportDir;
    const testDir = run.workspace.specDir;
    const navigationSpecArgument = path.relative(testDir, run.navigationSpec).split(path.sep).join('/');
    const specArguments = [navigationSpecArgument];
    if (targets.interaction) {
      specArguments.push(path.relative(testDir, run.interactionSpec).split(path.sep).join('/'));
      stage(run, 'Interaction execution', 'running');
    }
    const started = Date.now();
    run._terminalContext ||= {};
    run._terminalContext.executionAttempted = true;
    run._terminalContext.assertions = null;
    recordProcessOutcome(run, { attempted: true, outcome: 'failed', exitCode: null, signaled: null, timedOut: false });
    const execution = await runCommandImpl(run, 'Playwright execution', PLAYWRIGHT, [
      PLAYWRIGHT_CLI, 'test', ...specArguments,
      '--config', 'tools/mvp/playwright.config.js', '--workers=1', '--retries=0', '--reporter=html,json',
    ], {
      allowFailure: true,
      env: {
        PLAYWRIGHT_HTML_OUTPUT_DIR: run.reportDir,
        PLAYWRIGHT_JSON_OUTPUT_NAME: resultJson,
        MVP_PLAYWRIGHT_TEST_DIR: testDir,
        MVP_PLAYWRIGHT_OUTPUT_DIR: run.workspace.testResultsDir,
      },
    });
    recordProcessOutcome(run, {
      attempted: true,
      outcome: execution.code === 0 && !execution.signal ? 'succeeded' : 'failed',
      exitCode: execution.code,
      signaled: Boolean(execution.signal),
      timedOut: false,
    });
    run.durationMs = Date.now() - started;
    stage(run, 'Playwright execution', execution.code === 0 ? 'success' : 'failed', execution.code === 0 ? undefined : 'One or more Playwright assertions failed.');
    stage(run, 'Report preparation', 'running');
    const raw = JSON.parse(fs.readFileSync(resultJson, 'utf8'));
    run._terminalContext.assertions = summarizePlaywrightAssertions(raw);
    recordProcessOutcome(run, {
      attempted: true,
      outcome: 'succeeded',
      exitCode: execution.code,
      signaled: false,
      timedOut: false,
    });
    run.result = summarizePlaywrightResult(raw, navigationPlan, interaction, run.durationMs, execution.code);
    run.result.reportUrl = `/api/runs/${run.id}/report`;
    if (targets.interaction) {
      stage(
        run,
        'Interaction execution',
        run.result.softInteractions.status === 'passed' ? 'success' : 'failed',
        run.result.softInteractions.status === 'passed' ? undefined : 'One or more interaction assertions failed.',
      );
    }
    stage(run, 'Report preparation', fs.existsSync(paths.playwrightHtmlReportIndex) ? 'success' : 'failed');
    run.status = 'completed';
    persist(run);
  } catch (error) {
    if (!run._terminalContext?.process?.attempted) {
      recordProcessOutcome(run, {
        attempted: true,
        outcome: 'failed',
        exitCode: error?.result?.code,
        signaled: Boolean(error?.result?.signal),
        timedOut: error?.result?.timedOut === true,
        timeoutMs: error?.result?.timeoutMs,
        termination: error?.result?.termination,
      });
    }
    const active = Object.entries(run.stages).find(([, value]) => value.status === 'running');
    if (active) stage(run, active[0], 'failed', friendlyError(active[0], error));
    run.status = 'failed';
    run.error = friendlyError(active?.[0], error);
    const firstFailed = Object.entries(run.stages).find(([, value]) => value.status === 'failed');
    const primaryStageName = firstFailed?.[0] || active?.[0];
    recordPrimaryError(run, primaryStageName, error, {
      preferRecordedProcess: Boolean(firstFailed && active && firstFailed[0] !== active[0]),
    });
    persist(run);
  } finally {
    if (['completed', 'failed'].includes(run.status)) finalizeTerminalRun(run, dependencies);
    else refreshArtifactManifest(run, dependencies);
  }
}

function flattenSpecs(suites, output = []) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) output.push(spec);
    flattenSpecs(suite.suites, output);
  }
  return output;
}

function specPassed(spec) {
  const tests = spec.tests || [];
  return tests.length > 0 && tests.every((test) => test.status === 'expected' && (test.results || []).some((result) => result.status === 'passed'));
}

function summarizePlaywrightResult(raw, navigationPlan, interactionPlan, durationMs, exitCode) {
  const specs = flattenSpecs(raw.suites || []);
  const navSpecs = specs.filter((spec) => /generated_from_plan\.spec\.js$/i.test(spec.file || ''));
  const interactionSpecs = specs.filter((spec) => /generated_interaction_plan\.spec\.js$/i.test(spec.file || ''));
  const titleStatus = new Map(navSpecs.map((spec) => [spec.title, specPassed(spec)]));
  const identityTests = (navigationPlan.tests || []).filter((test) =>
    ['navigation.headingIdentity', 'navigation.contentIdentity', 'navigation.tabIdentity'].includes(test.template));
  const navPassed = navSpecs.filter(specPassed).length;
  const interactionPassed = interactionSpecs.filter(specPassed).length;
  const interactionTests = interactionPlan?.tests || [];
  const tabTests = interactionTests.filter((test) => test.template === 'interaction.tabSelection');
  const tabPassed = interactionSpecs.filter((spec) => specPassed(spec)).length;
  const interactionSkipped = !interactionPlan;
  const interactionFailed = interactionSpecs.length - interactionPassed;
  return {
    overall: exitCode === 0 ? 'PASS' : 'FAIL',
    durationMs,
    pageNavigation: {
      total: navSpecs.length,
      passed: navPassed,
      failed: navSpecs.length - navPassed,
      identityTotal: identityTests.length,
      identityVerified: identityTests.filter((test) => titleStatus.get(`Navigation: ${(test.menuPath || []).join(' > ')}`) === true).length,
      identityFailed: identityTests.filter((test) => titleStatus.get(`Navigation: ${(test.menuPath || []).join(' > ')}`) === false).length,
    },
    softInteractions: {
      status: interactionSkipped ? 'skipped' : (interactionFailed === 0 && interactionPassed === interactionTests.length ? 'passed' : 'failed'),
      reason: interactionSkipped ? NO_APPROVED_INTERACTIONS : null,
      approved: interactionTests.length,
      passed: interactionPassed,
      failed: interactionFailed,
      restorationStatus: interactionSkipped ? 'skipped' : (tabPassed === tabTests.length ? 'passed' : 'failed'),
      restorationTotal: tabTests.length,
      restorationPassed: tabPassed,
      restorationFailed: tabTests.length - tabPassed,
    },
    failedTests: specs.filter((spec) => !specPassed(spec)).map((spec) => spec.title),
  };
}

function publicRun(run) {
  return {
    id: run.id,
    url: run.url,
    status: run.status,
    stages: run.stages,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    error: run.error,
    approvedCandidateKeys: run.approvedCandidateKeys,
    debugLog: run.debugLog,
  };
}

function getRun(id) {
  const run = runs.get(id);
  if (!run) throw new Error('Run not found.');
  return run;
}

module.exports = {
  DEFAULT_ENGINE_TIMEOUT_MS,
  DEFAULT_EXECUTION_TIMEOUT_MS,
  STAGES,
  analyzeRun,
  approveRun,
  createRun,
  enqueue,
  executeRun,
  getRun,
  normalizeAnalysis,
  parseTimeoutSetting,
  publicRun,
  runCommand,
  resolveTimeoutPolicy,
  selectExecutionTargets,
  summarizePlaywrightResult,
  validateExecuteRequest,
  validateTargetUrl,
  friendlyError,
  generateRunId,
};
