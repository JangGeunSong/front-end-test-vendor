const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_WORKSPACE_RELATIVE_ROOT = path.join(
  'tools',
  'ai-generator',
  'generated',
  'mvp-runs',
);

const RUN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

const RUN_WORKSPACE_PATH_OWNERSHIP = Object.freeze({
  artifactManifest: 'internal metadata',
  status: 'public-candidate result',
  scoutResult: 'intermediate',
  menuMap: 'intermediate',
  pageProfileTree: 'intermediate',
  pageProfileCache: 'intermediate',
  navigationPlan: 'intermediate',
  analysisReviewJson: 'review',
  analysisReviewMarkdown: 'review',
  interactionApprovals: 'input',
  reconciliation: 'intermediate',
  interactionPlan: 'intermediate',
  navigationSpec: 'executable spec',
  interactionSpec: 'executable spec',
  playwrightJsonReport: 'raw execution output',
  playwrightHtmlReportIndex: 'raw execution output',
});

function isPathContained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function validateRunId(runId) {
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new TypeError('Run ID must be a non-empty string.');
  }
  if (!RUN_ID_PATTERN.test(runId) || runId.includes('..') || WINDOWS_RESERVED_NAME.test(runId)) {
    throw new Error('Run ID must use 1-128 lowercase ASCII letters, digits, dots, hyphens, or underscores without traversal or reserved names.');
  }
  return runId;
}

function createRunWorkspace({ repositoryRoot, runId, workspaceRoot } = {}) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
    throw new TypeError('repositoryRoot must be a non-empty string.');
  }
  validateRunId(runId);

  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const resolvedWorkspaceRoot = workspaceRoot
    ? path.resolve(resolvedRepositoryRoot, workspaceRoot)
    : path.join(resolvedRepositoryRoot, DEFAULT_WORKSPACE_RELATIVE_ROOT);
  if (resolvedWorkspaceRoot === resolvedRepositoryRoot || !isPathContained(resolvedRepositoryRoot, resolvedWorkspaceRoot)) {
    throw new Error('workspaceRoot must be a child of repositoryRoot.');
  }

  const root = path.join(resolvedWorkspaceRoot, runId);
  const analysisDir = path.join(root, 'analysis');
  const reviewDir = path.join(root, 'review');
  const approvalDir = path.join(root, 'approval');
  const planDir = path.join(root, 'plan');
  const executionDir = path.join(root, 'execution');
  const specDir = path.join(executionDir, 'specs');
  const testResultsDir = path.join(executionDir, 'test-results');
  const reportDir = path.join(root, 'report');
  const playwrightHtmlReportDir = path.join(reportDir, 'playwright-html');
  const paths = Object.freeze({
    artifactManifest: path.join(root, 'artifact-manifest.json'),
    status: path.join(root, 'status.json'),
    scoutResult: path.join(analysisDir, 'scout_result.json'),
    menuMap: path.join(analysisDir, 'menu_map.json'),
    pageProfileTree: path.join(analysisDir, 'primary_menu_tree_for_profiles.json'),
    pageProfileCache: path.join(analysisDir, 'page_profile_cache.json'),
    navigationPlan: path.join(analysisDir, 'test_plan.generated.json'),
    analysisReviewJson: path.join(reviewDir, 'analysis_review_report.json'),
    analysisReviewMarkdown: path.join(reviewDir, 'analysis_review_report.md'),
    interactionApprovals: path.join(approvalDir, 'interaction_approvals.json'),
    reconciliation: path.join(approvalDir, 'interaction_approval_reconciliation.json'),
    interactionPlan: path.join(planDir, 'interaction_plan.generated.json'),
    navigationSpec: path.join(specDir, 'generated_from_plan.spec.js'),
    interactionSpec: path.join(specDir, 'generated_interaction_plan.spec.js'),
    playwrightJsonReport: path.join(reportDir, 'playwright-results.json'),
    playwrightHtmlReportIndex: path.join(playwrightHtmlReportDir, 'index.html'),
  });
  const directoryEntries = Object.freeze([
    ['root', root],
    ['analysisDir', analysisDir],
    ['reviewDir', reviewDir],
    ['approvalDir', approvalDir],
    ['planDir', planDir],
    ['executionDir', executionDir],
    ['specDir', specDir],
    ['testResultsDir', testResultsDir],
    ['reportDir', reportDir],
    ['playwrightHtmlReportDir', playwrightHtmlReportDir],
  ].map(([name, directory]) => Object.freeze({ name, path: directory })));
  const directories = Object.freeze(directoryEntries.map((entry) => entry.path));

  for (const candidate of [...directories, ...Object.values(paths)]) {
    if (!isPathContained(root, candidate)) throw new Error('Run workspace path escaped its run root.');
  }

  return Object.freeze({
    runId,
    repositoryRoot: resolvedRepositoryRoot,
    workspaceRoot: resolvedWorkspaceRoot,
    root,
    analysisDir,
    reviewDir,
    approvalDir,
    planDir,
    executionDir,
    specDir,
    testResultsDir,
    reportDir,
    playwrightHtmlReportDir,
    directoryEntries,
    directories,
    paths,
  });
}

function ensureRunWorkspace(workspace) {
  if (!workspace || !Array.isArray(workspace.directories) || !Array.isArray(workspace.directoryEntries)) {
    throw new TypeError('A run workspace contract is required.');
  }
  let repositoryRealPath;
  let workspaceRealPath;
  for (const [index, entry] of workspace.directoryEntries.entries()) {
    const directory = entry.path;
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (index === 0) {
        repositoryRealPath = fs.realpathSync(workspace.repositoryRoot);
        workspaceRealPath = fs.realpathSync(workspace.workspaceRoot);
        if (!isPathContained(repositoryRealPath, workspaceRealPath)) {
          throw new Error('workspace root resolves outside repository root');
        }
      }
      const directoryRealPath = fs.realpathSync(directory);
      if (!isPathContained(workspaceRealPath, directoryRealPath)) {
        throw new Error('directory resolves outside workspace root');
      }
    } catch (error) {
      throw new Error(`Unable to create run workspace directory ${entry.name}.`, { cause: error });
    }
  }
  return workspace;
}

module.exports = {
  DEFAULT_WORKSPACE_RELATIVE_ROOT,
  RUN_WORKSPACE_PATH_OWNERSHIP,
  createRunWorkspace,
  ensureRunWorkspace,
  isPathContained,
  validateRunId,
};
