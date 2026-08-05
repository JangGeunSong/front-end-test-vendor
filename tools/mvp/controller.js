const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  createEngineInvocationRequest,
  invokeEngineProcess,
} = require('./engine-invocation');
const {
  createRunWorkspace,
  ensureRunWorkspace,
} = require('./run-workspace');

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
  return run;
}

function persist(run) {
  run.updatedAt = new Date().toISOString();
  const serializable = { ...run };
  delete serializable.workspace;
  delete serializable.dir;
  delete serializable.specDir;
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

async function runCommand(run, label, executable, args, options = {}, dependencies = {}) {
  const request = createEngineInvocationRequest({
    command: executable,
    args,
    cwd: ROOT,
    env: {
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      ...(options.env || {}),
    },
  }, dependencies);
  const invocation = await (dependencies.invokeEngineProcessImpl || invokeEngineProcess)(request);
  if (invocation.spawnError) throw invocation.spawnError;
  appendLog(run, label, [invocation.stdout, invocation.stderr].filter(Boolean).join('\n'));
  persist(run);
  const result = {
    code: invocation.exitCode,
    signal: invocation.signal,
    stdout: invocation.stdout,
    stderr: invocation.stderr,
  };
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
  const runCommandImpl = dependencies.runCommandImpl || runCommand;
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
    const active = Object.entries(run.stages).find(([, value]) => value.status === 'running');
    if (active) stage(run, active[0], 'failed', friendlyError(active[0], error));
    run.status = 'failed';
    run.error = friendlyError(active?.[0], error);
    persist(run);
  }
}

function friendlyError(stageName, error) {
  const output = `${error?.result?.stderr || ''}\n${error?.result?.stdout || ''}`;
  const message = error?.message || '';
  if (error?.code === 'ENOENT' || /\bENOENT\b/.test(message)) {
    return `Required executable unavailable: ${error?.path || 'unknown executable'}. Create the project venv and install dependencies as described in docs/DEVELOPMENT_ENVIRONMENT.md.`;
  }
  if (/ModuleNotFoundError|No module named/.test(output)) {
    return 'Python dependency missing. Run: npm run env:sync';
  }
  if (/Executable doesn't exist|browserType\.launch.*executable/i.test(output)) {
    return 'Playwright Chromium is unavailable. Run: npx playwright install chromium';
  }
  if (/ERR_(?:NAME_NOT_RESOLVED|CONNECTION_REFUSED|CONNECTION_TIMED_OUT|NETWORK_ACCESS_DENIED)|net::ERR_|getaddrinfo|ENETUNREACH/i.test(output)) {
    return 'Target website is unavailable from this network. Check the URL, proxy/firewall policy, and outbound network access.';
  }
  if (output.includes('evidenceChanged')) return 'Evidence changed. Re-analyze and approve the current candidate again.';
  if (output.includes('missingCandidate')) return 'Approved candidate missing. Re-analyze and approve again.';
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

async function approveRun(run, candidateKeys, reviewer, note) {
  if (run.status !== 'ready_for_execution') throw new Error('Run is not ready for interaction approval.');
  const selected = [...new Set(candidateKeys || [])].sort();
  if (selected.length === 0) throw new Error('Select at least one supported interaction to approve.');
  const eligibleKeys = new Set(
    (run.analysis?.interactions || []).filter((item) => item.executionEligible).map((item) => item.candidateKey),
  );
  const unsupported = selected.filter((key) => !eligibleKeys.has(key));
  if (unsupported.length > 0) throw new Error('Only supported, execution-eligible interactions can be approved.');
  stage(run, 'Interaction approval validation', 'running');
  run.approvalPath = run.workspace.paths.interactionApprovals;
  const args = [
    'tools/ai-generator/write_interaction_approvals.py', '--report', run.analysisReport,
    '--output', run.approvalPath, '--reviewer', reviewer || 'local-ui-user',
  ];
  for (const key of selected) args.push('--candidate-key', key);
  if (note) args.push('--note', note);
  await runCommand(run, 'approval writer', PYTHON, args);
  await runCommand(run, 'approval validator', PYTHON, [
    'tools/ai-generator/validate_interaction_approvals.py', '--input', run.approvalPath,
  ]);
  stage(run, 'Interaction approval validation', 'success');
  run.approvedCandidateKeys = selected;
  run.status = 'approved';
  persist(run);
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
  const runCommandImpl = dependencies.runCommandImpl || runCommand;
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
      stage(run, 'Interaction spec rendering', 'success');
      interaction = JSON.parse(fs.readFileSync(interactionPlan, 'utf8'));
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
    run.durationMs = Date.now() - started;
    stage(run, 'Playwright execution', execution.code === 0 ? 'success' : 'failed', execution.code === 0 ? undefined : 'One or more Playwright assertions failed.');
    stage(run, 'Report preparation', 'running');
    const raw = JSON.parse(fs.readFileSync(resultJson, 'utf8'));
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
    const active = Object.entries(run.stages).find(([, value]) => value.status === 'running');
    if (active) stage(run, active[0], 'failed', friendlyError(active[0], error));
    run.status = 'failed';
    run.error = friendlyError(active?.[0], error);
    persist(run);
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
  STAGES,
  analyzeRun,
  approveRun,
  createRun,
  enqueue,
  executeRun,
  getRun,
  normalizeAnalysis,
  publicRun,
  runCommand,
  selectExecutionTargets,
  summarizePlaywrightResult,
  validateExecuteRequest,
  validateTargetUrl,
  friendlyError,
  generateRunId,
};
