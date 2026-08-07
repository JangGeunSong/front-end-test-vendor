const fs = require('node:fs');
const path = require('node:path');
const {
  ARTIFACT_IDS,
  ARTIFACT_MANIFEST_SCHEMA_VERSION,
  validateArtifactManifest,
} = require('./artifact-manifest');
const {
  isPathContained,
  validateRunId,
} = require('./run-workspace');
const {
  LIFECYCLE_STAGES,
  STAGE_PROJECTION,
  projectLifecycleStage,
} = require('./lifecycle-stage');
const {
  ERROR_CATEGORIES,
  ERROR_CODES,
  ERROR_CODE_REGISTRY,
  NORMALIZED_ERROR_SCHEMA_VERSION,
} = require('./normalized-error');

const TERMINAL_RESULT_SCHEMA_VERSION = '1.3';
const TERMINAL_OUTCOMES = Object.freeze([
  'succeeded',
  'completed-with-test-failures',
  'partially-succeeded',
  'failed',
  'cancelled',
]);
const PROCESS_OUTCOMES = Object.freeze(['not-run', 'succeeded', 'failed', 'cancelled']);
const ASSERTION_OUTCOMES = Object.freeze(['not-run', 'passed', 'failed', 'mixed', 'unavailable']);
const MANIFEST_STATUSES = Object.freeze(['valid', 'invalid', 'unavailable']);
const RESULT_AVAILABILITIES = Object.freeze(['available', 'partial', 'unavailable']);
const ERROR_REFERENCE_STATUSES = Object.freeze(['none', 'present', 'unavailable']);

const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion', 'runId', 'outcome', 'lifecycle', 'process', 'execution',
  'artifacts', 'errorReference', 'hasError', 'completedAt',
]);
const LIFECYCLE_KEYS = Object.freeze(['lastCompletedStage', 'failedStage']);
const PROCESS_KEYS = Object.freeze(['attempted', 'outcome', 'exitCode', 'signaled', 'timedOut', 'cancelled']);
const EXECUTION_KEYS = Object.freeze(['attempted', 'assertionOutcome', 'counts']);
const COUNT_KEYS = Object.freeze(['total', 'passed', 'failed', 'skipped', 'flaky']);
const ARTIFACT_KEYS = Object.freeze([
  'manifestRelativePath', 'manifestSchemaVersion', 'manifestStatus', 'manifestValid',
  'availableArtifactCount', 'missingArtifactCount', 'emptyArtifactCount',
  'resultAvailability',
]);
const ERROR_REFERENCE_KEYS = Object.freeze([
  'status', 'relativePath', 'schemaVersion', 'code', 'category', 'stage',
]);

function relativePathIsSafe(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) return false;
  const segments = value.split('/');
  return !segments.includes('..') && !segments.includes('.') && !segments.includes('')
    && path.posix.normalize(value) === value;
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

function summarizeLifecycle(run) {
  let lastCompletedStage = null;
  let failedStage = null;
  for (const [controllerStage, lifecycleStage] of STAGE_PROJECTION) {
    const status = run.stages?.[controllerStage]?.status;
    if (status === 'success') lastCompletedStage = lifecycleStage;
    if (status === 'failed' && failedStage === null) failedStage = lifecycleStage;
  }
  return Object.freeze({ lastCompletedStage, failedStage });
}

function flattenPlaywrightTests(suites, output = []) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) output.push(test);
    }
    flattenPlaywrightTests(suite.suites, output);
  }
  return output;
}

function classifyPlaywrightTest(test) {
  const results = Array.isArray(test.results) ? test.results : [];
  if (test.status === 'skipped' || (results.length > 0 && results.every((result) => result.status === 'skipped'))) return 'skipped';
  if (test.status === 'flaky') return 'flaky';
  if (test.status === 'expected' && results.some((result) => result.status === 'passed')) return 'passed';
  return 'failed';
}

function summarizePlaywrightAssertions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.suites)) {
    throw new TypeError('Playwright JSON report must contain a suites array.');
  }
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const test of flattenPlaywrightTests(raw.suites)) {
    counts.total += 1;
    counts[classifyPlaywrightTest(test)] += 1;
  }
  let assertionOutcome = 'unavailable';
  const successful = counts.passed + counts.flaky;
  if (counts.failed > 0 && successful > 0) assertionOutcome = 'mixed';
  else if (counts.failed > 0) assertionOutcome = 'failed';
  else if (successful > 0) assertionOutcome = 'passed';
  return Object.freeze({
    assertionOutcome,
    counts: Object.freeze(counts),
  });
}

function inspectManifest(workspace, fsImpl) {
  const manifestPath = workspace.paths.artifactManifest;
  const manifestRelativePath = normalizeRelativePath(path.relative(workspace.root, manifestPath));
  if (!relativePathIsSafe(manifestRelativePath) || !isPathContained(workspace.root, manifestPath)) {
    throw new Error('Manifest path must remain inside the run workspace.');
  }
  if (!fsImpl.existsSync(manifestPath)) {
    return manifestInspection(manifestRelativePath, null, 'unavailable', null);
  }
  try {
    const workspaceRealPath = fsImpl.realpathSync(workspace.root);
    const manifestRealPath = fsImpl.realpathSync(manifestPath);
    if (!isPathContained(workspaceRealPath, manifestRealPath)) {
      return manifestInspection(manifestRelativePath, null, 'invalid', null);
    }
    const manifest = JSON.parse(fsImpl.readFileSync(manifestPath, 'utf8'));
    const errors = validateArtifactManifest(manifest, { workspace, checkFilesystem: true, fsImpl });
    if (errors.length > 0) {
      const version = typeof manifest.schemaVersion === 'string' ? manifest.schemaVersion : null;
      return manifestInspection(manifestRelativePath, version, 'invalid', null);
    }
    const counts = { available: 0, missing: 0, empty: 0 };
    for (const artifact of manifest.artifacts) {
      if (artifact.presence === 'present') counts.available += 1;
      else if (artifact.presence === 'missing') counts.missing += 1;
      else if (artifact.presence === 'empty') counts.empty += 1;
    }
    return manifestInspection(manifestRelativePath, manifest.schemaVersion, 'valid', { manifest, counts });
  } catch {
    return manifestInspection(manifestRelativePath, null, 'invalid', null);
  }
}

function manifestInspection(relativePath, schemaVersion, status, detail) {
  return {
    relativePath,
    schemaVersion,
    status,
    valid: status === 'valid',
    manifest: detail?.manifest || null,
    counts: detail?.counts || null,
  };
}

function artifactPresent(manifest, artifactId) {
  return manifest?.artifacts?.some((artifact) => artifact.artifactId === artifactId && artifact.presence === 'present') === true;
}

function determineResultAvailability(run, manifestState) {
  if (manifestState.valid
      && run.result
      && artifactPresent(manifestState.manifest, ARTIFACT_IDS.PLAYWRIGHT_JSON)) return 'available';
  if (run.result || run.analysis || (manifestState.valid
      && artifactPresent(manifestState.manifest, ARTIFACT_IDS.ANALYSIS_REVIEW_JSON))) return 'partial';
  return 'unavailable';
}

function normalizeProcess(processInput) {
  if (!processInput) return Object.freeze({ attempted: false, outcome: 'not-run', exitCode: null, signaled: null, timedOut: false, cancelled: false });
  return Object.freeze({
    attempted: processInput.attempted === true,
    outcome: processInput.outcome,
    exitCode: Number.isInteger(processInput.exitCode) ? processInput.exitCode : null,
    signaled: typeof processInput.signaled === 'boolean' ? processInput.signaled : null,
    timedOut: processInput.timedOut === true,
    cancelled: processInput.cancelled === true,
  });
}

function normalizeExecution(executionInput) {
  const attempted = executionInput?.attempted === true;
  if (!attempted) return Object.freeze({ attempted: false, assertionOutcome: 'not-run', counts: null });
  return Object.freeze({
    attempted: true,
    assertionOutcome: executionInput?.assertions?.assertionOutcome || 'unavailable',
    counts: executionInput?.assertions?.counts ? Object.freeze({ ...executionInput.assertions.counts }) : null,
  });
}

function normalizeErrorReference(run, workspace, lifecycle, input = {}) {
  const relativePath = normalizeRelativePath(path.relative(workspace.root, workspace.paths.normalizedError));
  if (!relativePathIsSafe(relativePath) || !isPathContained(workspace.root, workspace.paths.normalizedError)) {
    throw new Error('Normalized error path must remain inside the run workspace.');
  }
  if (!run.error) {
    return Object.freeze({
      status: 'none',
      relativePath,
      schemaVersion: null,
      code: null,
      category: null,
      stage: null,
    });
  }
  const normalizedError = input.normalizedError;
  if (!normalizedError) {
    return Object.freeze({
      status: 'unavailable',
      relativePath,
      schemaVersion: null,
      code: null,
      category: null,
      stage: lifecycle.failedStage,
    });
  }
  if (normalizedError.runId !== run.id) throw new Error('Normalized error runId does not match the terminal run.');
  if (normalizedError.stage !== lifecycle.failedStage) throw new Error('Normalized error stage does not match the failed lifecycle stage.');
  return Object.freeze({
    status: input.normalizedErrorPersisted === false ? 'unavailable' : 'present',
    relativePath,
    schemaVersion: normalizedError.schemaVersion,
    code: normalizedError.code,
    category: normalizedError.category,
    stage: normalizedError.stage,
  });
}

function determineOutcome(run, lifecycle, process, execution, resultAvailability) {
  if (run.status === 'cancelled') return 'cancelled';
  if (run.status === 'failed') {
    return resultAvailability === 'unavailable' ? 'failed' : 'partially-succeeded';
  }
  if (lifecycle.failedStage === 'report' || process.outcome === 'failed' || execution.assertionOutcome === 'unavailable') {
    return 'partially-succeeded';
  }
  if (execution.assertionOutcome === 'failed' || execution.assertionOutcome === 'mixed') {
    return 'completed-with-test-failures';
  }
  return 'succeeded';
}

function createTerminalResult(input, options = {}) {
  const run = input?.run;
  const workspace = input?.workspace || run?.workspace;
  if (!run || !workspace) throw new TypeError('Run and workspace contracts are required.');
  validateRunId(run.id);
  if (!['completed', 'failed', 'cancelled'].includes(run.status)) throw new Error('Terminal result requires a completed, failed, or cancelled run.');
  if (workspace.runId !== run.id) throw new Error('Run ID does not match the workspace.');
  const fsImpl = options.fsImpl || fs;
  const clock = options.clock || (() => new Date());
  const lifecycle = summarizeLifecycle(run);
  const process = normalizeProcess(input.process);
  const execution = normalizeExecution(input.execution);
  const errorReference = normalizeErrorReference(run, workspace, lifecycle, input);
  const manifestState = inspectManifest(workspace, fsImpl);
  const resultAvailability = determineResultAvailability(run, manifestState);
  const outcome = determineOutcome(run, lifecycle, process, execution, resultAvailability);
  const completedAtValue = clock();
  const completedAt = completedAtValue instanceof Date
    ? completedAtValue.toISOString()
    : new Date(completedAtValue).toISOString();
  const result = Object.freeze({
    schemaVersion: TERMINAL_RESULT_SCHEMA_VERSION,
    runId: run.id,
    outcome,
    lifecycle,
    process,
    execution,
    artifacts: Object.freeze({
      manifestRelativePath: manifestState.relativePath,
      manifestSchemaVersion: manifestState.schemaVersion,
      manifestStatus: manifestState.status,
      manifestValid: manifestState.valid,
      availableArtifactCount: manifestState.counts?.available ?? null,
      missingArtifactCount: manifestState.counts?.missing ?? null,
      emptyArtifactCount: manifestState.counts?.empty ?? null,
      resultAvailability,
    }),
    errorReference,
    hasError: Boolean(run.error),
    completedAt,
  });
  const errors = validateTerminalResult(result);
  if (errors.length > 0) throw new Error(`Terminal result validation failed: ${errors.join(' ')}`);
  return result;
}

function validateTerminalResult(result) {
  const errors = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['Terminal result must be an object.'];
  validateExactKeys(result, TOP_LEVEL_KEYS, 'result', errors);
  if (result.schemaVersion !== TERMINAL_RESULT_SCHEMA_VERSION) errors.push('Unsupported terminal result schemaVersion.');
  try {
    validateRunId(result.runId);
  } catch {
    errors.push('Terminal result runId is invalid.');
  }
  if (!TERMINAL_OUTCOMES.includes(result.outcome)) errors.push('Terminal result outcome is invalid.');
  validateLifecycle(result.lifecycle, errors);
  validateProcess(result.process, errors);
  validateExecution(result.execution, errors);
  validateArtifacts(result.artifacts, errors);
  validateErrorReference(result.errorReference, errors);
  if (typeof result.hasError !== 'boolean') errors.push('hasError must be boolean.');
  if (typeof result.completedAt !== 'string' || Number.isNaN(Date.parse(result.completedAt))) errors.push('completedAt must be an ISO timestamp.');
  validateConsistency(result, errors);
  return errors;
}

function validateExactKeys(value, expected, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object.`);
    return false;
  }
  if (Object.keys(value).join('|') !== expected.join('|')) errors.push(`${label} has unknown, missing, or non-deterministically ordered fields.`);
  return true;
}

function validateLifecycle(lifecycle, errors) {
  if (!validateExactKeys(lifecycle, LIFECYCLE_KEYS, 'lifecycle', errors)) return;
  if (lifecycle.lastCompletedStage !== null && !LIFECYCLE_STAGES.includes(lifecycle.lastCompletedStage)) errors.push('lastCompletedStage is invalid.');
  if (lifecycle.failedStage !== null && !LIFECYCLE_STAGES.includes(lifecycle.failedStage)) errors.push('failedStage is invalid.');
}

function validateProcess(process, errors) {
  if (!validateExactKeys(process, PROCESS_KEYS, 'process', errors)) return;
  if (typeof process.attempted !== 'boolean') errors.push('process.attempted must be boolean.');
  if (!PROCESS_OUTCOMES.includes(process.outcome)) errors.push('process.outcome is invalid.');
  if (process.exitCode !== null && (!Number.isInteger(process.exitCode) || process.exitCode < 0)) errors.push('process.exitCode is invalid.');
  if (process.signaled !== null && typeof process.signaled !== 'boolean') errors.push('process.signaled is invalid.');
  if (typeof process.timedOut !== 'boolean') errors.push('process.timedOut must be boolean.');
  if (typeof process.cancelled !== 'boolean') errors.push('process.cancelled must be boolean.');
}

function validateExecution(execution, errors) {
  if (!validateExactKeys(execution, EXECUTION_KEYS, 'execution', errors)) return;
  if (typeof execution.attempted !== 'boolean') errors.push('execution.attempted must be boolean.');
  if (!ASSERTION_OUTCOMES.includes(execution.assertionOutcome)) errors.push('execution.assertionOutcome is invalid.');
  if (execution.counts !== null) {
    if (validateExactKeys(execution.counts, COUNT_KEYS, 'execution.counts', errors)) {
      for (const key of COUNT_KEYS) {
        if (!Number.isSafeInteger(execution.counts[key]) || execution.counts[key] < 0) errors.push(`execution.counts.${key} is invalid.`);
      }
      const sum = COUNT_KEYS.slice(1).reduce((total, key) => total + execution.counts[key], 0);
      if (execution.counts.total !== sum) errors.push('execution counts do not add up to total.');
    }
  }
}

function validateArtifacts(artifacts, errors) {
  if (!validateExactKeys(artifacts, ARTIFACT_KEYS, 'artifacts', errors)) return;
  if (!relativePathIsSafe(artifacts.manifestRelativePath)) errors.push('manifestRelativePath must be safe and relative.');
  if (artifacts.manifestSchemaVersion !== null && typeof artifacts.manifestSchemaVersion !== 'string') errors.push('manifestSchemaVersion is invalid.');
  if (!MANIFEST_STATUSES.includes(artifacts.manifestStatus)) errors.push('manifestStatus is invalid.');
  if (typeof artifacts.manifestValid !== 'boolean') errors.push('manifestValid must be boolean.');
  for (const key of ['availableArtifactCount', 'missingArtifactCount', 'emptyArtifactCount']) {
    if (artifacts[key] !== null && (!Number.isSafeInteger(artifacts[key]) || artifacts[key] < 0)) errors.push(`${key} is invalid.`);
  }
  if (!RESULT_AVAILABILITIES.includes(artifacts.resultAvailability)) errors.push('resultAvailability is invalid.');
}

function validateErrorReference(errorReference, errors) {
  if (!validateExactKeys(errorReference, ERROR_REFERENCE_KEYS, 'errorReference', errors)) return;
  if (!ERROR_REFERENCE_STATUSES.includes(errorReference.status)) errors.push('errorReference.status is invalid.');
  if (!relativePathIsSafe(errorReference.relativePath)) errors.push('errorReference.relativePath must be safe and relative.');
  for (const key of ['schemaVersion', 'code', 'category', 'stage']) {
    if (errorReference[key] !== null && (typeof errorReference[key] !== 'string' || errorReference[key].length === 0)) errors.push(`errorReference.${key} is invalid.`);
  }
  if (errorReference.stage !== null && !LIFECYCLE_STAGES.includes(errorReference.stage)) errors.push('errorReference.stage is invalid.');
  if (errorReference.schemaVersion !== null && errorReference.schemaVersion !== NORMALIZED_ERROR_SCHEMA_VERSION) errors.push('errorReference.schemaVersion is unsupported.');
  if (errorReference.code !== null && !Object.values(ERROR_CODES).includes(errorReference.code)) errors.push('errorReference.code is invalid.');
  if (errorReference.category !== null && !ERROR_CATEGORIES.includes(errorReference.category)) errors.push('errorReference.category is invalid.');
  if (errorReference.code !== null && ERROR_CODE_REGISTRY[errorReference.code]?.category !== errorReference.category) errors.push('errorReference category/code pair is invalid.');
}

function validateConsistency(result, errors) {
  const { process, execution, artifacts, lifecycle } = result;
  const errorReference = result.errorReference;
  if (process?.attempted === false && (!['not-run', 'cancelled'].includes(process.outcome)
      || process.exitCode !== null || process.signaled !== null || process.timedOut !== false
      || process.cancelled !== (process.outcome === 'cancelled'))) errors.push('A non-attempted process must be not-run or cancelled with null details and no timeout.');
  if (process?.attempted === true && process.outcome === 'not-run') errors.push('An attempted process cannot be not-run.');
  if (process?.outcome === 'succeeded' && process.signaled !== false) errors.push('A succeeded process must not be signaled.');
  if (process?.outcome === 'succeeded' && process.timedOut) errors.push('A succeeded process cannot time out.');
  if (process?.outcome === 'succeeded' && process.cancelled) errors.push('A succeeded process cannot be cancelled.');
  if (process?.timedOut && process.cancelled) errors.push('A process cannot be timed out and cancelled.');
  if (process?.cancelled !== (process?.outcome === 'cancelled')) errors.push('process.cancelled must match the cancelled process outcome.');
  if (process?.timedOut && (process.attempted !== true || process.outcome !== 'failed' || lifecycle?.failedStage === null)) errors.push('A timed-out process must be attempted, failed, and have a failed stage.');
  if (execution?.attempted === false && (execution.assertionOutcome !== 'not-run' || execution.counts !== null)) errors.push('Non-attempted execution must have not-run assertions and null counts.');
  if (execution?.attempted === true && ['not-run'].includes(execution.assertionOutcome)) errors.push('Attempted execution cannot have not-run assertions.');
  if (execution?.attempted === true && process?.attempted !== true) errors.push('Attempted execution requires an attempted process.');
  if (['passed', 'failed', 'mixed'].includes(execution?.assertionOutcome) && execution.counts === null) errors.push('Available assertion outcome requires counts.');
  if (execution?.assertionOutcome === 'not-run' && execution.counts !== null) errors.push('Not-run assertion outcome requires null counts.');
  if (execution?.counts) {
    const successful = execution.counts.passed + execution.counts.flaky;
    if (execution.assertionOutcome === 'passed' && (execution.counts.failed > 0 || successful === 0)) errors.push('Passed assertions require successful tests and no failures.');
    if (execution.assertionOutcome === 'failed' && (execution.counts.failed === 0 || successful > 0)) errors.push('Failed assertions require failures and no successful tests.');
    if (execution.assertionOutcome === 'mixed' && (execution.counts.failed === 0 || successful === 0)) errors.push('Mixed assertions require both failed and successful tests.');
    if (execution.assertionOutcome === 'unavailable' && (execution.counts.failed > 0 || successful > 0)) errors.push('Unavailable assertions cannot include passed, flaky, or failed tests.');
  }
  if (process?.outcome === 'failed' && ['passed', 'failed', 'mixed'].includes(execution?.assertionOutcome)) errors.push('A failed process cannot expose assertion outcomes.');
  if (result.outcome === 'succeeded' && (process?.outcome !== 'succeeded' || execution?.assertionOutcome !== 'passed' || lifecycle?.failedStage !== null)) errors.push('Succeeded outcome is inconsistent.');
  if (result.outcome === 'completed-with-test-failures' && (process?.outcome !== 'succeeded' || !['failed', 'mixed'].includes(execution?.assertionOutcome) || lifecycle?.failedStage !== 'execution')) errors.push('Completed-with-test-failures outcome is inconsistent.');
  if (result.outcome === 'failed' && (lifecycle?.failedStage === null || result.hasError !== true)) errors.push('Failed outcome requires a failed stage and error marker.');
  if (result.outcome === 'cancelled' && (process?.outcome !== 'cancelled' || process?.timedOut
      || lifecycle?.failedStage !== null || result.hasError !== false || errorReference?.status !== 'none')) errors.push('Cancelled outcome requires cancellation without timeout, failed stage, or primary error.');
  if (result.outcome !== 'cancelled' && process?.cancelled) errors.push('Only a cancelled terminal outcome can contain a cancelled process.');
  if (result.hasError === false && errorReference?.status !== 'none') errors.push('A run without an error must not have a primary error reference.');
  if (result.hasError === true && !['present', 'unavailable'].includes(errorReference?.status)) errors.push('A run with an error requires a present or unavailable primary error reference.');
  if (errorReference?.status === 'none' && [errorReference.schemaVersion, errorReference.code, errorReference.category, errorReference.stage].some((value) => value !== null)) errors.push('An empty error reference cannot contain classification metadata.');
  if (errorReference?.status === 'present' && [errorReference.schemaVersion, errorReference.code, errorReference.category, errorReference.stage].some((value) => value === null)) errors.push('A present error reference requires classification metadata.');
  if (errorReference?.status !== 'none' && errorReference?.stage !== null && errorReference.stage !== lifecycle?.failedStage) errors.push('Error reference stage must match failedStage.');
  if (['succeeded', 'completed-with-test-failures'].includes(result.outcome) && errorReference?.status !== 'none') errors.push('Successful or assertion-only outcomes cannot have a primary normalized error.');
  if (process?.timedOut && errorReference?.code !== ERROR_CODES.ENGINE_DEADLINE_EXCEEDED) errors.push('A timed-out process requires the deadline-exceeded error code.');
  if (errorReference?.code === ERROR_CODES.ENGINE_DEADLINE_EXCEEDED && process?.timedOut !== true) errors.push('The deadline-exceeded error code requires process.timedOut.');
  if (artifacts?.manifestStatus === 'valid') {
    if (artifacts.manifestValid !== true || artifacts.manifestSchemaVersion !== ARTIFACT_MANIFEST_SCHEMA_VERSION
        || [artifacts.availableArtifactCount, artifacts.missingArtifactCount, artifacts.emptyArtifactCount].some((value) => !Number.isSafeInteger(value))) errors.push('Valid manifest metadata is inconsistent.');
  } else if (artifacts && (artifacts.manifestValid !== false
      || artifacts.availableArtifactCount !== null || artifacts.missingArtifactCount !== null || artifacts.emptyArtifactCount !== null)) {
    errors.push('Unavailable or invalid manifest metadata is inconsistent.');
  }
  if (artifacts?.manifestStatus === 'unavailable' && artifacts.manifestSchemaVersion !== null) errors.push('Unavailable manifest cannot have a schema version.');
  if (artifacts?.resultAvailability === 'available' && (artifacts.manifestValid !== true || artifacts.availableArtifactCount < 1)) errors.push('Available result requires a valid manifest and artifacts.');
}

function writeTerminalResult(input, options = {}) {
  const workspace = input?.workspace || input?.run?.workspace;
  if (!workspace?.paths?.terminalResult) throw new TypeError('A terminal-result workspace path is required.');
  const fsImpl = options.fsImpl || fs;
  const result = createTerminalResult(input, options);
  const destination = workspace.paths.terminalResult;
  if (!isPathContained(workspace.root, destination)) throw new Error('Terminal result path escaped the run workspace.');
  const temporary = `${destination}.tmp`;
  try {
    fsImpl.writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    fsImpl.renameSync(temporary, destination);
  } catch (error) {
    try {
      if (fsImpl.existsSync(temporary)) fsImpl.rmSync(temporary, { force: true });
    } catch {
      // Preserve the primary write error; cleanup is best effort.
    }
    throw new Error('Unable to write the normalized terminal result.', { cause: error });
  }
  return result;
}

module.exports = {
  ASSERTION_OUTCOMES,
  LIFECYCLE_STAGES,
  PROCESS_OUTCOMES,
  TERMINAL_OUTCOMES,
  TERMINAL_RESULT_SCHEMA_VERSION,
  createTerminalResult,
  projectLifecycleStage,
  summarizePlaywrightAssertions,
  validateTerminalResult,
  writeTerminalResult,
};
