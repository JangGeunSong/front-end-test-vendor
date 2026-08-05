const fs = require('node:fs');
const path = require('node:path');
const {
  RUN_WORKSPACE_PATH_OWNERSHIP,
  isPathContained,
  validateRunId,
} = require('./run-workspace');

const ARTIFACT_MANIFEST_SCHEMA_VERSION = '1.0';

const ARTIFACT_IDS = Object.freeze({
  RUN_STATUS: 'run.status',
  SCOUT_RESULT: 'analysis.scout-result',
  MENU_MAP: 'analysis.menu-map',
  NAVIGATION_PLAN: 'analysis.navigation-plan',
  ANALYSIS_REVIEW_JSON: 'review.analysis-report-json',
  ANALYSIS_REVIEW_MARKDOWN: 'review.analysis-report-markdown',
  INTERACTION_APPROVALS: 'approval.interaction-approvals',
  RECONCILIATION: 'approval.reconciliation',
  INTERACTION_PLAN: 'plan.interaction-plan',
  NAVIGATION_SPEC: 'execution.navigation-spec',
  INTERACTION_SPEC: 'execution.interaction-spec',
  TEST_RESULTS: 'execution.test-results',
  PLAYWRIGHT_JSON: 'report.playwright-json',
  PLAYWRIGHT_HTML: 'report.playwright-html',
});

const ARTIFACT_PRODUCERS = Object.freeze([
  'run-controller',
  'analysis-orchestrator',
  'navigation-plan-builder',
  'navigation-renderer',
  'analysis-review-builder',
  'analysis-review-renderer',
  'approval-writer',
  'approval-reconciler',
  'interaction-plan-builder',
  'interaction-renderer',
  'playwright-runner',
]);

const REQUIREMENTS = Object.freeze(['required', 'conditional', 'optional']);
const PRESENCES = Object.freeze(['present', 'missing', 'empty']);
const SENSITIVITIES = Object.freeze(['internal', 'target-derived', 'potentially-sensitive']);
const PUBLIC_ELIGIBILITIES = Object.freeze(['never', 'review-required', 'eligible']);
const CONDITIONS = Object.freeze([
  'analysis-started',
  'analysis-succeeded',
  'interaction-approved',
  'execution-started',
]);

const DEFINITION_TEMPLATES = Object.freeze([
  definition(ARTIFACT_IDS.RUN_STATUS, 'status', 'file', 'run-controller', 'application/json', 'required', null, 'potentially-sensitive', 'never'),
  definition(ARTIFACT_IDS.SCOUT_RESULT, 'scoutResult', 'file', 'analysis-orchestrator', 'application/json', 'conditional', 'analysis-started', 'potentially-sensitive', 'never'),
  definition(ARTIFACT_IDS.MENU_MAP, 'menuMap', 'file', 'analysis-orchestrator', 'application/json', 'conditional', 'analysis-started', 'potentially-sensitive', 'never'),
  definition(ARTIFACT_IDS.NAVIGATION_PLAN, 'navigationPlan', 'file', 'navigation-plan-builder', 'application/json', 'conditional', 'analysis-succeeded', 'target-derived', 'never'),
  definition(ARTIFACT_IDS.ANALYSIS_REVIEW_JSON, 'analysisReviewJson', 'file', 'analysis-review-builder', 'application/json', 'conditional', 'analysis-succeeded', 'target-derived', 'review-required'),
  definition(ARTIFACT_IDS.ANALYSIS_REVIEW_MARKDOWN, 'analysisReviewMarkdown', 'file', 'analysis-review-renderer', 'text/markdown', 'conditional', 'analysis-succeeded', 'target-derived', 'review-required'),
  definition(ARTIFACT_IDS.INTERACTION_APPROVALS, 'interactionApprovals', 'file', 'approval-writer', 'application/json', 'conditional', 'interaction-approved', 'potentially-sensitive', 'never'),
  definition(ARTIFACT_IDS.RECONCILIATION, 'reconciliation', 'file', 'approval-reconciler', 'application/json', 'conditional', 'interaction-approved', 'target-derived', 'never'),
  definition(ARTIFACT_IDS.INTERACTION_PLAN, 'interactionPlan', 'file', 'interaction-plan-builder', 'application/json', 'conditional', 'interaction-approved', 'target-derived', 'never'),
  definition(ARTIFACT_IDS.NAVIGATION_SPEC, 'navigationSpec', 'file', 'navigation-renderer', 'text/javascript', 'conditional', 'analysis-succeeded', 'target-derived', 'never'),
  definition(ARTIFACT_IDS.INTERACTION_SPEC, 'interactionSpec', 'file', 'interaction-renderer', 'text/javascript', 'conditional', 'interaction-approved', 'target-derived', 'never'),
  directoryDefinition(ARTIFACT_IDS.TEST_RESULTS, 'testResultsDir', 'playwright-runner', 'optional', 'potentially-sensitive', 'never'),
  definition(ARTIFACT_IDS.PLAYWRIGHT_JSON, 'playwrightJsonReport', 'file', 'playwright-runner', 'application/json', 'conditional', 'execution-started', 'potentially-sensitive', 'never'),
  directoryDefinition(ARTIFACT_IDS.PLAYWRIGHT_HTML, 'playwrightHtmlReportDir', 'playwright-runner', 'optional', 'potentially-sensitive', 'never'),
]);

function definition(artifactId, workspaceKey, artifactType, producer, mediaType, requirement, condition, sensitivity, publicEligibility) {
  return Object.freeze({
    artifactId,
    workspaceKey,
    artifactType,
    producer,
    mediaType,
    requirement,
    condition,
    sensitivity,
    publicEligibility,
  });
}

function directoryDefinition(artifactId, workspaceKey, producer, requirement, sensitivity, publicEligibility) {
  return definition(artifactId, workspaceKey, 'directory', producer, null, requirement, null, sensitivity, publicEligibility);
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

function relativePathIsSafe(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) return false;
  const segments = value.split('/');
  return !segments.includes('..') && !segments.includes('.') && !segments.includes('') && path.posix.normalize(value) === value;
}

function workspacePath(workspace, template) {
  if (template.artifactType === 'file' && !Object.hasOwn(RUN_WORKSPACE_PATH_OWNERSHIP, template.workspaceKey)) {
    throw new Error(`Artifact path ${template.workspaceKey} has no workspace ownership declaration.`);
  }
  return template.artifactType === 'directory'
    ? workspace[template.workspaceKey]
    : workspace.paths[template.workspaceKey];
}

function workspaceRelativePath(workspace, absolutePath) {
  if (!isPathContained(workspace.root, absolutePath)) {
    throw new Error('Artifact path must remain inside the run workspace.');
  }
  const relativePath = normalizeRelativePath(path.relative(workspace.root, absolutePath));
  if (!relativePathIsSafe(relativePath)) throw new Error('Artifact path must be a safe workspace-relative path.');
  return relativePath;
}

function createArtifactDefinitions(workspace) {
  requireWorkspace(workspace);
  return DEFINITION_TEMPLATES.map((template) => Object.freeze({
    artifactId: template.artifactId,
    relativePath: workspaceRelativePath(workspace, workspacePath(workspace, template)),
    artifactType: template.artifactType,
    producer: template.producer,
    mediaType: template.mediaType,
    requirement: template.requirement,
    condition: template.condition,
    sensitivity: template.sensitivity,
    publicEligibility: template.publicEligibility,
  }));
}

function requireWorkspace(workspace) {
  if (!workspace || typeof workspace.root !== 'string' || typeof workspace.repositoryRoot !== 'string' || !workspace.paths) {
    throw new TypeError('A run workspace contract is required.');
  }
  validateRunId(workspace.runId);
}

function artifactPresence(absolutePath, artifactType, fsImpl) {
  if (!fsImpl.existsSync(absolutePath)) return { presence: 'missing', sizeBytes: null };
  const realWorkspaceType = fsImpl.statSync(absolutePath);
  if (artifactType === 'directory') {
    if (!realWorkspaceType.isDirectory()) return { presence: 'present', sizeBytes: null };
    return {
      presence: fsImpl.readdirSync(absolutePath).length === 0 ? 'empty' : 'present',
      sizeBytes: null,
    };
  }
  return {
    presence: 'present',
    sizeBytes: realWorkspaceType.isFile() ? realWorkspaceType.size : null,
  };
}

function assertExistingPathContained(workspace, absolutePath, fsImpl) {
  if (!fsImpl.existsSync(absolutePath)) return;
  const workspaceRealPath = fsImpl.realpathSync(workspace.root);
  const artifactRealPath = fsImpl.realpathSync(absolutePath);
  if (!isPathContained(workspaceRealPath, artifactRealPath)) {
    throw new Error('Artifact resolves outside the run workspace.');
  }
}

function createArtifactManifest(workspace, options = {}) {
  requireWorkspace(workspace);
  const fsImpl = options.fsImpl || fs;
  const clock = options.clock || (() => new Date());
  const generatedAtValue = clock();
  const generatedAt = generatedAtValue instanceof Date
    ? generatedAtValue.toISOString()
    : new Date(generatedAtValue).toISOString();
  const artifacts = createArtifactDefinitions(workspace).map((artifact, index) => {
    const absolutePath = workspacePath(workspace, DEFINITION_TEMPLATES[index]);
    assertExistingPathContained(workspace, absolutePath, fsImpl);
    const snapshot = artifactPresence(absolutePath, artifact.artifactType, fsImpl);
    return Object.freeze({ ...artifact, ...snapshot });
  });
  return Object.freeze({
    schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
    runId: workspace.runId,
    workspaceRelativeRoot: workspaceRelativePathFromRepository(workspace),
    generatedAt,
    artifacts: Object.freeze(artifacts),
  });
}

function workspaceRelativePathFromRepository(workspace) {
  if (!isPathContained(workspace.repositoryRoot, workspace.root)) {
    throw new Error('Run workspace must remain inside the repository.');
  }
  return normalizeRelativePath(path.relative(workspace.repositoryRoot, workspace.root));
}

function validateArtifactManifest(manifest, options = {}) {
  const errors = [];
  const workspace = options.workspace;
  const checkFilesystem = options.checkFilesystem === true;
  const fsImpl = options.fsImpl || fs;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['Manifest must be an object.'];
  if (manifest.schemaVersion !== ARTIFACT_MANIFEST_SCHEMA_VERSION) errors.push('Unsupported artifact manifest schemaVersion.');
  try {
    validateRunId(manifest.runId);
  } catch {
    errors.push('Manifest runId is invalid.');
  }
  if (!relativePathIsSafe(manifest.workspaceRelativeRoot)) errors.push('workspaceRelativeRoot must be a safe relative path.');
  if (typeof manifest.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) errors.push('generatedAt must be an ISO timestamp.');
  if (!Array.isArray(manifest.artifacts)) return [...errors, 'artifacts must be an array.'];

  const knownIds = new Set(Object.values(ARTIFACT_IDS));
  const seenIds = new Set();
  const expectedDefinitions = workspace ? createArtifactDefinitions(workspace) : null;
  for (const [index, artifact] of manifest.artifacts.entries()) {
    const prefix = `artifacts[${index}]`;
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      errors.push(`${prefix} must be an object.`);
      continue;
    }
    if (!knownIds.has(artifact.artifactId)) errors.push(`${prefix}.artifactId is unknown.`);
    if (seenIds.has(artifact.artifactId)) errors.push(`${prefix}.artifactId is duplicated.`);
    seenIds.add(artifact.artifactId);
    if (artifact.artifactId !== DEFINITION_TEMPLATES[index]?.artifactId) errors.push(`${prefix} is not in deterministic artifact ID order.`);
    if (!relativePathIsSafe(artifact.relativePath)) errors.push(`${prefix}.relativePath must be safe and normalized.`);
    if (!['file', 'directory'].includes(artifact.artifactType)) errors.push(`${prefix}.artifactType is invalid.`);
    if (!ARTIFACT_PRODUCERS.includes(artifact.producer)) errors.push(`${prefix}.producer is invalid.`);
    if (artifact.artifactType === 'file' && (typeof artifact.mediaType !== 'string' || artifact.mediaType.length === 0)) errors.push(`${prefix}.mediaType is required for files.`);
    if (artifact.artifactType === 'directory' && artifact.mediaType !== null) errors.push(`${prefix}.mediaType must be null for directories.`);
    if (!REQUIREMENTS.includes(artifact.requirement)) errors.push(`${prefix}.requirement is invalid.`);
    if (artifact.requirement === 'conditional' && !CONDITIONS.includes(artifact.condition)) errors.push(`${prefix}.condition is invalid.`);
    if (artifact.requirement !== 'conditional' && artifact.condition !== null) errors.push(`${prefix}.condition must be null unless conditional.`);
    if (!PRESENCES.includes(artifact.presence)) errors.push(`${prefix}.presence is invalid.`);
    if (!SENSITIVITIES.includes(artifact.sensitivity)) errors.push(`${prefix}.sensitivity is invalid.`);
    if (!PUBLIC_ELIGIBILITIES.includes(artifact.publicEligibility)) errors.push(`${prefix}.publicEligibility is invalid.`);
    if (artifact.artifactType === 'file' && artifact.presence === 'present') {
      if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) errors.push(`${prefix}.sizeBytes is invalid.`);
    } else if (artifact.sizeBytes !== null) {
      errors.push(`${prefix}.sizeBytes must be null for missing or directory artifacts.`);
    }
    if (expectedDefinitions) {
      const expected = expectedDefinitions[index];
      if (!expected || artifact.relativePath !== expected.relativePath) errors.push(`${prefix}.relativePath does not match the workspace contract.`);
      if (expected && ['artifactType', 'producer', 'mediaType', 'requirement', 'condition', 'sensitivity', 'publicEligibility']
        .some((key) => artifact[key] !== expected[key])) errors.push(`${prefix} metadata does not match its artifact definition.`);
    }
  }
  if (manifest.artifacts.length !== DEFINITION_TEMPLATES.length) errors.push('Manifest must contain every registered artifact exactly once.');

  if (workspace) {
    if (manifest.runId !== workspace.runId) errors.push('Manifest runId does not match the workspace.');
    if (manifest.workspaceRelativeRoot !== workspaceRelativePathFromRepository(workspace)) errors.push('workspaceRelativeRoot does not match the workspace.');
    for (const [index, artifact] of manifest.artifacts.entries()) {
      if (!relativePathIsSafe(artifact?.relativePath)) continue;
      const absolutePath = path.resolve(workspace.root, ...artifact.relativePath.split('/'));
      if (!isPathContained(workspace.root, absolutePath)) {
        errors.push(`artifacts[${index}] resolves outside the workspace.`);
        continue;
      }
      if (!checkFilesystem) continue;
      try {
        assertExistingPathContained(workspace, absolutePath, fsImpl);
        validateFilesystemSnapshot(artifact, absolutePath, fsImpl, errors, index);
      } catch (error) {
        errors.push(`artifacts[${index}] filesystem validation failed: ${error.message}`);
      }
    }
  }
  return errors;
}

function validateFilesystemSnapshot(artifact, absolutePath, fsImpl, errors, index) {
  const exists = fsImpl.existsSync(absolutePath);
  if (artifact.presence === 'missing') {
    if (exists) errors.push(`artifacts[${index}] is marked missing but exists.`);
    return;
  }
  if (!exists) {
    errors.push(`artifacts[${index}] is marked ${artifact.presence} but is missing.`);
    return;
  }
  const stat = fsImpl.statSync(absolutePath);
  if (artifact.artifactType === 'file' && !stat.isFile()) errors.push(`artifacts[${index}] must resolve to a file.`);
  if (artifact.artifactType === 'directory' && !stat.isDirectory()) errors.push(`artifacts[${index}] must resolve to a directory.`);
  if (artifact.artifactType === 'directory') {
    const empty = stat.isDirectory() && fsImpl.readdirSync(absolutePath).length === 0;
    if (artifact.presence === 'empty' && !empty) errors.push(`artifacts[${index}] is marked empty but contains files.`);
    if (artifact.presence === 'present' && empty) errors.push(`artifacts[${index}] is marked present but is empty.`);
  }
  if (artifact.artifactType === 'file' && stat.isFile() && artifact.sizeBytes !== stat.size) {
    errors.push(`artifacts[${index}].sizeBytes does not match the file.`);
  }
}

function writeArtifactManifest(workspace, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const manifest = createArtifactManifest(workspace, options);
  const errors = validateArtifactManifest(manifest, { workspace, checkFilesystem: true, fsImpl });
  if (errors.length > 0) throw new Error(`Artifact manifest validation failed: ${errors.join(' ')}`);
  const destination = workspace.paths.artifactManifest;
  const temporary = `${destination}.tmp`;
  try {
    fsImpl.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fsImpl.renameSync(temporary, destination);
  } catch (error) {
    try {
      if (fsImpl.existsSync(temporary)) fsImpl.rmSync(temporary, { force: true });
    } catch {
      // Preserve the primary write error; cleanup is best effort.
    }
    throw new Error('Unable to write the run artifact manifest.', { cause: error });
  }
  return manifest;
}

module.exports = {
  ARTIFACT_IDS,
  ARTIFACT_MANIFEST_SCHEMA_VERSION,
  ARTIFACT_PRODUCERS,
  createArtifactDefinitions,
  createArtifactManifest,
  validateArtifactManifest,
  writeArtifactManifest,
};
