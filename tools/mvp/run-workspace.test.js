const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RUN_WORKSPACE_PATH_OWNERSHIP,
  createRunWorkspace,
  ensureRunWorkspace,
  validateRunId,
} = require('./run-workspace');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const TEST_WORKSPACE_ROOT = path.join(
  REPOSITORY_ROOT,
  'tools',
  'ai-generator',
  'generated',
  'workspace-contract-tests',
);

function uniqueRunId(label) {
  return `${Date.now()}-${process.pid}-${label}`;
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

test('creates the expected deterministic run workspace and directories', (t) => {
  const runId = uniqueRunId('normal');
  const first = createRunWorkspace({ repositoryRoot: REPOSITORY_ROOT, workspaceRoot: TEST_WORKSPACE_ROOT, runId });
  const second = createRunWorkspace({ repositoryRoot: REPOSITORY_ROOT, workspaceRoot: TEST_WORKSPACE_ROOT, runId });
  t.after(() => fs.rmSync(first.root, { recursive: true, force: true }));

  assert.deepEqual(first, second);
  assert.equal(first.paths.scoutResult, path.join(first.analysisDir, 'scout_result.json'));
  assert.equal(first.paths.artifactManifest, path.join(first.root, 'artifact-manifest.json'));
  assert.equal(first.paths.terminalResult, path.join(first.root, 'terminal-result.json'));
  assert.equal(first.paths.navigationSpec, path.join(first.specDir, 'generated_from_plan.spec.js'));
  assert.equal(first.paths.playwrightHtmlReportIndex, path.join(first.playwrightHtmlReportDir, 'index.html'));
  assert.equal(ensureRunWorkspace(first), first);
  for (const directory of first.directories) assert.equal(fs.statSync(directory).isDirectory(), true);
});

test('isolates different run IDs physically and logically', (t) => {
  const first = createRunWorkspace({ repositoryRoot: REPOSITORY_ROOT, workspaceRoot: TEST_WORKSPACE_ROOT, runId: uniqueRunId('a') });
  const second = createRunWorkspace({ repositoryRoot: REPOSITORY_ROOT, workspaceRoot: TEST_WORKSPACE_ROOT, runId: uniqueRunId('b') });
  t.after(() => {
    fs.rmSync(first.root, { recursive: true, force: true });
    fs.rmSync(second.root, { recursive: true, force: true });
  });
  ensureRunWorkspace(first);
  ensureRunWorkspace(second);
  fs.writeFileSync(first.paths.scoutResult, '{"run":"a"}\n', 'utf8');

  assert.notEqual(first.root, second.root);
  for (const firstPath of Object.values(first.paths)) {
    assert.equal(Object.values(second.paths).includes(firstPath), false);
  }
  assert.equal(fs.existsSync(second.paths.scoutResult), false);
});

test('rejects empty, traversal, separators, absolute forms, uppercase, and Windows reserved run IDs', () => {
  for (const value of ['', '..', '../escape', 'safe/escape', 'safe\\escape', '/absolute', 'C:\\absolute', 'run..escape', 'Run-A', 'con', 'nul.json']) {
    assert.throws(() => validateRunId(value));
  }
  assert.equal(validateRunId('1720000000000-abcdef12'), '1720000000000-abcdef12');
});

test('keeps workspace roots and every output within repository and run containment', () => {
  const workspace = createRunWorkspace({ repositoryRoot: REPOSITORY_ROOT, runId: uniqueRunId('containment') });
  assert.equal(contained(REPOSITORY_ROOT, workspace.workspaceRoot), true);
  for (const candidate of [...workspace.directories, ...Object.values(workspace.paths)]) {
    assert.equal(contained(workspace.root, candidate), true);
  }
  assert.throws(() => createRunWorkspace({
    repositoryRoot: REPOSITORY_ROOT,
    workspaceRoot: path.resolve(REPOSITORY_ROOT, '..', 'outside'),
    runId: uniqueRunId('outside'),
  }), /child of repositoryRoot/);
});

test('ensure is idempotent and preserves an existing artifact without global mutation', (t) => {
  const cwd = process.cwd();
  const environment = { ...process.env };
  const workspace = createRunWorkspace({ repositoryRoot: REPOSITORY_ROOT, workspaceRoot: TEST_WORKSPACE_ROOT, runId: uniqueRunId('idempotent') });
  t.after(() => fs.rmSync(workspace.root, { recursive: true, force: true }));
  ensureRunWorkspace(workspace);
  fs.writeFileSync(workspace.paths.status, 'preserve', 'utf8');
  ensureRunWorkspace(workspace);

  assert.equal(fs.readFileSync(workspace.paths.status, 'utf8'), 'preserve');
  assert.equal(process.cwd(), cwd);
  assert.deepEqual({ ...process.env }, environment);
});

test('reports directory creation failure and leaves another run intact', (t) => {
  const blocked = createRunWorkspace({ repositoryRoot: REPOSITORY_ROOT, workspaceRoot: TEST_WORKSPACE_ROOT, runId: uniqueRunId('blocked') });
  const healthy = createRunWorkspace({ repositoryRoot: REPOSITORY_ROOT, workspaceRoot: TEST_WORKSPACE_ROOT, runId: uniqueRunId('healthy') });
  t.after(() => {
    fs.rmSync(blocked.root, { recursive: true, force: true });
    fs.rmSync(healthy.root, { recursive: true, force: true });
  });
  ensureRunWorkspace(healthy);
  fs.mkdirSync(blocked.root, { recursive: true });
  fs.writeFileSync(blocked.analysisDir, 'blocks directory creation', 'utf8');

  assert.throws(() => ensureRunWorkspace(blocked), /directory analysisDir/);
  assert.equal(fs.statSync(healthy.analysisDir).isDirectory(), true);
});

test('declares ownership for every artifact and control file path', () => {
  const workspace = createRunWorkspace({ repositoryRoot: REPOSITORY_ROOT, runId: uniqueRunId('ownership') });
  assert.deepEqual(Object.keys(RUN_WORKSPACE_PATH_OWNERSHIP).sort(), Object.keys(workspace.paths).sort());
});
