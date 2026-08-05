# Hosted MVP Migration Backlog

## Purpose

This backlog turns the observed boundaries in [Hosted MVP Engine Boundary](HOSTED_MVP_ENGINE_BOUNDARY.md) into independently implementable work. It does not select a production framework, database, queue, cloud, container or storage product. Items preserve existing engine contracts unless an acceptance criterion explicitly says otherwise.

Priority meanings:

- `P0`: Hosted foundation blocker
- `P1`: Hosted analysis trial
- `P2`: Interaction trial
- `P3`: Public operation

## Recommended First Work

**HMV-001 through HMV-004 are complete.** Continue with **HMV-005** to attach a normalized error classification to the internal terminal result while preserving current Local recovery messages and private diagnostics.

## P0 — Hosted Foundation Blockers

### HMV-001 — Extract engine invocation adapter

- **Status:** Completed on 2026-08-05.

- **Objective:** Wrap current command construction/execution behind request/response objects and dependency-injected process runner.
- **Rationale:** `controller.js` currently mixes HTTP-neutral application logic with subprocess details.
- **Source boundary:** `controller.js: runCommand`, `analyzeRun`, `approveRun`, `executeRun`.
- **Scope:** framework-free adapter; target URL, deterministic mode, bounded execution options, workspace/path input; exit/stdout/stderr/stage result; Local controller delegation.
- **Explicit non-scope:** path migration, Hosted API, dispatcher, schema changes, new dependency.
- **Dependencies:** none.
- **Acceptance criteria:** Local API/UI behavior unchanged; exact existing command arguments/defaults preserved; adapter has no HTTP/framework import; process runner is injectable; structured result distinguishes spawn and nonzero exit.
- **Required tests:** command construction including the current navigation validator arguments, env allow/override behavior characterization, success/nonzero/spawn failure, existing controller/product tests.
- **Migration risk:** medium; error wording/status drift.
- **Recommended commit size:** one adapter module, focused tests, controller delegation only.

Implementation result:

- `tools/mvp/engine-invocation.js` exports `createEngineInvocationRequest` and `invokeEngineProcess` as CommonJS, framework-free functions.
- The request contract is `{ command, args, cwd, env }`. `env` is copied over the inherited parent environment, with explicit overrides taking precedence; neither input object nor `process.env` is mutated.
- The raw result contract is `{ command, args, cwd, exitCode, signal, stdout, stderr, spawnError }`. It keeps spawn failure, non-zero exit and signal termination distinct and never returns the environment.
- Every direct child process previously launched by Local `controller.js:runCommand` now delegates through the adapter. The compatibility wrapper retains existing rejection, `allowFailure`, debug-log and friendly-error behavior.
- Focused tests cover success, non-zero exit, spawn failure followed by close, signal termination, chunked output, environment copying/override/no-result-exposure and synchronous spawn failure. Controller characterization fixes the deterministic analysis executable, argument ordering, repository cwd and UTF-8 environment overrides.
- Acceptance criteria passed: Local API/UI behavior and command defaults are unchanged; no HTTP/framework or new dependency was introduced; the runner is injectable; spawn and non-zero outcomes remain distinguishable.

HMV-001 completion snapshot and HMV-002 handoff (historical):

- The adapter already accepts an explicit `cwd` and a complete invocation request, so HMV-002 can bind job-scoped paths without changing process execution or controller error compatibility again.
- A `workspace` field was intentionally not added before a real path map exists. HMV-002 should define the validated workspace/path contract and pass its paths through existing command arguments, cwd and bounded environment overrides.
- Fixed generated paths, copy-after-shared-output, root `test-results`, process-local state/queue and inherited full environment remain unchanged.
- The Local deterministic orchestrator still omits optional navigation validator `--menu-map`; this known behavior was characterized but not changed in HMV-001.

### HMV-002 — Introduce job-scoped workspace path contract

- **Status:** Completed on 2026-08-05 with the Local deterministic pipeline migrated to run-scoped paths. Full concurrent execution remains an HMV-008 claim, not an HMV-002 claim.

- **Objective:** Define one validated workspace/path map for every run artifact.
- **Rationale:** current engine writes shared scout/menu/plan/spec/temp/output paths.
- **Pre-implementation source boundary:** orchestrator path constants, `createRun`, former `copyFreshArtifacts`, Playwright config/output.
- **Scope:** logical path names, containment checks, unique workspace creation, path injection design; migrate one coherent pipeline slice at a time.
- **Explicit non-scope:** storage vendor, retention, distributed worker.
- **Dependencies:** HMV-001.
- **Acceptance criteria:** two workspace maps have no writable overlap; no output escapes workspace; existing Local paths can be supplied by compatibility adapter; raw artifacts are not committed.
- **Required tests:** uniqueness, traversal/reparse protection as applicable, concurrent path allocation, Local compatibility.
- **Migration risk:** high; renderer imports and Playwright `testDir` assumptions.
- **Recommended commit size:** contract/factory first, then separate commits for analysis outputs and Playwright outputs.

Implementation result:

- `tools/mvp/run-workspace.js` exports `validateRunId`, `createRunWorkspace`, `ensureRunWorkspace`, `RUN_WORKSPACE_PATH_OWNERSHIP` and `DEFAULT_WORKSPACE_RELATIVE_ROOT`.
- The contract maps each run to `analysis/`, `review/`, `approval/`, `plan/`, `execution/specs/`, `execution/test-results/` and `report/playwright-html/` below `tools/ai-generator/generated/mvp-runs/<runId>/`.
- Run IDs accept 1–128 lowercase ASCII letters/digits plus internal `.`, `_`, `-`; separators, absolute forms, `..`, uppercase/case aliases, edge punctuation and Windows reserved device names are rejected. Lexical containment and real-path containment prevent repository/workspace escape and existing reparse-point redirection.
- `createRun` creates the workspace before registering the run. Provisioning failure reaches the request error path and does not insert a partial run into the in-memory Map or alter another run.
- `agent_orchestrator.py` keeps legacy defaults but accepts `--generated-dir` and `--navigation-spec-output`. The Local controller supplies workspace paths, so scout result, menu map, profile-tree temp, disabled Local cache path, navigation plan and navigation spec no longer pass through shared output/copy paths.
- `render_test_plan.py` computes helper imports relative to the requested output location. Its default `tests/generated/` output remains byte-shape compatible while workspace specs remain executable without absolute imports.
- Playwright keeps repository-root `cwd` and its repository config, while controller-provided `MVP_PLAYWRIGHT_TEST_DIR` and `MVP_PLAYWRIGHT_OUTPUT_DIR` isolate spec discovery and traces/screenshots/video. Existing JSON/HTML reporter variables now point inside the same workspace; Local report URL behavior is unchanged.
- Focused tests cover deterministic maps, physical A/B separation, traversal/reserved inputs, repository and real-path containment, idempotent ensure/no deletion, no cwd/environment mutation, provisioning failure isolation, orchestrator default/override compatibility, output-relative renderer imports, controller path binding and Playwright path projection.

Migration classification:

| Class | HMV-002 result |
| --- | --- |
| `MOVE_NOW` | Local deterministic scout/menu/profile temp/navigation plan, review JSON/Markdown, approval/reconciliation/interaction plan, navigation/interaction specs, Playwright JSON/HTML and `test-results` attachments are canonical workspace outputs. |
| `ADAPT_NOW` | Standalone orchestrator/renderer and Playwright commands retain their fixed default paths when no override is supplied; Local controller always supplies the workspace override. Compatibility is one-way through defaults, not file synchronization. |
| `DEFER` | Legacy direct-LLM `spec` output, manual `llm-plan`/comparison defaults, cache sharing policy, default review/reconciliation files and any non-controller CLI overlap remain follow-up concerns. The known optional navigation validator `--menu-map` omission is unchanged. |
| `LOCAL_ONLY` | `npm run report`, raw Local report serving, fixture/debug commands and developer artifact browsing remain Local tools. |

Acceptance and HMV-003 handoff:

- Two synthetic maps and physical artifacts have no writable overlap, every contract output remains below its run root, raw files remain ignored/untracked, and default CLI behavior remains compatible.
- HMV-002 is a **full path migration for the current Local deterministic controller path**, but not proof of multi-process/concurrent-run correctness. The process-global queue remains intentionally unchanged pending lifecycle/dispatcher and HMV-008 barrier-based characterization.
- HMV-003 should consume `workspace.paths`, directory roles and `RUN_WORKSPACE_PATH_OWNERSHIP`, emit only workspace-relative entries, represent optional interaction/report artifacts explicitly, and add sensitivity/public-eligibility metadata. It must not expose the absolute workspace object or raw HTML as a public result.

### HMV-003 — Produce artifact manifest

- **Status:** Completed on 2026-08-05. The manifest is an internal workspace contract and is not exposed by the Local API or report endpoint.

- **Objective:** Emit a manifest of expected and produced artifacts by logical role.
- **Rationale:** paths and sensitivity are implicit mutable run properties today.
- **Source boundary:** `persist`, HMV-002 workspace paths/ownership, execute-stage produced/missing artifacts.
- **Scope:** logical name, relative path, media type, producer stage, existence/status, size, sensitivity/public eligibility.
- **Explicit non-scope:** object storage upload, public URLs, retention implementation.
- **Dependencies:** HMV-002.
- **Acceptance criteria:** manifest contains navigation, review, optional approval/interaction, result/report and attachment groups; all paths are workspace-relative; missing optional artifacts are explicit.
- **Required tests:** navigation-only and interaction manifests, missing report, path containment, deterministic projection where applicable.
- **Migration risk:** low/medium; accidental raw-artifact exposure.
- **Recommended commit size:** additive manifest writer/projector and fixtures.

Implementation result:

- `tools/mvp/artifact-manifest.js` defines manifest schema `1.0`, stable namespaced artifact IDs, canonical producer/policy metadata, filesystem snapshotting, validation and same-directory temporary-write/rename persistence.
- `tools/mvp/run-workspace.js` now owns `artifact-manifest.json`; the manifest intentionally omits itself to avoid self-reference. Serialized paths are repository/workspace-relative with `/`, never absolute local paths.
- Entries record `file`/`directory`, explicit media type (`null` for directories), `required`/`conditional`/`optional`, condition where applicable, `present`/`missing`/`empty`, file size, sensitivity and `never`/`review-required` public eligibility. Missing downstream artifacts are a valid snapshot, not a lifecycle error.
- Controller refresh points are workspace creation after `status.json`, analysis success/failure, approval success/failure and execution success/failure. A manifest write failure is a secondary diagnostic: it does not replace an existing run result, and a later lifecycle refresh can retry.
- Raw scout/menu data, approvals, generated specs, Playwright JSON/HTML and attachments are never directly public-eligible. Review JSON/Markdown is `review-required`; no current artifact is automatically `eligible`. This metadata does not perform redaction or public projection.

Registration result:

| Class | Artifact IDs / result |
| --- | --- |
| `REGISTER_NOW` | `run.status`, `analysis.scout-result`, `analysis.menu-map`, `analysis.navigation-plan`, `review.analysis-report-json`, `review.analysis-report-markdown`, `execution.navigation-spec`. |
| `REGISTER_OPTIONAL` | `approval.interaction-approvals`, `approval.reconciliation`, `plan.interaction-plan`, `execution.interaction-spec`, `execution.test-results`, `report.playwright-json`, `report.playwright-html`. Conditional and optional artifacts remain listed when missing or empty. |
| `DEFER` | Transient `primary_menu_tree_for_profiles.json`, disabled Local `page_profile_cache.json`, per-file trace/screenshot/video enumeration, manual/LLM/default-path artifacts and temporary manifest write files. |
| `LOCAL_ONLY` | Raw report serving/opening, developer artifact browsing, fixture/debug commands and manual review files. The registered raw HTML directory remains private even though the Local report endpoint consumes it. |

Acceptance and HMV-004 handoff:

- Focused tests cover initial/partial/present snapshots, A/B isolation, absolute-path leakage, traversal, duplicate/order/enum failures, strict file/directory checks, atomic replacement, conservative public policy and no global mutation.
- Controller tests prove initial, success and failure manifests while preserving `publicRun`; existing adapter/workspace/product regressions remain green.
- HMV-004 should consume this validated manifest by logical artifact ID. It must not infer terminal semantics from `presence` alone or turn `publicEligibility` into an artifact-serving decision.

### HMV-004 — Define normalized terminal result boundary

- **Status:** Completed on 2026-08-05. The result is an internal workspace control artifact and is not exposed by the Local API/UI.

- **Objective:** Separate system terminal outcome from navigation/interaction test outcome.
- **Rationale:** current `completed/failed`, `overall PASS/FAIL`, report failure and skipped interaction meanings overlap.
- **Source boundary:** `summarizePlaywrightResult`, analyze/execute catches, stage state.
- **Scope:** internal request/response contract proposal and adapter implementation preserving current Local response projection.
- **Explicit non-scope:** public API version, persistence product, UI redesign.
- **Dependencies:** HMV-001; coordinate with HMV-003.
- **Acceptance criteria:** assertion FAIL, engine contract failure, infrastructure failure, skipped interaction and missing report are distinct; Local result remains backward compatible.
- **Required tests:** existing summary fixtures plus invalid reporter JSON, browser crash with/without JSON, report missing, stage failure.
- **Migration risk:** medium; consumer interpretation.
- **Recommended commit size:** pure projector/types and compatibility mapping.

Implementation result:

- `tools/mvp/terminal-result.js` defines independent schema `1.0`, lifecycle/process/assertion/result-availability normalization, strict validation and atomic persistence at `<run-root>/terminal-result.json`.
- Outcomes are `succeeded`, `completed-with-test-failures`, `partially-succeeded` and `failed`. A non-zero Playwright exit with a parseable assertion report is a completed process plus separate failed/mixed assertions, not an infrastructure failure.
- Lifecycle stages are `created`, `analysis`, `review`, `approval`, `reconciliation`, `plan`, `execution`, `report`. `lastCompletedStage` uses controller stage success; `failedStage` uses the first failed controller stage projected to this stable ordering. Artifact presence is supporting evidence, not the lifecycle source.
- Process summary contains only attempted/outcome/exit-code/signaled state. Execution summary contains attempted, assertion outcome and stable test counts; command, environment, stdout/stderr, stack and raw failures are excluded.
- Manifest connection records relative path, schema/status/validity, present/missing/empty counts and `available`/`partial`/`unavailable` internal result availability. Missing or invalid manifest is diagnostic and does not rewrite the run outcome.
- The terminal result remains outside the artifact manifest to avoid manifest/result finalization cycles. Controller order is terminal status persistence, manifest refresh, terminal result projection/write.

Current terminal-path normalization:

| Current path | Normalized result |
| --- | --- |
| Analysis success / `ready_for_execution` | Non-terminal; no result file. This includes no-candidate and approval-not-yet-run states. |
| Analysis failure before review | `failed`, failed stage `analysis`, execution/assertions `not-run`, result unavailable. |
| Analysis/review succeeded then reconciliation/plan/render/process/report failure | `partially-succeeded` when structured review/result remains; exact failed stage retained. |
| Playwright launch/process failure | process `failed`, assertion `unavailable`; run stays current `failed`. |
| Parseable Playwright report with assertion failures | process `succeeded`, assertion `failed` or `mixed`, outcome `completed-with-test-failures`; Local run remains current `completed`. |
| Full execution/report success | `succeeded`, assertion `passed`, result `available`. |
| HTML report missing after JSON result | `partially-succeeded`, failed stage `report`, assertion outcome preserved. |
| Manifest/result write secondary failure | Existing run status/outcome is not replaced; manifest state is invalid/unavailable when a result can still be built. |
| Approval writer/validator failure | Current controller does not make this terminal; no terminal result is written. Lifecycle repair remains HMV-101/HMV-005 work. |

Acceptance and HMV-005 handoff:

- Focused tests cover full success, assertion mixed/failure, process and analysis failure, partial review, non-terminal waiting, missing/invalid manifest, empty/skipped report, path/privacy checks, validation inconsistencies, atomic overwrite, A/B isolation and controller finalization/write failure.
- HMV-001/002/003 and Local response/report behavior remain compatible. `status.json` excludes private normalization context and `publicRun` remains unchanged.
- HMV-005 should add categorized error information without adding raw stdout/stderr, stack traces or user-message decisions to schema `1.0` retroactively; use a backward-compatible versioned extension or adjacent error control artifact.

### HMV-005 — Define normalized error classification

- **Objective:** Replace pattern-only external behavior with an internal categorized error boundary.
- **Rationale:** Hosted needs stable user-safe messages and private diagnostics.
- **Source boundary:** `friendlyError`, route catch, child result objects.
- **Scope:** categories for user, target, engine contract, infrastructure and internal errors; stage/retryability/diagnostic reference; Local message adapter.
- **Explicit non-scope:** final public error schema, localization, observability vendor.
- **Dependencies:** HMV-001, HMV-004.
- **Acceptance criteria:** known current failures map deterministically; unknown exception is internal; stdout/stderr remain private; Local recovery messages remain covered.
- **Required tests:** current friendly-error cases and each category/fallback.
- **Migration risk:** medium.
- **Recommended commit size:** pure mapping module plus controller adapter.

### HMV-006 — Specify timeout ownership and implement engine deadline adapter

- **Objective:** Bound total analysis/execution duration and propagate timeout to descendants.
- **Rationale:** only navigation/test-level timeouts exist.
- **Source boundary:** `runCommand`, Python `subprocess.run`, Playwright child tree.
- **Scope:** deadline input, stage timeout result, descendant termination semantics, cleanup/final manifest behavior.
- **Explicit non-scope:** dispatcher product, quota policy values.
- **Dependencies:** HMV-001; HMV-004/005 contract alignment.
- **Acceptance criteria:** deadline covers scout and Playwright; timed-out job reaches one terminal state; no orphan child in characterization test; partial artifacts are marked.
- **Required tests:** cooperative fake child, descendant process test, timeout before/after artifact write, Local default behavior compatibility.
- **Migration risk:** high on Windows process-tree handling.
- **Recommended commit size:** contract and fake-runner tests, then platform adapter implementation separately.

### HMV-007 — Define cancellation contract

- **Objective:** Make cancellation idempotent across queued, running and terminal runs.
- **Rationale:** current UI/API cannot cancel work.
- **Source boundary:** process-local queue and child spawn lifecycle.
- **Scope:** cancel-request signal, allowed transitions, adapter hook and terminal result semantics.
- **Explicit non-scope:** Hosted UI control, dispatcher selection.
- **Dependencies:** HMV-001, HMV-004, HMV-006.
- **Acceptance criteria:** queued cancellation avoids launch; running cancellation terminates descendants; repeated cancellation is safe; completed result is not rewritten.
- **Required tests:** each lifecycle point and timeout/cancel race.
- **Migration risk:** high.
- **Recommended commit size:** lifecycle contract/tests then execution integration.

### HMV-008 — Characterize and enforce concurrent-run isolation

- **Objective:** Prove two jobs cannot mix writable artifacts or results.
- **Rationale:** HMV-002 made current Local writable paths disjoint, but correctness still depends on a single process-global queue and has no barrier-based or multi-process proof.
- **Source boundary:** run workspace enforcement, standalone fixed defaults, nested process paths, cache policy, lifecycle Map/queue and Playwright report env.
- **Scope:** concurrency characterization harness with fake/synthetic inputs; workspace enforcement; cache disabled or explicitly scoped.
- **Explicit non-scope:** performance tuning, distributed load test.
- **Dependencies:** HMV-002, HMV-003.
- **Acceptance criteria:** simultaneous jobs have disjoint writes; result/manifest references their own target only; no global lock is needed for correctness.
- **Required tests:** deterministic barrier-based concurrent runs, failure in one run, cleanup isolation.
- **Migration risk:** critical.
- **Recommended commit size:** characterization test first, isolation fixes by artifact group.

### HMV-009 — Add public result projection boundary

- **Objective:** Create allowlisted user-facing result independent of raw Playwright/report data.
- **Rationale:** current status/debug/raw HTML can expose target-derived and internal data.
- **Source boundary:** `publicRun`, `normalizeAnalysis`, `summarizePlaywrightResult`, report endpoint.
- **Scope:** projection policy for outcome, safe stage summaries, bounded evidence references and redaction tests.
- **Explicit non-scope:** Hosted frontend, final visual report design, object storage.
- **Dependencies:** HMV-003–005.
- **Acceptance criteria:** no absolute paths, raw stdout/stderr, selectors, credentials or unapproved body content; useful PASS/FAIL/SKIPPED and failure category remain.
- **Required tests:** adversarial fixture strings, snapshot/allowlist tests, public-data scan.
- **Migration risk:** high; either leakage or insufficient diagnostics.
- **Recommended commit size:** pure projector plus fixtures.

### HMV-010 — Specify target URL security boundary

- **Objective:** Define validation and enforcement requirements for public URL execution.
- **Rationale:** current credential-free HTTP(S) check is not SSRF protection.
- **Source boundary:** `validateTargetUrl`, scout navigation and redirects.
- **Scope:** hostname/address/port/scheme, DNS and redirect revalidation, rebinding/egress assumptions, audit categories and test matrix.
- **Explicit non-scope:** defense implementation, network product, allowlist business policy.
- **Dependencies:** none; must precede HMV-301 implementation.
- **Acceptance criteria:** specification covers literal and resolved addresses, redirects, IPv4/IPv6, credentials, unusual ports, DNS changes and safe error exposure.
- **Required tests:** proposed deterministic resolution fixtures and integration cases listed, not necessarily implemented in this documentation task.
- **Migration risk:** critical.
- **Recommended commit size:** one reviewed security specification document and test matrix.

## P1 — Hosted Analysis Trial

### HMV-101 — Define run lifecycle and idempotent command contract

- **Objective:** Define create/analyze/execute/retry transition rules independent of storage.
- **Rationale:** current Map transitions are implicit and approval failure can leave inconsistent stages.
- **Source boundary:** `createRun`, `stage`, analyze/approve/execute functions.
- **Scope:** transition table, command idempotency keys/semantics, terminal immutability, recovery expectations.
- **Explicit non-scope:** database schema/vendor.
- **Dependencies:** HMV-004/005/007.
- **Acceptance criteria:** all current and proposed states have allowed transitions; duplicate command behavior is explicit; test/system outcomes separated.
- **Required tests:** pure state-machine transition table and race cases.
- **Migration risk:** high.
- **Recommended commit size:** pure lifecycle module and tests.

### HMV-102 — Add run lifecycle port and Local in-memory adapter

- **Objective:** Remove direct Map ownership from application logic while retaining Local behavior.
- **Rationale:** Hosted and Local require different durability adapters.
- **Source boundary:** `runs`, `getRun`, `persist`.
- **Scope:** repository port; Local memory/file adapter; startup behavior remains documented.
- **Explicit non-scope:** durable Hosted implementation/product choice.
- **Dependencies:** HMV-101.
- **Acceptance criteria:** controller behavior unchanged; lifecycle service does not import HTTP; adapter contract supports optimistic/atomic transition semantics.
- **Required tests:** create/get/update/not-found and transition conflicts.
- **Migration risk:** medium.
- **Recommended commit size:** interface plus Local adapter/delegation.

### HMV-103 — Add dispatcher port and serial Local adapter

- **Objective:** Replace direct global Promise queue dependency with an abstract dispatch boundary.
- **Rationale:** preserve Local serialization while allowing Hosted worker dispatch later.
- **Source boundary:** `operationQueue`, `enqueue`.
- **Scope:** submit/cancel/claim-result interface as needed; Local FIFO serial implementation.
- **Explicit non-scope:** queue product, distributed lease implementation.
- **Dependencies:** HMV-007, HMV-101.
- **Acceptance criteria:** Local ordering unchanged; application service depends only on port; failure does not stop later jobs.
- **Required tests:** FIFO, failure continuation, cancellation before start.
- **Migration risk:** medium.
- **Recommended commit size:** port, Local adapter, queue characterization tests.

### HMV-104 — Connect navigation/Page Identity through worker adapter

- **Objective:** Run existing deterministic analysis in an isolated job workspace through the new ports.
- **Rationale:** establishes a Hosted analysis trial before interaction execution.
- **Source boundary:** orchestrator plan path and report builder.
- **Scope:** analyze-only worker request/result; no interaction approval/execution.
- **Explicit non-scope:** public API/UI, expanded interaction scope.
- **Dependencies:** HMV-001–005, HMV-008, HMV-101–103.
- **Acceptance criteria:** synthetic fixture URL trial returns navigation/Page Identity summary and manifest; Local flow remains green; no shared writes.
- **Required tests:** worker adapter integration with controlled local target/fixture, failure cases.
- **Migration risk:** high.
- **Recommended commit size:** one analysis-only vertical adapter.

### HMV-105 — Add typed progress projection

- **Objective:** Publish stage events without parsing free-form stdout.
- **Rationale:** current one-second polling sees only persisted stage snapshots.
- **Source boundary:** `stage`, engine adapter boundaries.
- **Scope:** typed event payload, monotonic ordering, Local polling projection.
- **Explicit non-scope:** event transport/vendor, percentage estimates.
- **Dependencies:** HMV-001, HMV-101.
- **Acceptance criteria:** stage start/success/failure/skipped are emitted once with sequence; private logs excluded; Local UI receives equivalent stage states.
- **Required tests:** ordering, duplicate/retry handling, terminal event.
- **Migration risk:** low/medium.
- **Recommended commit size:** event interface and Local collector.

### HMV-106 — Build Hosted report summary projection

- **Objective:** Produce a bounded analysis/result view for a future Hosted UI.
- **Rationale:** Playwright HTML is an internal diagnostic, not the product report contract.
- **Source boundary:** analysis/result projections and HMV-009.
- **Scope:** navigation/Page Identity counts/outcomes, safe failure summary, evidence handles.
- **Explicit non-scope:** frontend implementation, raw HTML publishing.
- **Dependencies:** HMV-009, HMV-104.
- **Acceptance criteria:** projection is JSON-serializable, sanitized and stable under raw reporter changes; links only to authorized projected evidence handles.
- **Required tests:** pass/fail/partial/report-missing fixtures and sanitization scans.
- **Migration risk:** medium.
- **Recommended commit size:** projector and contract fixtures.

### HMV-107 — Define artifact retention and cleanup contract

- **Objective:** Specify lifecycle for raw, diagnostic and public artifacts.
- **Rationale:** current outputs accumulate indefinitely.
- **Source boundary:** manifest and ignored generated directories.
- **Scope:** retention classes, terminal/cancel/failure cleanup semantics, deletion audit expectation, Local opt-in cleanup adapter.
- **Explicit non-scope:** storage lifecycle vendor and final duration values.
- **Dependencies:** HMV-003, HMV-101.
- **Acceptance criteria:** each artifact class has owner and lifecycle; cleanup never crosses workspace; active jobs are protected.
- **Required tests:** dry-run manifest decisions, path containment, concurrent cleanup protection.
- **Migration risk:** high/data loss.
- **Recommended commit size:** policy model and dry-run tests before deletion implementation.

## P2 — Interaction Trial

### HMV-201 — Project review candidates for Hosted UI

- **Objective:** Expose bounded review data while keeping raw report private.
- **Rationale:** current `normalizeAnalysis` includes a `debug` copy of candidate evidence.
- **Source boundary:** Report `2.1`, `normalizeAnalysis`.
- **Scope:** candidateKey, classification, kind, user-readable context, restore readiness and safe evidence handles.
- **Explicit non-scope:** approval persistence, new interaction kinds.
- **Dependencies:** HMV-009, HMV-104.
- **Acceptance criteria:** eligible/ineligible reasons preserved; raw selector/DOM content excluded unless explicitly approved by evidence policy.
- **Required tests:** safe/unsafe/unknown/tab fixtures and leakage scan.
- **Migration risk:** medium.
- **Recommended commit size:** pure review projector.

### HMV-202 — Add approval submission adapter

- **Objective:** Convert an authorized Hosted review submission into current Approval `3.0` through the existing writer/validator.
- **Rationale:** UI decisions must not bypass exact snapshot validation.
- **Source boundary:** `approveRun`, writer and validator.
- **Scope:** run/report binding, selected key validation, reviewer reference, idempotency behavior.
- **Explicit non-scope:** changing Approval schema, identity provider selection, durable audit store.
- **Dependencies:** HMV-101, HMV-201.
- **Acceptance criteria:** only current execution-eligible candidates can be approved; exact report snapshot is copied; stale or duplicate submission is deterministic.
- **Required tests:** tampered key, report change, repeated submission, failed validator state.
- **Migration risk:** high.
- **Recommended commit size:** adapter and contract tests.

### HMV-203 — Connect reconciliation and structured interaction plan

- **Objective:** Invoke existing Reconciliation/Plan `3.0` stages through job-scoped paths.
- **Rationale:** preserve proven approval-to-plan boundary.
- **Source boundary:** reconciler, plan builder/validator.
- **Scope:** exact input binding, manifest entries and normalized stage errors.
- **Explicit non-scope:** renderer/browser execution or new templates.
- **Dependencies:** HMV-002/003/005, HMV-202.
- **Acceptance criteria:** stale evidence fails closed; only eligible candidates reach plan; no shared paths.
- **Required tests:** existing fixtures plus job-path integration.
- **Migration risk:** medium.
- **Recommended commit size:** one downstream planning adapter.

### HMV-204 — Execute supported safe interaction in isolated worker

- **Objective:** Render and execute currently supported approved interaction plans with restoration.
- **Rationale:** interaction is part of the agreed Hosted MVP.
- **Source boundary:** interaction renderer, Playwright runner/config.
- **Scope:** initially proven tab path; worker deadline/cancel/output isolation; test/restoration outcomes.
- **Explicit non-scope:** broad taxonomy expansion, input/submission/auth actions.
- **Dependencies:** HMV-006–009, HMV-203, isolated worker foundation from P3 may be prototyped behind port but public launch waits for HMV-303.
- **Acceptance criteria:** exact approved plan only; workers/retries remain bounded; restoration outcome separate; raw evidence private.
- **Required tests:** controlled tab PASS, interaction FAIL, restoration FAIL, timeout/cancel.
- **Migration risk:** critical.
- **Recommended commit size:** one template vertical slice.

### HMV-205 — Validate expanded toggle runtime before enabling

- **Objective:** Establish browser evidence for existing `interaction.expandedToggle` contract.
- **Rationale:** renderer contract exists but current state explicitly lacks runtime validation.
- **Source boundary:** classifier, Plan `3.0`, renderer.
- **Scope:** controlled neutral target, false→true→false state and failure evidence.
- **Explicit non-scope:** enabling all accordion-like controls or selector heuristics.
- **Dependencies:** HMV-204 execution harness.
- **Acceptance criteria:** deterministic runtime passes repeatedly; restoration and unsupported evidence rules documented; enablement is separate reviewed change.
- **Required tests:** success, initial mismatch, toggle/reset failure.
- **Migration risk:** high.
- **Recommended commit size:** characterization test/evidence first; enablement second.

### HMV-206 — Add evidence exposure rules for interaction results

- **Objective:** Define which failure/restoration evidence users may see.
- **Rationale:** traces/screenshots can contain sensitive target content.
- **Source boundary:** Playwright artifacts, manifest, public projector.
- **Scope:** evidence classes, redaction/projection handles, authorization/expiry requirements at an abstract level.
- **Explicit non-scope:** storage/CDN product, image redaction implementation unless separately approved.
- **Dependencies:** HMV-003, HMV-009, HMV-204.
- **Acceptance criteria:** raw/public separation is explicit for every artifact; no raw report default exposure; missing evidence degrades safely.
- **Required tests:** manifest policy matrix and public projection leakage tests.
- **Migration risk:** critical privacy/security.
- **Recommended commit size:** policy/contract document and projector tests.

### HMV-207 — Add remaining agreed interaction kinds one template at a time

- **Objective:** Extend toward modal, dropdown, carousel, pagination with restoration, read-only detail return and non-submitting filter interactions.
- **Rationale:** agreed product scope exceeds currently proven tab execution.
- **Source boundary:** scout/classifier/evidence/approval/plan/renderer chain.
- **Scope:** one kind per task with bounded initial/expected/restored state and safety evidence.
- **Explicit non-scope:** text/search input, submission, login, signup, payment, mutations, upload, messaging or personal data.
- **Dependencies:** HMV-204 and kind-specific safety decision.
- **Acceptance criteria:** full producer-to-runtime contract, fail-closed validator, neutral fixture and controlled runtime evidence.
- **Required tests:** unit/fixture/static/runtime/cancellation for each kind.
- **Migration risk:** critical; unsafe side effects or false restoration.
- **Recommended commit size:** never combine multiple interaction templates in one behavior commit.

## P3 — Public Operation

### HMV-301 — Implement target URL/SSRF defenses

- **Objective:** Enforce HMV-010 before any public target navigation.
- **Rationale:** public arbitrary URL execution is unsafe with parser-only validation.
- **Source boundary:** request validation, worker network/navigation boundary and redirects.
- **Scope:** implementation matching approved security spec and auditable rejection categories.
- **Explicit non-scope:** vulnerability scanning of targets.
- **Dependencies:** HMV-010, HMV-005, HMV-303.
- **Acceptance criteria:** all security matrix cases pass; every redirect is revalidated; worker egress assumptions are tested/documented; errors do not expose internals.
- **Required tests:** unit resolution fixtures, redirect integration, IPv4/IPv6 and rebinding-oriented cases, negative egress test.
- **Migration risk:** critical.
- **Recommended commit size:** validation library/adapter, redirect enforcement and environment enforcement as separately reviewable commits.

### HMV-302 — Add rate and execution quota ports

- **Objective:** Bound submissions, concurrent work, duration and artifact volume.
- **Rationale:** current body-size check does not prevent compute/storage abuse.
- **Source boundary:** API/control plane, dispatcher, workspace.
- **Scope:** abstract policy inputs/decisions, rejection mapping and accounting hooks.
- **Explicit non-scope:** billing/subscription and vendor selection.
- **Dependencies:** HMV-006, HMV-101/103.
- **Acceptance criteria:** limits can be configured without engine changes; reject/queue decisions are observable; over-limit jobs do not launch.
- **Required tests:** boundary counts, concurrent quota, timeout/artifact size, race/idempotency.
- **Migration risk:** high.
- **Recommended commit size:** policy port and fake adapter first.

### HMV-303 — Implement isolated worker runtime adapter

- **Objective:** Run browser/engine work with per-job filesystem, process, environment and network isolation.
- **Rationale:** current child processes inherit host environment and share repository paths.
- **Source boundary:** engine invocation/dispatcher/workspace ports.
- **Scope:** one implementation behind existing abstractions; minimal env; resource/deadline/cancel enforcement.
- **Explicit non-scope:** choosing architecture in this backlog; implementation task must document its chosen environment separately.
- **Dependencies:** all P0 isolation/deadline work, HMV-103, HMV-301.
- **Acceptance criteria:** jobs cannot read/write each other's workspace; unnecessary secrets absent; child escape/overrun tests fail safely; artifacts publish only through manifest.
- **Required tests:** filesystem/env/network/resource isolation and abrupt worker termination recovery.
- **Migration risk:** critical.
- **Recommended commit size:** adapter skeleton, then each isolation dimension separately.

### HMV-304 — Add abuse-prevention policy

- **Objective:** Detect and stop repeated or malicious use beyond simple quotas.
- **Rationale:** browser automation against arbitrary public targets is abuse-sensitive.
- **Source boundary:** control plane, dispatcher, security events.
- **Scope:** abstract signals/actions, block/hold/review outcomes and safe logging.
- **Explicit non-scope:** security vendor selection, security scanning product.
- **Dependencies:** HMV-301–303.
- **Acceptance criteria:** policy can prevent dispatch and cancel active work; decisions are auditable without raw target content.
- **Required tests:** repeated target/user patterns, false-positive override semantics, cancellation race.
- **Migration risk:** high.
- **Recommended commit size:** decision port/event model before enforcement adapter.

### HMV-305 — Add operational observability contract

- **Objective:** Observe lifecycle, duration, failures and resource use without logging raw target data.
- **Rationale:** current debug logs are target-derived and process-local.
- **Source boundary:** progress/error/result/dispatcher ports.
- **Scope:** metric/event names, correlation identifiers, safe fields and sampling/redaction rules.
- **Explicit non-scope:** observability vendor/dashboard product.
- **Dependencies:** HMV-005, HMV-101/105.
- **Acceptance criteria:** every terminal run has correlated lifecycle events; raw URL/content/selectors/stdout excluded from default telemetry; stage latency available.
- **Required tests:** safe-field allowlist and correlation/terminal-event tests.
- **Migration risk:** medium/high privacy.
- **Recommended commit size:** event contract and in-memory test sink.

### HMV-306 — Enforce retention and deletion

- **Objective:** Apply approved retention policy to artifacts and run metadata.
- **Rationale:** Local behavior is indefinite accumulation.
- **Source boundary:** HMV-003 manifest and HMV-107 policy.
- **Scope:** active-job protection, terminal retention, deletion audit and failure retry semantics.
- **Explicit non-scope:** vendor-native lifecycle selection unless separately decided.
- **Dependencies:** HMV-107, HMV-303.
- **Acceptance criteria:** deletion is scoped to exact job artifacts; recoverable/retry semantics documented; expired public handles fail closed; audit contains no target body.
- **Required tests:** active/completed/failed/cancelled policy cases, path containment, partial delete retry.
- **Migration risk:** critical/data loss and privacy.
- **Recommended commit size:** dry-run, then one storage adapter enforcement commit.

## Dependency Summary

```text
HMV-001 -> HMV-002 -> HMV-003 -> HMV-008
    |          |          |          |
    +-> HMV-004/005 -> HMV-009      |
    +-> HMV-006 -> HMV-007          |
                                  HMV-104
HMV-010 --------------------------> HMV-301
HMV-101 -> HMV-102/103 -> analysis and interaction trials
HMV-201 -> HMV-202 -> HMV-203 -> HMV-204 -> per-kind expansion
P0/P1 security and isolation -> HMV-303 -> public operation
```
