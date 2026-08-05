const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ARTIFACT_IDS,
  ARTIFACT_MANIFEST_SCHEMA_VERSION,
  createArtifactDefinitions,
  createArtifactManifest,
  validateArtifactManifest,
  writeArtifactManifest,
} = require('./artifact-manifest');
const {
  analyzeRun,
  createRun,
  publicRun,
} = require('./controller');
const { createRunWorkspace, ensureRunWorkspace } = require('./run-workspace');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const TEST_WORKSPACE_ROOT = path.join(
  REPOSITORY_ROOT,
  'tools',
  'ai-generator',
  'generated',
  'artifact-manifest-tests',
);
const FIXED_TIME = new Date('2026-08-05T00:00:00.000Z');

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

function artifact(manifest, artifactId) {
  return manifest.artifacts.find((entry) => entry.artifactId === artifactId);
}

function mutableManifest(manifest) {
  return JSON.parse(JSON.stringify(manifest));
}

test('creates an initial deterministic, workspace-relative manifest snapshot', (t) => {
  const workspace = workspaceFor(t, 'initial');
  const first = createArtifactManifest(workspace, { clock: () => FIXED_TIME });
  const second = createArtifactManifest(workspace, { clock: () => FIXED_TIME });

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, ARTIFACT_MANIFEST_SCHEMA_VERSION);
  assert.equal(first.runId, workspace.runId);
  assert.deepEqual(
    first.artifacts.map((entry) => entry.artifactId),
    createArtifactDefinitions(workspace).map((entry) => entry.artifactId),
  );
  assert.equal(artifact(first, ARTIFACT_IDS.RUN_STATUS).presence, 'missing');
  assert.equal(artifact(first, ARTIFACT_IDS.SCOUT_RESULT).presence, 'missing');
  assert.equal(artifact(first, ARTIFACT_IDS.TEST_RESULTS).presence, 'empty');
  assert.equal(artifact(first, ARTIFACT_IDS.PLAYWRIGHT_HTML).presence, 'empty');
  assert.equal(first.artifacts.some((entry) => entry.relativePath === 'artifact-manifest.json'), false);
  assert.deepEqual(validateArtifactManifest(first, { workspace, checkFilesystem: true }), []);
});

test('snapshots present files and non-empty directories without changing artifact metadata', (t) => {
  const workspace = workspaceFor(t, 'present');
  fs.writeFileSync(workspace.paths.status, '{"status":"created"}\n', 'utf8');
  fs.writeFileSync(workspace.paths.scoutResult, '{"pageProfiles":[]}\n', 'utf8');
  fs.writeFileSync(path.join(workspace.testResultsDir, 'trace.zip'), 'trace', 'utf8');
  fs.writeFileSync(workspace.paths.playwrightHtmlReportIndex, '<html></html>', 'utf8');
  const manifest = createArtifactManifest(workspace, { clock: () => FIXED_TIME });

  const status = artifact(manifest, ARTIFACT_IDS.RUN_STATUS);
  assert.equal(status.presence, 'present');
  assert.equal(status.sizeBytes, fs.statSync(workspace.paths.status).size);
  assert.equal(status.mediaType, 'application/json');
  assert.equal(status.producer, 'run-controller');
  assert.equal(artifact(manifest, ARTIFACT_IDS.TEST_RESULTS).presence, 'present');
  assert.equal(artifact(manifest, ARTIFACT_IDS.PLAYWRIGHT_HTML).artifactType, 'directory');
  assert.equal(artifact(manifest, ARTIFACT_IDS.PLAYWRIGHT_HTML).mediaType, null);
  assert.deepEqual(validateArtifactManifest(manifest, { workspace, checkFilesystem: true }), []);
});

test('represents a partial run without treating downstream missing artifacts as invalid', (t) => {
  const workspace = workspaceFor(t, 'partial');
  fs.writeFileSync(workspace.paths.status, '{}\n', 'utf8');
  fs.writeFileSync(workspace.paths.scoutResult, '{}\n', 'utf8');
  const manifest = createArtifactManifest(workspace, { clock: () => FIXED_TIME });

  assert.equal(artifact(manifest, ARTIFACT_IDS.SCOUT_RESULT).presence, 'present');
  assert.equal(artifact(manifest, ARTIFACT_IDS.NAVIGATION_PLAN).presence, 'missing');
  assert.equal(artifact(manifest, ARTIFACT_IDS.PLAYWRIGHT_JSON).presence, 'missing');
  assert.deepEqual(validateArtifactManifest(manifest, { workspace, checkFilesystem: true }), []);
});

test('registers the complete optional interaction chain when its artifacts exist', (t) => {
  const workspace = workspaceFor(t, 'interaction');
  for (const output of [
    workspace.paths.interactionApprovals,
    workspace.paths.reconciliation,
    workspace.paths.interactionPlan,
  ]) fs.writeFileSync(output, '{}\n', 'utf8');
  fs.writeFileSync(workspace.paths.interactionSpec, '// interaction\n', 'utf8');
  const manifest = createArtifactManifest(workspace, { clock: () => FIXED_TIME });

  for (const id of [
    ARTIFACT_IDS.INTERACTION_APPROVALS,
    ARTIFACT_IDS.RECONCILIATION,
    ARTIFACT_IDS.INTERACTION_PLAN,
    ARTIFACT_IDS.INTERACTION_SPEC,
  ]) {
    assert.equal(artifact(manifest, id).presence, 'present');
    assert.equal(artifact(manifest, id).requirement, 'conditional');
    assert.equal(artifact(manifest, id).condition, 'interaction-approved');
  }
});

test('isolates manifest identity and presence between run workspaces', (t) => {
  const first = workspaceFor(t, 'run-a');
  const second = workspaceFor(t, 'run-b');
  fs.writeFileSync(first.paths.scoutResult, '{"run":"a"}\n', 'utf8');
  const firstManifest = createArtifactManifest(first, { clock: () => FIXED_TIME });
  const secondManifest = createArtifactManifest(second, { clock: () => FIXED_TIME });

  assert.notEqual(firstManifest.workspaceRelativeRoot, secondManifest.workspaceRelativeRoot);
  assert.equal(artifact(firstManifest, ARTIFACT_IDS.SCOUT_RESULT).presence, 'present');
  assert.equal(artifact(secondManifest, ARTIFACT_IDS.SCOUT_RESULT).presence, 'missing');
});

test('serializes no absolute paths, drive paths, or backslashes', (t) => {
  const workspace = workspaceFor(t, 'portable');
  const serialized = JSON.stringify(createArtifactManifest(workspace, { clock: () => FIXED_TIME }));

  assert.equal(serialized.includes(REPOSITORY_ROOT), false);
  assert.equal(/[A-Za-z]:\\/.test(serialized), false);
  assert.equal(serialized.includes('\\'), false);
});

test('rejects traversal, absolute paths, duplicate IDs, and non-deterministic ordering', (t) => {
  const workspace = workspaceFor(t, 'invalid-paths');
  const baseline = createArtifactManifest(workspace, { clock: () => FIXED_TIME });
  for (const invalidPath of ['../escape.json', '/absolute.json', 'C:/absolute.json', 'analysis\\escape.json']) {
    const invalid = mutableManifest(baseline);
    invalid.artifacts[0].relativePath = invalidPath;
    assert.match(validateArtifactManifest(invalid, { workspace }).join(' '), /relativePath/);
  }
  const duplicate = mutableManifest(baseline);
  duplicate.artifacts[1].artifactId = duplicate.artifacts[0].artifactId;
  assert.match(validateArtifactManifest(duplicate).join(' '), /duplicated/);
  const reordered = mutableManifest(baseline);
  [reordered.artifacts[0], reordered.artifacts[1]] = [reordered.artifacts[1], reordered.artifacts[0]];
  assert.match(validateArtifactManifest(reordered).join(' '), /deterministic/);
});

test('rejects invalid entry enums and file-directory mismatches', (t) => {
  const workspace = workspaceFor(t, 'invalid-entry');
  fs.writeFileSync(workspace.paths.status, '{}\n', 'utf8');
  const baseline = createArtifactManifest(workspace, { clock: () => FIXED_TIME });
  for (const [field, invalidValue] of [
    ['artifactType', 'blob'],
    ['producer', 'unknown-producer'],
    ['requirement', 'sometimes'],
    ['presence', 'unknown'],
    ['sensitivity', 'public'],
    ['publicEligibility', 'always'],
  ]) {
    const invalid = mutableManifest(baseline);
    invalid.artifacts[0][field] = invalidValue;
    assert.ok(validateArtifactManifest(invalid, { workspace }).length > 0, field);
  }

  fs.rmSync(workspace.paths.status);
  fs.mkdirSync(workspace.paths.status);
  assert.match(
    validateArtifactManifest(baseline, { workspace, checkFilesystem: true }).join(' '),
    /must resolve to a file/,
  );
});

test('writes parseable stable JSON with a trailing newline and replaces atomically', (t) => {
  const workspace = workspaceFor(t, 'write');
  fs.writeFileSync(workspace.paths.status, '{}\n', 'utf8');
  writeArtifactManifest(workspace, { clock: () => FIXED_TIME });
  writeArtifactManifest(workspace, { clock: () => FIXED_TIME });
  const contents = fs.readFileSync(workspace.paths.artifactManifest, 'utf8');
  const parsed = JSON.parse(contents);

  assert.equal(contents.endsWith('\n'), true);
  assert.equal(fs.existsSync(`${workspace.paths.artifactManifest}.tmp`), false);
  assert.deepEqual(validateArtifactManifest(parsed, { workspace, checkFilesystem: true }), []);
});

test('controller creates and refreshes the manifest after successful analysis without API exposure', async (t) => {
  const run = createRun('https://example.test/', {
    runId: uniqueRunId('controller-success'),
    workspaceRoot: TEST_WORKSPACE_ROOT,
  });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
  assert.equal(fs.existsSync(run.workspace.paths.artifactManifest), true);
  assert.equal(artifact(JSON.parse(fs.readFileSync(run.workspace.paths.artifactManifest)), ARTIFACT_IDS.RUN_STATUS).presence, 'present');

  await analyzeRun(run, {
    runCommandImpl: async (_run, label) => {
      if (label === 'website analysis and navigation plan') {
        fs.writeFileSync(run.workspace.paths.scoutResult, '{}\n');
        fs.writeFileSync(run.workspace.paths.menuMap, '{}\n');
        fs.writeFileSync(run.workspace.paths.navigationPlan, JSON.stringify({ schemaVersion: '1.0', targetUrl: run.url, tests: [] }));
        fs.writeFileSync(run.workspace.paths.navigationSpec, '// generated\n');
      } else if (label === 'interaction discovery') {
        fs.writeFileSync(run.workspace.paths.analysisReviewJson, JSON.stringify({
          version: '2.1',
          summary: { targetUrl: run.url },
          generatedNavigationTests: [],
          pageIdentityAssertions: [],
          safeInteractionCandidates: [],
          unsafeActionCandidates: [],
          unresolvedCandidates: [],
        }));
      } else {
        fs.writeFileSync(run.workspace.paths.analysisReviewMarkdown, '# Review\n');
      }
      return { code: 0, signal: null, stdout: '', stderr: '' };
    },
  });
  const finalManifest = JSON.parse(fs.readFileSync(run.workspace.paths.artifactManifest, 'utf8'));
  assert.equal(artifact(finalManifest, ARTIFACT_IDS.NAVIGATION_PLAN).presence, 'present');
  assert.equal(artifact(finalManifest, ARTIFACT_IDS.ANALYSIS_REVIEW_MARKDOWN).presence, 'present');
  assert.equal(Object.hasOwn(publicRun(run), 'artifactManifest'), false);
});

test('controller refreshes a partial manifest after analysis failure and treats manifest write errors as secondary', async (t) => {
  const run = createRun('https://example.test/', {
    runId: uniqueRunId('controller-failure'),
    workspaceRoot: TEST_WORKSPACE_ROOT,
  });
  t.after(() => fs.rmSync(run.workspace.root, { recursive: true, force: true }));
  await analyzeRun(run, {
    runCommandImpl: async () => {
      fs.writeFileSync(run.workspace.paths.scoutResult, '{}\n');
      throw new Error('analysis stopped');
    },
  });
  const manifest = JSON.parse(fs.readFileSync(run.workspace.paths.artifactManifest, 'utf8'));
  assert.equal(run.status, 'failed');
  assert.equal(artifact(manifest, ARTIFACT_IDS.SCOUT_RESULT).presence, 'present');
  assert.equal(artifact(manifest, ARTIFACT_IDS.NAVIGATION_PLAN).presence, 'missing');

  const secondary = createRun('https://example.test/', {
    runId: uniqueRunId('manifest-secondary'),
    workspaceRoot: TEST_WORKSPACE_ROOT,
    writeArtifactManifestImpl: () => { throw new Error('manifest unavailable'); },
  });
  t.after(() => fs.rmSync(secondary.workspace.root, { recursive: true, force: true }));
  assert.equal(secondary.status, 'created');
  assert.equal(fs.existsSync(secondary.workspace.paths.status), true);
  assert.equal(fs.existsSync(secondary.workspace.paths.artifactManifest), false);
  assert.equal(Object.hasOwn(publicRun(secondary), 'artifactManifest'), false);
});

test('raw artifacts remain ineligible for direct public exposure and globals are unchanged', (t) => {
  const cwd = process.cwd();
  const environment = { ...process.env };
  const workspace = workspaceFor(t, 'policy');
  const manifest = createArtifactManifest(workspace, { clock: () => FIXED_TIME });

  for (const id of [
    ARTIFACT_IDS.SCOUT_RESULT,
    ARTIFACT_IDS.MENU_MAP,
    ARTIFACT_IDS.NAVIGATION_SPEC,
    ARTIFACT_IDS.TEST_RESULTS,
    ARTIFACT_IDS.PLAYWRIGHT_JSON,
    ARTIFACT_IDS.PLAYWRIGHT_HTML,
  ]) assert.equal(artifact(manifest, id).publicEligibility, 'never');
  assert.equal(manifest.artifacts.some((entry) => entry.publicEligibility === 'eligible'), false);
  assert.equal(process.cwd(), cwd);
  assert.deepEqual({ ...process.env }, environment);
});
