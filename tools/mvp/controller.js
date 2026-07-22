const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const GENERATED = path.join(ROOT, 'tools', 'ai-generator', 'generated');
const RUNS_DIR = path.join(GENERATED, 'mvp-runs');
const PYTHON = process.env.MVP_PYTHON || path.join(ROOT, 'venv', 'Scripts', 'python.exe');
const PLAYWRIGHT = process.execPath;
const PLAYWRIGHT_CLI = require.resolve('@playwright/test/cli');
const STAGES = [
  'Target validation',
  'Website analysis',
  'Page test plan generation',
  'Interaction discovery',
  'Waiting for approval',
  'Approval validation',
  'Reconciliation',
  'Plan generation',
  'Spec rendering',
  'Playwright execution',
  'Report preparation',
];

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

function createRun(url) {
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const dir = path.join(RUNS_DIR, id);
  const specDir = path.join(ROOT, 'tests', 'generated');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(specDir, { recursive: true });
  const run = {
    id,
    url,
    dir,
    specDir,
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
  delete serializable.dir;
  delete serializable.specDir;
  fs.writeFileSync(path.join(run.dir, 'status.json'), `${JSON.stringify(serializable, null, 2)}\n`, 'utf8');
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

function runCommand(run, label, executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        ...(options.env || {}),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      appendLog(run, label, [stdout, stderr].filter(Boolean).join('\n'));
      persist(run);
      const result = { code, stdout, stderr };
      if (code === 0 || options.allowFailure) resolve(result);
      else reject(Object.assign(new Error(`${label} failed`), { result }));
    });
  });
}

function copyFreshArtifacts(run) {
  const names = ['scout_result.json', 'menu_map.json', 'test_plan.generated.json'];
  for (const name of names) fs.copyFileSync(path.join(GENERATED, name), path.join(run.dir, name));
  run.navigationSpec = path.join(run.specDir, `mvp-${run.id}-generated_from_plan.spec.js`);
  fs.copyFileSync(path.join(ROOT, 'tests', 'generated', 'generated_from_plan.spec.js'), run.navigationSpec);
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

async function analyzeRun(run) {
  run.status = 'analyzing';
  stage(run, 'Target validation', 'success');
  stage(run, 'Website analysis', 'running');
  try {
    await runCommand(run, 'website analysis and navigation plan', PYTHON, [
      'tools/ai-generator/agent_orchestrator.py', '--generation-mode', 'plan', '--url', run.url, '--no-profile-cache',
    ]);
    copyFreshArtifacts(run);
    stage(run, 'Website analysis', 'success');
    stage(run, 'Page test plan generation', 'success');
    stage(run, 'Interaction discovery', 'running');
    run.analysisReport = path.join(run.dir, 'analysis_review_report.json');
    await runCommand(run, 'interaction discovery', PYTHON, [
      'tools/ai-generator/build_analysis_review_report.py',
      '--scout-result', path.join(run.dir, 'scout_result.json'),
      '--menu-map', path.join(run.dir, 'menu_map.json'),
      '--test-plan', path.join(run.dir, 'test_plan.generated.json'),
      '--output', run.analysisReport,
    ]);
    await runCommand(run, 'analysis report rendering', PYTHON, [
      'tools/ai-generator/render_analysis_review_report.py', '--input', run.analysisReport,
      '--output', path.join(run.dir, 'analysis_review_report.md'),
    ]);
    const report = JSON.parse(fs.readFileSync(run.analysisReport, 'utf8'));
    const plan = JSON.parse(fs.readFileSync(path.join(run.dir, 'test_plan.generated.json'), 'utf8'));
    run.analysis = normalizeAnalysis(report, plan);
    stage(run, 'Interaction discovery', 'success');
    stage(run, 'Waiting for approval', 'running');
    run.status = 'waiting_for_approval';
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
  if (output.includes('evidenceChanged')) return 'Evidence changed. Re-analyze and approve the current candidate again.';
  if (output.includes('missingCandidate')) return 'Approved candidate missing. Re-analyze and approve again.';
  const labels = {
    'Website analysis': 'Website analysis failed.',
    'Page test plan generation': 'Page plan generation failed.',
    'Interaction discovery': 'Interaction discovery failed.',
    'Approval validation': 'Approval validation failed.',
    Reconciliation: 'Reconciliation failed.',
    'Plan generation': 'Interaction plan validation failed.',
    'Spec rendering': 'Spec rendering failed.',
    'Playwright execution': 'Playwright execution failed.',
    'Report preparation': 'HTML report unavailable.',
  };
  return labels[stageName] || error.message || 'Operation failed.';
}

async function approveRun(run, candidateKeys, reviewer, note) {
  if (run.status !== 'waiting_for_approval') throw new Error('Run is not waiting for approval.');
  stage(run, 'Approval validation', 'running');
  run.approvalPath = path.join(run.dir, 'interaction_approvals.json');
  const args = [
    'tools/ai-generator/write_interaction_approvals.py', '--report', run.analysisReport,
    '--output', run.approvalPath, '--reviewer', reviewer || 'local-ui-user',
  ];
  for (const key of candidateKeys || []) args.push('--candidate-key', key);
  if (note) args.push('--note', note);
  await runCommand(run, 'approval writer', PYTHON, args);
  await runCommand(run, 'approval validator', PYTHON, [
    'tools/ai-generator/validate_interaction_approvals.py', '--input', run.approvalPath,
  ]);
  stage(run, 'Waiting for approval', 'success');
  stage(run, 'Approval validation', 'success');
  run.approvedCandidateKeys = [...candidateKeys].sort();
  run.status = 'approved';
  persist(run);
}

async function executeRun(run) {
  run.status = 'executing';
  const reconciliation = path.join(run.dir, 'interaction_approval_reconciliation.json');
  const interactionPlan = path.join(run.dir, 'interaction_plan.generated.json');
  run.interactionSpec = path.join(run.specDir, `mvp-${run.id}-generated_interaction_plan.spec.js`);
  try {
    stage(run, 'Reconciliation', 'running');
    await runCommand(run, 'approval reconciliation', PYTHON, [
      'tools/ai-generator/reconcile_interaction_approvals.py', '--report', run.analysisReport,
      '--approvals', run.approvalPath, '--output', reconciliation,
    ]);
    stage(run, 'Reconciliation', 'success');
    stage(run, 'Plan generation', 'running');
    await runCommand(run, 'interaction plan build', PYTHON, [
      'tools/ai-generator/build_interaction_plan.py', '--reconciliation', reconciliation,
      '--report', run.analysisReport, '--output', interactionPlan,
    ]);
    await runCommand(run, 'interaction plan validation', PYTHON, [
      'tools/ai-generator/validate_interaction_plan.py', '--input', interactionPlan,
      '--reconciliation', reconciliation, '--report', run.analysisReport,
    ]);
    stage(run, 'Plan generation', 'success');
    stage(run, 'Spec rendering', 'running');
    await runCommand(run, 'interaction spec render', PYTHON, [
      'tools/ai-generator/render_interaction_plan.py', '--input', interactionPlan, '--output', run.interactionSpec,
    ]);
    stage(run, 'Spec rendering', 'success');
    stage(run, 'Playwright execution', 'running');
    const resultJson = path.join(run.dir, 'playwright-results.json');
    run.reportDir = path.join(run.dir, 'playwright-report');
    const testDir = path.join(ROOT, 'tests');
    const navigationSpecArgument = path.relative(testDir, run.navigationSpec).split(path.sep).join('/');
    const interactionSpecArgument = path.relative(testDir, run.interactionSpec).split(path.sep).join('/');
    const started = Date.now();
    const execution = await runCommand(run, 'Playwright execution', PLAYWRIGHT, [
      PLAYWRIGHT_CLI, 'test', navigationSpecArgument, interactionSpecArgument,
      '--config', 'tools/mvp/playwright.config.js', '--workers=1', '--retries=0', '--reporter=html,json',
    ], {
      allowFailure: true,
      env: {
        PLAYWRIGHT_HTML_OUTPUT_DIR: run.reportDir,
        PLAYWRIGHT_JSON_OUTPUT_NAME: resultJson,
      },
    });
    run.durationMs = Date.now() - started;
    stage(run, 'Playwright execution', execution.code === 0 ? 'success' : 'failed', execution.code === 0 ? undefined : 'One or more Playwright assertions failed.');
    stage(run, 'Report preparation', 'running');
    const raw = JSON.parse(fs.readFileSync(resultJson, 'utf8'));
    const navigationPlan = JSON.parse(fs.readFileSync(path.join(run.dir, 'test_plan.generated.json'), 'utf8'));
    const interaction = JSON.parse(fs.readFileSync(interactionPlan, 'utf8'));
    run.result = summarizePlaywrightResult(raw, navigationPlan, interaction, run.durationMs, execution.code);
    run.result.reportUrl = `/api/runs/${run.id}/report`;
    stage(run, 'Report preparation', fs.existsSync(path.join(run.reportDir, 'index.html')) ? 'success' : 'failed');
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
  const tabTests = (interactionPlan.tests || []).filter((test) => test.template === 'interaction.tabSelection');
  const tabPassed = interactionSpecs.filter((spec) => specPassed(spec)).length;
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
      approved: (interactionPlan.tests || []).length,
      passed: interactionPassed,
      failed: interactionSpecs.length - interactionPassed,
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
  summarizePlaywrightResult,
  validateTargetUrl,
};
