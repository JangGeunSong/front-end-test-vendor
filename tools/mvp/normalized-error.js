const fs = require('node:fs');
const path = require('node:path');
const { MAX_INVOCATION_TIMEOUT_MS, TERMINATION_METHODS } = require('./engine-invocation');
const { LIFECYCLE_STAGES } = require('./lifecycle-stage');
const { isPathContained, validateRunId } = require('./run-workspace');

const NORMALIZED_ERROR_SCHEMA_VERSION = '1.1';
const ERROR_CATEGORIES = Object.freeze([
  'user',
  'target',
  'engine-contract',
  'infrastructure',
  'internal',
]);
const ERROR_RETRYABILITY = Object.freeze(['never', 'conditional', 'unknown']);
const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_TARGET_URL: 'INVALID_TARGET_URL',
  WORKSPACE_PROVISION_FAILED: 'WORKSPACE_PROVISION_FAILED',
  DEPENDENCY_EXECUTABLE_UNAVAILABLE: 'DEPENDENCY_EXECUTABLE_UNAVAILABLE',
  DEPENDENCY_PYTHON_UNAVAILABLE: 'DEPENDENCY_PYTHON_UNAVAILABLE',
  DEPENDENCY_BROWSER_UNAVAILABLE: 'DEPENDENCY_BROWSER_UNAVAILABLE',
  TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE',
  PROCESS_SPAWN_FAILED: 'PROCESS_SPAWN_FAILED',
  ENGINE_DEADLINE_EXCEEDED: 'ENGINE_DEADLINE_EXCEEDED',
  PROCESS_TERMINATED: 'PROCESS_TERMINATED',
  PROCESS_EXIT_NONZERO: 'PROCESS_EXIT_NONZERO',
  ANALYSIS_FAILED: 'ANALYSIS_FAILED',
  ARTIFACT_MISSING: 'ARTIFACT_MISSING',
  ARTIFACT_INVALID: 'ARTIFACT_INVALID',
  APPROVAL_INVALID: 'APPROVAL_INVALID',
  APPROVAL_EVIDENCE_CHANGED: 'APPROVAL_EVIDENCE_CHANGED',
  APPROVAL_CANDIDATE_MISSING: 'APPROVAL_CANDIDATE_MISSING',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
  PLAN_BUILD_FAILED: 'PLAN_BUILD_FAILED',
  SPEC_RENDER_FAILED: 'SPEC_RENDER_FAILED',
  EXECUTION_PROCESS_FAILED: 'EXECUTION_PROCESS_FAILED',
  REPORT_MISSING: 'REPORT_MISSING',
  REPORT_INVALID: 'REPORT_INVALID',
  FILESYSTEM_READ_FAILED: 'FILESYSTEM_READ_FAILED',
  FILESYSTEM_WRITE_FAILED: 'FILESYSTEM_WRITE_FAILED',
  INTERNAL_UNEXPECTED: 'INTERNAL_UNEXPECTED',
});

const ERROR_CODE_REGISTRY = Object.freeze({
  [ERROR_CODES.INVALID_REQUEST]: definition('user', 'never', 'The request could not be accepted.'),
  [ERROR_CODES.INVALID_TARGET_URL]: definition('user', 'never', 'Enter a valid credential-free HTTP(S) URL.'),
  [ERROR_CODES.WORKSPACE_PROVISION_FAILED]: definition('infrastructure', 'conditional', 'The run workspace could not be prepared.'),
  [ERROR_CODES.DEPENDENCY_EXECUTABLE_UNAVAILABLE]: definition('infrastructure', 'conditional', 'A required runtime executable is unavailable.'),
  [ERROR_CODES.DEPENDENCY_PYTHON_UNAVAILABLE]: definition('infrastructure', 'conditional', 'A required analysis dependency is unavailable.'),
  [ERROR_CODES.DEPENDENCY_BROWSER_UNAVAILABLE]: definition('infrastructure', 'conditional', 'The browser runtime required for this run is unavailable.'),
  [ERROR_CODES.TARGET_UNAVAILABLE]: definition('target', 'conditional', 'The target website is unavailable from the execution environment.'),
  [ERROR_CODES.PROCESS_SPAWN_FAILED]: definition('infrastructure', 'conditional', 'A required run process could not be started.'),
  [ERROR_CODES.ENGINE_DEADLINE_EXCEEDED]: definition('infrastructure', 'conditional', 'The engine invocation exceeded its allowed execution time.'),
  [ERROR_CODES.PROCESS_TERMINATED]: definition('infrastructure', 'conditional', 'A required run process ended unexpectedly.'),
  [ERROR_CODES.PROCESS_EXIT_NONZERO]: definition('infrastructure', 'unknown', 'A required run process did not complete successfully.'),
  [ERROR_CODES.ANALYSIS_FAILED]: definition('engine-contract', 'unknown', 'The website analysis could not be completed.'),
  [ERROR_CODES.ARTIFACT_MISSING]: definition('engine-contract', 'unknown', 'A required run artifact is missing.'),
  [ERROR_CODES.ARTIFACT_INVALID]: definition('engine-contract', 'unknown', 'A required run artifact is invalid.'),
  [ERROR_CODES.APPROVAL_INVALID]: definition('user', 'never', 'The interaction approval could not be accepted.'),
  [ERROR_CODES.APPROVAL_EVIDENCE_CHANGED]: definition('user', 'never', 'The reviewed interaction evidence has changed.'),
  [ERROR_CODES.APPROVAL_CANDIDATE_MISSING]: definition('user', 'never', 'The approved interaction is no longer present.'),
  [ERROR_CODES.RECONCILIATION_FAILED]: definition('engine-contract', 'unknown', 'The interaction approval could not be reconciled.'),
  [ERROR_CODES.PLAN_BUILD_FAILED]: definition('engine-contract', 'unknown', 'The interaction execution plan could not be prepared.'),
  [ERROR_CODES.SPEC_RENDER_FAILED]: definition('engine-contract', 'unknown', 'The executable interaction specification could not be prepared.'),
  [ERROR_CODES.EXECUTION_PROCESS_FAILED]: definition('infrastructure', 'conditional', 'The browser test execution could not be completed.'),
  [ERROR_CODES.REPORT_MISSING]: definition('engine-contract', 'unknown', 'The generated execution report is missing.'),
  [ERROR_CODES.REPORT_INVALID]: definition('engine-contract', 'unknown', 'The generated execution report could not be read.'),
  [ERROR_CODES.FILESYSTEM_READ_FAILED]: definition('infrastructure', 'conditional', 'A required run file could not be read.'),
  [ERROR_CODES.FILESYSTEM_WRITE_FAILED]: definition('infrastructure', 'conditional', 'A required run file could not be written.'),
  [ERROR_CODES.INTERNAL_UNEXPECTED]: definition('internal', 'unknown', 'The run could not be completed because of an unexpected internal error.'),
});

const ERROR_SOURCES = Object.freeze([
  'request',
  'workspace',
  'engine-process',
  'analysis-orchestrator',
  'approval',
  'plan',
  'playwright',
  'report',
  'artifact-manifest',
  'terminal-result',
  'controller',
]);
const ERROR_OPERATIONS = Object.freeze([
  'validate-request',
  'validate-target',
  'provision-workspace',
  'spawn-process',
  'run-analysis',
  'build-review',
  'validate-approval',
  'reconcile-approval',
  'build-plan',
  'render-spec',
  'execute-tests',
  'read-report',
  'read-artifact',
  'write-artifact',
  'write-manifest',
  'write-terminal-result',
  'finalize-run',
]);
const MANIFEST_STATUSES = Object.freeze(['valid', 'invalid', 'unavailable']);
const REPORT_STATUSES = Object.freeze(['missing', 'malformed', 'unavailable']);
const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion', 'runId', 'category', 'code', 'stage', 'retryability',
  'userMessage', 'diagnostic', 'occurredAt',
]);
const DIAGNOSTIC_KEYS = Object.freeze([
  'source', 'operation', 'processExitCode', 'signaled', 'artifactId',
  'manifestStatus', 'reportStatus', 'timeoutMs', 'forcedTermination',
  'terminationMethod',
]);
const FORBIDDEN_FIELDS = new Set([
  'stack', 'stdout', 'stderr', 'command', 'args', 'cwd', 'environment',
  'absolutePath', 'rawUrl', 'requestBody', 'rawException', 'cause',
]);

function definition(category, retryability, userMessage) {
  return Object.freeze({ category, retryability, userMessage });
}

function rawOutput(input) {
  const result = input.invocationResult || input.cause?.result || {};
  return `${result.stderr || ''}\n${result.stdout || ''}`;
}

function classifyError(input = {}) {
  const result = input.invocationResult || input.cause?.result || {};
  const message = typeof input.cause?.message === 'string' ? input.cause.message : '';
  const output = rawOutput(input);
  const stage = input.stage;
  let code = Object.values(ERROR_CODES).includes(input.code) ? input.code : null;

  if (!code && (result.timedOut === true || input.timedOut === true)) code = ERROR_CODES.ENGINE_DEADLINE_EXCEEDED;
  if (!code && input.operation === 'validate-request') code = ERROR_CODES.INVALID_REQUEST;
  if (!code && (input.operation === 'validate-target' || /^URL validation failed:/.test(message))) code = ERROR_CODES.INVALID_TARGET_URL;
  if (!code && input.operation === 'provision-workspace') code = ERROR_CODES.WORKSPACE_PROVISION_FAILED;
  if (!code && /Executable doesn't exist|browserType\.launch.*executable/i.test(output)) code = ERROR_CODES.DEPENDENCY_BROWSER_UNAVAILABLE;
  if (!code && /ModuleNotFoundError|No module named/.test(output)) code = ERROR_CODES.DEPENDENCY_PYTHON_UNAVAILABLE;
  if (!code && /ERR_(?:NAME_NOT_RESOLVED|CONNECTION_REFUSED|CONNECTION_TIMED_OUT|NETWORK_ACCESS_DENIED)|net::ERR_|getaddrinfo|ENETUNREACH/i.test(output)) code = ERROR_CODES.TARGET_UNAVAILABLE;
  if (!code && output.includes('evidenceChanged')) code = ERROR_CODES.APPROVAL_EVIDENCE_CHANGED;
  if (!code && output.includes('missingCandidate')) code = ERROR_CODES.APPROVAL_CANDIDATE_MISSING;
  if (!code && input.reportStatus === 'missing') code = ERROR_CODES.REPORT_MISSING;
  if (!code && input.reportStatus === 'malformed') code = ERROR_CODES.REPORT_INVALID;
  if (!code && input.operation === 'read-report' && input.cause?.code === 'ENOENT') code = ERROR_CODES.REPORT_MISSING;
  if (!code && input.operation === 'read-report') code = ERROR_CODES.REPORT_INVALID;
  if (!code && (input.cause?.code === 'ENOENT' || /\bENOENT\b/.test(message))) code = ERROR_CODES.DEPENDENCY_EXECUTABLE_UNAVAILABLE;
  if (!code && (input.cause?.code === 'EACCES' || input.cause?.code === 'EPERM' || input.spawnError)) code = ERROR_CODES.PROCESS_SPAWN_FAILED;
  if (!code && (result.signal || input.signaled === true)) code = ERROR_CODES.PROCESS_TERMINATED;
  if (!code) {
    code = ({
      analysis: ERROR_CODES.ANALYSIS_FAILED,
      approval: ERROR_CODES.APPROVAL_INVALID,
      reconciliation: ERROR_CODES.RECONCILIATION_FAILED,
      plan: input.operation === 'render-spec' ? ERROR_CODES.SPEC_RENDER_FAILED : ERROR_CODES.PLAN_BUILD_FAILED,
      execution: ERROR_CODES.EXECUTION_PROCESS_FAILED,
      report: ERROR_CODES.REPORT_INVALID,
    })[stage] || (Number.isInteger(result.code ?? result.exitCode)
      ? ERROR_CODES.PROCESS_EXIT_NONZERO
      : ERROR_CODES.INTERNAL_UNEXPECTED);
  }

  const descriptor = ERROR_CODE_REGISTRY[code];
  const source = ERROR_SOURCES.includes(input.source) ? input.source : 'controller';
  const operation = ERROR_OPERATIONS.includes(input.operation) ? input.operation : 'finalize-run';
  const exitCode = result.code ?? result.exitCode ?? input.processExitCode;
  const signaled = Boolean(result.signal || input.signaled === true);
  const timeoutMs = result.timeoutMs ?? input.timeoutMs;
  const termination = result.termination || input.termination || {};
  return Object.freeze({
    category: descriptor.category,
    code,
    stage,
    retryability: descriptor.retryability,
    userMessage: descriptor.userMessage,
    diagnostic: Object.freeze({
      source,
      operation,
      processExitCode: Number.isInteger(exitCode) && exitCode >= 0 ? exitCode : null,
      signaled,
      artifactId: typeof input.artifactId === 'string' ? input.artifactId : null,
      manifestStatus: MANIFEST_STATUSES.includes(input.manifestStatus) ? input.manifestStatus : null,
      reportStatus: REPORT_STATUSES.includes(input.reportStatus) ? input.reportStatus : null,
      timeoutMs: Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : null,
      forcedTermination: termination.forced === true || input.forcedTermination === true,
      terminationMethod: TERMINATION_METHODS.includes(termination.method || input.terminationMethod)
        ? (termination.method || input.terminationMethod)
        : null,
    }),
  });
}

function createNormalizedError(input, options = {}) {
  validateRunId(input?.runId);
  if (!LIFECYCLE_STAGES.includes(input.stage)) throw new Error('Normalized error stage is invalid.');
  const classification = classifyError(input);
  const clock = options.clock || (() => new Date());
  const occurredAtValue = clock();
  const occurredAt = occurredAtValue instanceof Date
    ? occurredAtValue.toISOString()
    : new Date(occurredAtValue).toISOString();
  const normalizedError = Object.freeze({
    schemaVersion: NORMALIZED_ERROR_SCHEMA_VERSION,
    runId: input.runId,
    category: classification.category,
    code: classification.code,
    stage: classification.stage,
    retryability: classification.retryability,
    userMessage: classification.userMessage,
    diagnostic: classification.diagnostic,
    occurredAt,
  });
  const errors = validateNormalizedError(normalizedError);
  if (errors.length > 0) throw new Error(`Normalized error validation failed: ${errors.join(' ')}`);
  return normalizedError;
}

function validateNormalizedError(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Normalized error must be an object.'];
  validateExactKeys(value, TOP_LEVEL_KEYS, 'normalized error', errors);
  if (value.schemaVersion !== NORMALIZED_ERROR_SCHEMA_VERSION) errors.push('Unsupported normalized error schemaVersion.');
  try { validateRunId(value.runId); } catch { errors.push('Normalized error runId is invalid.'); }
  if (!ERROR_CATEGORIES.includes(value.category)) errors.push('Normalized error category is invalid.');
  if (!Object.values(ERROR_CODES).includes(value.code)) errors.push('Normalized error code is invalid.');
  if (ERROR_CODE_REGISTRY[value.code]?.category !== value.category) errors.push('Normalized error category/code pair is invalid.');
  if (!LIFECYCLE_STAGES.includes(value.stage)) errors.push('Normalized error stage is invalid.');
  if (!ERROR_RETRYABILITY.includes(value.retryability)) errors.push('Normalized error retryability is invalid.');
  if (ERROR_CODE_REGISTRY[value.code]?.retryability !== value.retryability) errors.push('Normalized error code/retryability pair is invalid.');
  validateUserMessage(value.userMessage, errors);
  validateDiagnostic(value.diagnostic, errors);
  if (value.code === ERROR_CODES.ENGINE_DEADLINE_EXCEEDED) {
    if (value.diagnostic?.timeoutMs === null) errors.push('Timeout error requires diagnostic.timeoutMs.');
    if (value.diagnostic?.terminationMethod === null) errors.push('Timeout error requires diagnostic.terminationMethod.');
  } else if (value.diagnostic && (value.diagnostic.timeoutMs !== null
      || value.diagnostic.forcedTermination !== false || value.diagnostic.terminationMethod !== null)) {
    errors.push('Non-timeout error cannot contain timeout diagnostics.');
  }
  if (typeof value.occurredAt !== 'string' || Number.isNaN(Date.parse(value.occurredAt))) errors.push('occurredAt must be an ISO timestamp.');
  for (const key of Object.keys(value)) if (FORBIDDEN_FIELDS.has(key)) errors.push(`Forbidden field ${key}.`);
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

function validateUserMessage(message, errors) {
  if (typeof message !== 'string' || message.length === 0 || message.length > 240) {
    errors.push('userMessage must be a non-empty bounded string.');
    return;
  }
  if (/\r|\n/.test(message)) errors.push('userMessage must be one line.');
  if (/[A-Za-z]:[\\/]|(?:^|\s)\/(?:Users|home|var|tmp)\//.test(message)) errors.push('userMessage must not contain an absolute local path.');
  if (/sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|token|password)\s*[:=]/i.test(message)) errors.push('userMessage must not contain secret-like content.');
}

function validateDiagnostic(diagnostic, errors) {
  if (!validateExactKeys(diagnostic, DIAGNOSTIC_KEYS, 'diagnostic', errors)) return;
  if (!ERROR_SOURCES.includes(diagnostic.source)) errors.push('diagnostic.source is invalid.');
  if (!ERROR_OPERATIONS.includes(diagnostic.operation)) errors.push('diagnostic.operation is invalid.');
  if (diagnostic.processExitCode !== null && (!Number.isInteger(diagnostic.processExitCode) || diagnostic.processExitCode < 0)) errors.push('diagnostic.processExitCode is invalid.');
  if (typeof diagnostic.signaled !== 'boolean') errors.push('diagnostic.signaled must be boolean.');
  if (diagnostic.artifactId !== null && !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(diagnostic.artifactId)) errors.push('diagnostic.artifactId is invalid.');
  if (diagnostic.manifestStatus !== null && !MANIFEST_STATUSES.includes(diagnostic.manifestStatus)) errors.push('diagnostic.manifestStatus is invalid.');
  if (diagnostic.reportStatus !== null && !REPORT_STATUSES.includes(diagnostic.reportStatus)) errors.push('diagnostic.reportStatus is invalid.');
  if (diagnostic.timeoutMs !== null && (!Number.isSafeInteger(diagnostic.timeoutMs)
      || diagnostic.timeoutMs <= 0 || diagnostic.timeoutMs > MAX_INVOCATION_TIMEOUT_MS)) errors.push('diagnostic.timeoutMs is invalid.');
  if (typeof diagnostic.forcedTermination !== 'boolean') errors.push('diagnostic.forcedTermination must be boolean.');
  if (diagnostic.terminationMethod !== null && !TERMINATION_METHODS.includes(diagnostic.terminationMethod)) errors.push('diagnostic.terminationMethod is invalid.');
  for (const key of Object.keys(diagnostic)) if (FORBIDDEN_FIELDS.has(key)) errors.push(`Forbidden diagnostic field ${key}.`);
}

function writeNormalizedError(input, options = {}) {
  const workspace = input?.workspace;
  const normalizedError = input?.normalizedError || createNormalizedError(input, options);
  if (!workspace?.paths?.normalizedError) throw new TypeError('A normalized-error workspace path is required.');
  const validationErrors = validateNormalizedError(normalizedError);
  if (validationErrors.length > 0) throw new Error(`Normalized error validation failed: ${validationErrors.join(' ')}`);
  if (normalizedError.runId !== workspace.runId) throw new Error('Normalized error runId does not match the workspace.');
  const destination = workspace.paths.normalizedError;
  if (!isPathContained(workspace.root, destination)) throw new Error('Normalized error path escaped the run workspace.');
  const fsImpl = options.fsImpl || fs;
  const temporary = `${destination}.tmp`;
  try {
    fsImpl.writeFileSync(temporary, `${JSON.stringify(normalizedError, null, 2)}\n`, 'utf8');
    fsImpl.renameSync(temporary, destination);
  } catch (error) {
    try {
      if (fsImpl.existsSync(temporary)) fsImpl.rmSync(temporary, { force: true });
    } catch {
      // Preserve the primary write error; cleanup is best effort.
    }
    throw new Error('Unable to write the normalized error.', { cause: error });
  }
  return normalizedError;
}

module.exports = {
  ERROR_CATEGORIES,
  ERROR_CODE_REGISTRY,
  ERROR_CODES,
  ERROR_OPERATIONS,
  ERROR_RETRYABILITY,
  ERROR_SOURCES,
  NORMALIZED_ERROR_SCHEMA_VERSION,
  classifyError,
  createNormalizedError,
  validateNormalizedError,
  writeNormalizedError,
};
