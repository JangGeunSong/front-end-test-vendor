# Hosted MVP Engine Boundary

## 문서 목적

이 문서는 Local MVP의 URL 입력부터 deterministic test engine, Playwright 실행, 결과 표시까지 실제 호출 경계를 source와 test로 characterizing하고 Hosted MVP 이전 시 `KEEP`, `EXTRACT`, `REPLACE`, `LOCAL-ONLY` 경계를 제안한다.

표기:

- **Observed**: 현재 source 또는 test로 확인했다.
- **Inferred**: 여러 observed 근거에서 추론했다.
- **Proposed**: Hosted 이전을 위한 제안이다.
- **Unresolved**: 추가 실험 또는 제품·운영 결정이 필요하다.

이 문서의 최초 분석 이후 HMV-001 engine invocation adapter, HMV-002 run-scoped workspace path contract와 HMV-003 artifact manifest contract가 구현됐다. Local HTTP/API/schema/queue 동작과 engine 판단 contract는 유지하며 Hosted framework, database, queue, cloud, container 제품을 선택하지 않는다.

## 분석 범위와 제외 범위

분석 범위:

- `package.json`의 Local MVP, Python engine, validator, renderer, Playwright scripts
- `tools/mvp/`의 HTTP server, controller, static client, product config, smoke와 tests
- `agent_orchestrator.py`에서 `scout.js`, navigation plan builder/validator/renderer로 이어지는 deterministic `plan` mode
- interaction classification, review report, approval, reconciliation, structured interaction plan과 renderer
- generated artifact, process, state, error, concurrency와 test boundary

제외 범위:

- Hosted API/Web UI/worker production code
- HMV-003 manifest와 이후 Hosted implementation
- schema/version 변경
- SSRF 방어 구현
- deployment/runtime 제품 선정
- external LLM 호출과 public target 재분석

## Bootstrap Snapshot

Observed at analysis start:

| Item | Value |
| --- | --- |
| Branch | `main` |
| HEAD | `88de24e699628c94383f2fa2e2641728391a697f` |
| `origin/main` | `88de24e699628c94383f2fa2e2641728391a697f` |
| Worktree | clean |
| Recent commits | `88de24e`, `6c40921`, `a681d52`, `28d72f3`, `6e95016` |
| Tracked files | 890 |
| Python declaration | `.python-version`: `3.12` |
| Node declaration | `.node-version`: `24.15.0` |
| Active tools | Node `24.15.0`, npm `11.12.1`, fnm `1.38.1`, uv `0.11.32`; project Python `3.12.13` |

The bare shell Python is not the repository execution contract. `tools/environment/run-python.js` selects `.venv/Scripts/python.exe` unless `MVP_PYTHON` is set, and invokes it through uv with pinned requirements.

## 현재 End-to-End 흐름

HMV-002 이후 controller의 direct process boundary는 다음과 같다.

```text
Local HTTP controller workflow
  -> createRunWorkspace({ repositoryRoot, runId, workspaceRoot? })
  -> ensureRunWorkspace(workspace)
  -> createEngineInvocationRequest({ command, args, cwd, env })
  -> invokeEngineProcess(request, { spawnImpl? })
  -> existing Python orchestrator / Python stages / Playwright runner
     with workspace-derived CLI paths and Playwright environment paths
  -> raw { exitCode, signal, stdout, stderr, spawnError }
  -> Local compatibility handling and existing status/API projection
```

`tools/mvp/engine-invocation.js`와 `tools/mvp/run-workspace.js`는 HTTP/server를 import하지 않는다. Controller는 run lifecycle, stage ordering, approval/execution branching, Local debug log, friendly error와 result projection을 계속 소유하지만 path 조합은 workspace contract로 위임한다. Adapter는 request copy/environment merge, `spawn`, stdout/stderr accumulation, exit/signal/spawn-error terminal capture와 one-settlement listener cleanup만 소유한다.

### 연결 상태 정의

- `CONNECTED`: Local MVP UI/API에서 실제 호출된다.
- `MANUAL`: CLI/npm command로 가능하지만 Local MVP controller가 호출하지 않는다.
- `PARTIAL`: 일부 capability 또는 stage만 연결된다.
- `PLANNED`: 문서상 Hosted 목표이며 current code가 없다.
- `UNKNOWN`: code만으로 확정하지 못했다.

### 실제 UI 경로

```text
static index.html/app.js                              CONNECTED
  -> POST /api/analyze { url }                       CONNECTED
  -> validateTargetUrl -> createRun -> global queue  CONNECTED
     -> validated run workspace directories          CONNECTED
  -> Python agent_orchestrator.py --generation-mode plan
     --generated-dir <run>/analysis
     --navigation-spec-output <run>/execution/specs/...
     -> Node scout.js root discovery + browser       CONNECTED
     -> Python projection/menu map                    CONNECTED
     -> run-scoped profile-tree JSON
     -> Node scout.js profile discovery + browser    CONNECTED
     -> run-scoped scout_result.json/menu_map.json
     -> Python build_test_plan.py                     CONNECTED
     -> Python validate_test_plan.py                  CONNECTED
     -> Python render_test_plan.py
     -> run-scoped generated_from_plan.spec.js        CONNECTED
  -> Python build_analysis_review_report.py
     -> in-process classify_interaction_candidates    CONNECTED
  -> Python render_analysis_review_report.py          CONNECTED
  -> GET status/analysis polling and review UI        CONNECTED
  -> optional POST approve
     -> writer -> approval validator                  CONNECTED (tab only in UI)
  -> POST execute
     -> optional reconciliation                       CONNECTED
     -> optional interaction plan build/validate      CONNECTED
     -> optional deterministic interaction render     CONNECTED
     -> Playwright CLI, workers=1, retries=0
        testDir/spec/outputDir from run workspace
     -> browser worker(s), JSON + HTML reporters       CONNECTED
  -> controller result projection
  -> GET result/report
  -> Local MVP result cards and HTML report link      CONNECTED
```

Important distinctions:

| Capability | Status | Evidence and limitation |
| --- | --- | --- |
| Deterministic navigation/Page Identity analysis and execution | CONNECTED | `analyzeRun`, `executeRun` invoke the plan pipeline and Playwright. |
| Navigation-only execution | CONNECTED | `selectExecutionTargets` and `markInteractionSkipped` preserve explicit `SKIPPED`. |
| Tab discovery, exact previous-selection approval, execution and restoration | CONNECTED | `normalizeAnalysis` exposes only safe unselected tabs with `tabRestore`; downstream schema `3.0` path is called. |
| Accordion/expanded toggle | PARTIAL | classifier/plan/renderer contracts exist; Local MVP eligibility is hard-limited to restore-ready tabs and runtime validation is not established. |
| Modal, dropdown, carousel, pagination, detail return, non-submitting filter execution | PARTIAL | discovery/classification may retain candidates, but no corresponding current Local MVP execution path is confirmed. |
| LLM structured plan and direct-JS legacy generation | MANUAL | npm scripts and orchestrator modes exist; Local MVP always uses deterministic `plan`. |
| Plan comparison and legacy generated-spec validator | MANUAL | npm commands exist and are not called by controller. |
| Standalone default approval file workflow | MANUAL | CLI defaults to `tools/ai-generator/review/`; Local MVP supplies run-scoped paths instead. |
| Playwright `show-report` process | MANUAL | `npm run report` exists; Local MVP serves report files through its own HTTP server. |
| Hosted control plane, dispatcher, isolated worker, persistence and public report | PLANNED | no current production implementation. |

## Stage별 계약

`subprocess` means a direct process boundary from the listed caller. Nested subprocesses are separately listed.

| Stage | 시작 file/symbol | 호출 주체 | 입력 | 출력 | subprocess | Artifact R/W | 상태 위치 | 오류 처리 | Timeout / cancellation | 동시 실행 안전성 | Hosted 재사용 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Static UI | `server.js: serveFile`; `public/app.js` document guard and event handlers | browser GET | URL path | HTML/CSS/JS | no | reads `tools/mvp/public/` | browser memory | HTTP 403/404; UI message | none / none | reads only | LOCAL-ONLY reference client |
| Analyze request | `server.js: route`; `app.js` analyze submit | browser | JSON `{url}` | HTTP 202 `{runId}` | no | creates run dir/status | controller `runs` Map | malformed/oversize body or URL becomes HTTP 400 | none / none | request accepted, work globally queued | EXTRACT request use case |
| Target validation | `controller.js: validateTargetUrl` | HTTP route | arbitrary string | normalized `URL.href` | no | none | none | throws for non-absolute, non-HTTP(S), credentials | none / none | pure | KEEP basic parser behind stronger Hosted policy |
| Run creation | `controller.js: generateRunId`, `createRun`, `persist`; `run-workspace.js` | HTTP route | validated URL | mutable run object/id + immutable path contract | no | creates only run workspace directories; writes contract `status` path | Map + run JSON snapshot | provisioning error bubbles to HTTP 400 before Map registration | none / none | disjoint validated run roots | HMV-002 EXTRACTED path contract; lifecycle still controller-owned |
| Engine orchestration | `controller.js: analyzeRun`; invocation/workspace modules; `agent_orchestrator.py: run_plan_generation_pipeline` | queued controller operation | explicit command/args/cwd/env plus workspace CLI paths | raw invocation result plus run core artifacts/spec | Node adapter -> Python | writes workspace analysis/spec paths | controller stage only | adapter distinguishes spawn/nonzero/signal; compatibility wrapper preserves run `failed` behavior | no controller deadline/cancel | Local writable paths disjoint; concurrency not yet characterized | HMV-001/002 extracted seams |
| Root scout | `agent_orchestrator.py: run_scout`; `scout.js: scoutSite` | orchestrator | CLI URL | JSON on stdout | Python -> Node -> browser | no direct result file | process-local | nonzero returns `None`; invalid JSON returns `None`; caller raises `scout failed` | `page.goto` 30s; no whole-process timeout/cancel | browser isolated, stdout contract; shared only through caller | KEEP discovery behavior; adapt I/O |
| Page-profile scout | `run_page_profile_scout`; `collectPrimaryMenuPageProfiles` | orchestrator | URL + generated-dir profile-tree path | JSON on stdout | Python -> Node -> browser | workspace temp JSON write/best-effort delete | process-local | nonzero becomes empty profile list; JSON errors also empty | navigation 30s each; no whole-process timeout/cancel | Local path isolated; cache disabled | KEEP producer and workspace binding |
| Projection/menu map | `build_and_save_menu_map` and projection helpers | orchestrator | scout object | menu map + enriched scout | no | writes workspace `scout_result.json`, `menu_map.json` for Local override | Python memory/files | runtime errors reach orchestrator exit 1 | none / none | Local path disjoint; manual defaults remain shared | KEEP rules/path override adapter |
| Navigation plan build | `build_test_plan.py: build_test_plan`, `main` | orchestrator | supplied workspace menu map | plan JSON | Python -> Python | workspace output overwrite | file | caught load/build errors -> exit 1 | none / none | supplied Local paths isolated | KEEP |
| Navigation plan validate | `validate_test_plan.py: validate`, `main` | orchestrator | plan; optional menu map | stdout report + exit code | Python -> Python | reads plan | none | structured errors/warnings; exit 1 on errors | none / none | read-only for supplied paths | KEEP; Local call currently omits optional coverage input |
| Navigation render | `render_test_plan.py: render_file`, `render_spec` | orchestrator | validated plan + workspace output | CommonJS spec with output-relative helper imports | Python -> Python | workspace spec overwrite, non-atomic | file | validation/render failure exits 1 | none / none | Local path isolated; manual default shared | KEEP renderer/path adapter |
| Analysis/classification | `build_analysis_review_report.py: build_report`; `classify_interaction_candidates` | controller Python child | run scout/menu/plan | Report `2.1` JSON | Node -> Python; classifier in-process | run JSON output | file | typed load/contract errors -> exit 1 | none / none | supplied run paths are isolated | KEEP |
| Review rendering | `render_analysis_review_report.py: render_report` | controller Python child | run report JSON | run Markdown | Node -> Python | run Markdown overwrite | file | load/render errors -> exit 1 | none / none | run isolated | KEEP as internal/local view |
| UI projection | `controller.js: normalizeAnalysis` | controller | report + nav plan | browser-facing analysis object | no | reads run files; embedded into status snapshot | Map/status JSON | JSON parse errors fail analysis | none / none | per-run object | EXTRACT and sanitize |
| Approval | `approveRun`; `write_interaction_approvals.py: build_artifact`; validator `main` | API route through global queue | keys, reviewer, optional note, current report | Approval `3.0` | Node -> two Python processes | atomic run approval write; read report | Map/status file | request gate throws; child failure returns HTTP 400 but no enclosing run-state normalization | none / none | run path isolated, globally serialized | KEEP contract; EXTRACT submission service |
| Reconciliation | `executeRun`; `reconcile_approvals` | queued execution | run report + approvals | Reconciliation `3.0` | Node -> Python | run JSON overwrite | stage/status | invalid inputs or stale mismatch -> exit 1 -> run failed | none / none | run path isolated | KEEP |
| Interaction plan | `build_interaction_plan.py: build_interaction_plan`; `validate_interaction_plan.py: validate_plan` | queued execution | reconciliation + report | Plan `3.0` and validation result | Node -> two Python processes | run plan (contract writer is atomic) | stage/status | fail-fast/no partial plan | none / none | run path isolated | KEEP |
| Interaction render | `render_interaction_plan.py: render_plan_to_path` | queued execution | validated plan | workspace CommonJS spec | Node -> Python | atomic workspace write | run object | validates renderer input; preserves old output on failure | none / none | Local destination isolated | KEEP renderer/path contract |
| Playwright execution | `executeRun`; Playwright CLI; `tools/mvp/playwright.config.js` | queued controller | workspace spec paths, config, env output paths | exit code, stdout/stderr, artifacts | Node -> Node runner -> worker/browser | workspace JSON/HTML and `execution/test-results` | run stage/object | assertion failure allowed and normalized; missing/invalid JSON throws | 60s/test; no job deadline/cancel | writable Local paths disjoint; queue remains | KEEP specs; further isolate worker/runtime later |
| Result projection | `summarizePlaywrightResult` | controller | Playwright JSON + plans + exit code | Local result object | no | read result; persisted in status | Map/status JSON | assumes reporter shape; parse errors fail run | none / none | per-run inputs | EXTRACT normalized terminal result |
| Report delivery | `server.js: route`, `serveFile` | browser | run id/report relative path | redirect/static report asset | no extra report process | reads run report dir | run Map needed to resolve directory | unavailable -> HTTP 400; missing file 404 | none / none | per-run report dir | LOCAL-ONLY raw report viewer; REPLACE public projection |

## Process Boundaries

HMV-001 classification of observed subprocesses:

| Classification | Invocation | Reason |
| --- | --- | --- |
| `ENGINE_INVOCATION` | All direct Python and Playwright processes called by `controller.js` | These are the existing deterministic analysis, review/approval/planning/rendering and execution commands a future worker must invoke; all now use the adapter. |
| `LOCAL_SUPPORT` | `tools/mvp/smoke.js` starting `server.js`; manual `playwright show-report` | These support Local product smoke or developer report viewing and are not worker engine commands. Local report HTTP serving creates no process. |
| `OUT_OF_SCOPE` | Python orchestrator's nested Node scout and Python builder/validator/renderer processes; `tools/environment/run-python.js` uv wrapper | Nested engine internals retain their existing boundaries; the uv wrapper is a repository command/bootstrap entrypoint, not the Local controller invocation seam. |

| Process | Created by | Receives | Returns / writes | Lifecycle observation |
| --- | --- | --- | --- | --- |
| Local HTTP Node process | `npm run product:mvp` -> `server.js` | HTTP, `MVP_PORT`, inherited env | JSON API and static files | one process; binds `127.0.0.1`; owns in-memory registry/queue |
| Python orchestrator process | `invokeEngineProcess` through controller `runCommand` in `analyzeRun` | executable path, URL/mode plus generated-dir/spec-output CLI paths, inherited env plus UTF-8 | stdout/stderr/exit/signal/spawn error; workspace files | one per analysis |
| Root Node scout process | Python `subprocess.run` | URL command argument | one JSON document on stdout, diagnostics stderr | launches one Chromium browser |
| Profile Node scout process | Python `subprocess.run` | URL and workspace JSON file argument | one JSON document on stdout | launches a second Chromium browser and navigates per target |
| Python builder/validator/renderer processes | orchestrator `run_subprocess_stage` or controller `runCommand` | CLI file paths | files, stdout/stderr, exit code | separate process for each stage |
| Playwright runner Node process | controller uses `process.execPath` + resolved CLI | spec args, config, reporter args and env output paths | exit, reporter files, stdout/stderr | assertion failures are allowed for result projection |
| Playwright worker/browser | runner | rendered specs/config | trace/screenshot/video/test attachments | `workers=1`; bundled Chromium; browser details managed by Playwright |
| Static/report serving | same Local HTTP process | relative path | file stream | no separate HTML report process |
| `playwright show-report` | manual npm script only | default report directory | separate local report server | not connected to Local MVP |

Observed transfer mechanisms:

- command-line arguments: target URL and artifact paths
- environment: inherited process env, UTF-8 settings, `PLAYWRIGHT_HTML_OUTPUT_DIR`, `PLAYWRIGHT_JSON_OUTPUT_NAME`, `MVP_PLAYWRIGHT_TEST_DIR`, `MVP_PLAYWRIGHT_OUTPUT_DIR`; optional `MVP_PYTHON`/`MVP_PORT`
- stdout/stderr and exit code: every child command; scout stdout is a machine JSON contract
- JSON/Markdown/JavaScript files: all durable stage hand-offs
- in-memory objects: Local controller run, UI projection, normalized result
- HTTP JSON: browser/controller boundary

Inferred: stdout parsing is unsuitable as the only Hosted progress contract. Orchestrator stdout mixes status text and may print a complete target-derived DOM map. Stage hooks/events around existing deterministic calls are safer than parsing free-form logs.

Observed validation nuance: `run_plan_generation_pipeline` calls `validate_test_plan.py --input <plan>` without `--menu-map`. Schema/template checks run, but the validator's optional primary-menu coverage comparison is not active on this Local path. The deterministic builder is expected to enumerate the tree, yet Hosted extraction should characterize this behavior and decide whether enabling the existing coverage input is a separate backward-compatible hardening change rather than silently changing it inside HMV-001.

## Artifact Lifecycle

Observed after HMV-002: the current Local deterministic controller path uses the workspace as canonical storage. The fixed paths below remain only when standalone/manual commands omit the new overrides; there is no controller copy or bidirectional synchronization boundary.

Observed after HMV-003: `tools/mvp/artifact-manifest.js` projects the workspace into a validated schema `1.0` snapshot at `<run-root>/artifact-manifest.json`. The top level is `{ schemaVersion, runId, workspaceRelativeRoot, generatedAt, artifacts }`; each entry is `{ artifactId, relativePath, artifactType, producer, mediaType, requirement, condition, sensitivity, publicEligibility, presence, sizeBytes }`. Logical IDs are fixed, ordered and namespaced; paths use workspace-relative `/` notation and resolve back through the HMV-002 containment boundary. The manifest excludes itself, does not scan for unknown files and does not expose absolute repository/workspace paths.

The controller writes an initial snapshot after `status.json`, then refreshes after analysis, approval and execution on both success and failure. A failed manifest refresh is secondary diagnostic failure and cannot replace the run's existing status/result. File presence is `present` or `missing`; pre-created attachment/report directories additionally use `empty` so directory existence is not mistaken for produced evidence. Required/conditional/optional metadata describes expected ownership but missing downstream output is not by itself a lifecycle validation error.

Artifact policy is conservative. Raw scout/menu/status/approval/spec/Playwright result, HTML and attachment artifacts are `never` public-eligible. Review JSON/Markdown is `review-required`; no artifact is currently marked `eligible`. This is classification metadata only: it neither redacts content nor authorizes Local/Hosted delivery. Raw report serving remains Local-only, and HMV-004/HMV-009 must consume the manifest through separate terminal-result and public-projection contracts.

HMV-003 registry inventory:

| Artifact ID / workspace key / relative path | Producer -> current consumer | Type / media | Requirement / lifecycle | Sensitivity / public policy | Missing meaning | Registration |
| --- | --- | --- | --- | --- | --- | --- |
| `run.status` / `status` / `status.json` | run controller -> Local diagnostics; future result projector | file / `application/json` | required / run created | potentially sensitive (URL, logs, local diagnostics) / `never` | controller persistence failure or pre-persist snapshot | `REGISTER_NOW` |
| `analysis.scout-result` / `scoutResult` / `analysis/scout_result.json` | analysis orchestrator -> review builder | file / `application/json` | conditional / analysis started | potentially sensitive target-derived DOM evidence / `never` | analysis not entered or failed before output | `REGISTER_NOW` |
| `analysis.menu-map` / `menuMap` / `analysis/menu_map.json` | analysis orchestrator -> plan/review builders | file / `application/json` | conditional / analysis started | potentially sensitive target-derived navigation evidence / `never` | analysis not entered or failed before projection | `REGISTER_NOW` |
| `analysis.navigation-plan` / `navigationPlan` / `analysis/test_plan.generated.json` | navigation plan builder -> validator/renderer/controller | file / `application/json` | conditional / analysis succeeded | target-derived / `never` | plan pipeline did not succeed | `REGISTER_NOW` |
| `review.analysis-report-json` / `analysisReviewJson` / `review/analysis_review_report.json` | analysis review builder -> controller/approval writer | file / `application/json` | conditional / analysis succeeded | target-derived / `review-required` | review stage did not complete | `REGISTER_NOW` |
| `review.analysis-report-markdown` / `analysisReviewMarkdown` / `review/analysis_review_report.md` | review renderer -> Local reviewer | file / `text/markdown` | conditional / analysis succeeded | target-derived / `review-required` | renderer did not complete | `REGISTER_NOW` |
| `approval.interaction-approvals` / `interactionApprovals` / `approval/interaction_approvals.json` | approval writer -> validator/reconciler | file / `application/json` | conditional / interaction approved | potentially sensitive reviewer and evidence data / `never` | navigation-only or approval not completed | `REGISTER_OPTIONAL` |
| `approval.reconciliation` / `reconciliation` / `approval/interaction_approval_reconciliation.json` | approval reconciler -> interaction plan builder | file / `application/json` | conditional / interaction approved | target-derived / `never` | navigation-only or reconciliation not completed | `REGISTER_OPTIONAL` |
| `plan.interaction-plan` / `interactionPlan` / `plan/interaction_plan.generated.json` | interaction plan builder -> validator/renderer/controller | file / `application/json` | conditional / interaction approved | target-derived / `never` | navigation-only or plan not completed | `REGISTER_OPTIONAL` |
| `execution.navigation-spec` / `navigationSpec` / `execution/specs/generated_from_plan.spec.js` | navigation renderer -> Playwright | file / `text/javascript` | conditional / analysis succeeded | target-derived executable / `never` | analysis/render did not complete | `REGISTER_NOW` |
| `execution.interaction-spec` / `interactionSpec` / `execution/specs/generated_interaction_plan.spec.js` | interaction renderer -> Playwright | file / `text/javascript` | conditional / interaction approved | target-derived executable / `never` | navigation-only or render not completed | `REGISTER_OPTIONAL` |
| `execution.test-results` / `testResultsDir` / `execution/test-results` | Playwright -> Local diagnostics | directory / no media type | optional / execution | potentially sensitive trace/screenshot/video / `never` | `empty` means no attachment was produced | `REGISTER_OPTIONAL` |
| `report.playwright-json` / `playwrightJsonReport` / `report/playwright-results.json` | Playwright -> controller result summary | file / `application/json` | conditional / execution started | potentially sensitive raw result/errors/paths / `never` | execution/reporting did not produce JSON | `REGISTER_OPTIONAL` |
| `report.playwright-html` / `playwrightHtmlReportDir` / `report/playwright-html` | Playwright -> Local report endpoint | directory / no media type | optional / execution | potentially sensitive raw report/evidence / `never` | `empty` means HTML reporter produced no content | `REGISTER_OPTIONAL`; serving is `LOCAL_ONLY` |

`DEFER` covers the transient profile-tree file (best-effort deleted), disabled Local profile cache, individual dynamic attachments, manual/LLM/default-path artifacts and the temporary manifest write file. The manifest registers only known definitions; it does not recursively discover debug/cache files. Secret-bearing input is not expected in the current credential-free Local request, but raw target-derived artifacts remain classified conservatively because target content and diagnostics can still be sensitive.

| Artifact/path pattern | Writer | Consumer | Overwrite/collision | Cleanup | Ignored | Public suitability / sensitivity | Job-scoped requirement |
| --- | --- | --- | --- | --- | --- | --- | --- |
| workspace `analysis/scout_result.json` | orchestrator | report builder | run overwrite only; A/B paths disjoint | none | yes | raw DOM-derived URLs/text/selectors; internal only | HMV-002 complete for Local |
| workspace `analysis/menu_map.json` | orchestrator | plan/report builders, validators | run overwrite only | none | yes | target navigation/profile evidence; internal only | HMV-002 complete for Local |
| workspace `analysis/primary_menu_tree_for_profiles.json` | orchestrator | profile scout | run temp; best-effort unlink | best effort | yes | target menu evidence; internal only | HMV-002 complete for Local |
| workspace `analysis/page_profile_cache.json` | orchestrator | later analysis in same configured output | Local controller disables cache; manual default remains shared | none | yes | cross-target evidence/stale-data risk | Hosted cache policy deferred |
| workspace `analysis/test_plan.generated.json` | plan builder | validator, renderer, controller | run overwrite only | none | yes | target-derived structured plan; internal/reviewable after sanitization | HMV-002 complete for Local |
| workspace `execution/specs/generated_from_plan.spec.js` | nav renderer | Playwright | direct run output; output-relative helper imports | none | yes | embeds target URL/selectors; executable internal artifact | HMV-002 complete for Local |
| `.../mvp-runs/<id>/status.json` | controller | diagnostic snapshot only; current server does not reload it | unique run; overwritten repeatedly | none | yes | URL, analysis, result, debug logs and process path fields can be sensitive | mandatory; define safe persisted shape |
| run `analysis_review_report.json/.md` | report builder/renderer | controller/human/approval | run-isolated overwrite | none | parent ignored | target evidence; not automatically public | mandatory |
| run `interaction_approvals.json` | writer | validator/reconciler | run-isolated atomic replace | none | parent ignored | reviewer/note/evidence; access-controlled internal | mandatory |
| manual `review/interaction_approvals.json` | human/CLI | manual validator/reconciler | fixed local state | manual | yes | review metadata/target evidence | local-only; Hosted uses submitted job artifact |
| run reconciliation/interaction plan | reconciler/builder | validator/renderer | run-isolated; reconciliation write is direct, plan writer atomic | none | parent ignored | current eligibility and exact selectors/URLs; internal | mandatory |
| workspace interaction spec | interaction renderer | Playwright | atomic run write | none | yes | executable target-derived source; internal | HMV-002 complete for Local |
| workspace `report/playwright-results.json` | Playwright JSON reporter | result projection | run-isolated | none | parent ignored | errors, titles, paths and target-derived evidence possible | private/internal |
| workspace `report/playwright-html/` | Playwright HTML reporter | Local report endpoint | run-isolated | none | parent ignored | raw report/attachments may expose target data and internals | private diagnostic only |
| workspace `execution/test-results/` | Playwright | HTML/report debugging | run `outputDir`; A/B paths disjoint | runner may replace within run | yes | traces/screenshots/videos and target content; highest sensitivity | HMV-002 complete for Local; public exposure forbidden |
| controller `debugLog` | `appendLog` | status API/UI debug | last 20 records, 12,000 chars each | process/run retention only | inside status | may contain URLs, selectors, DOM text and runtime paths | internal; redact/project before exposure |

Observed: no retention limit or run cleanup exists. Generated run directories and specs accumulate.

Observed after HMV-002: the global `operationQueue` still serializes analyze, approve and execute operations originating from this controller even though the current Local controller's writable artifact paths are disjoint. It remains because queue removal/concurrent execution, lifecycle races, process capacity, timeout/cancellation and multi-process correctness are explicitly deferred to HMV-008 and related lifecycle/dispatcher work.

Remaining risks if serialization is removed, multiple server processes run, or manual CLI runs overlap:

- no barrier-based proof yet that nested processes and Playwright never escape supplied paths
- shared cache contamination if a future caller enables cache with a shared override/default
- stale artifact consumption by manual default-path commands
- process-local Map and approval/execute lifecycle races remain uncharacterized across server processes
- no cross-process lock: each controller process has its own queue, and no resource quota/deadline exists

## State Management

Observed run statuses:

```text
created -> analyzing -> ready_for_execution
                         |       |
                         |       -> executing -> completed
                         -> approved -> executing -> completed
any caught async pipeline failure -> failed
```

Observed stage statuses are `pending`, `running`, `success`, `failed`, `skipped` across the 11 names in `STAGES`.

State facts:

- The authoritative lookup is the controller process-local `runs` Map.
- `status.json` is a snapshot, but startup does not scan or restore it.
- Browser refresh keeps the run only if client state remains; a full page reload resets client memory and offers no history route.
- Server restart makes past runs unreachable even though files remain.
- Progress is stage-level polling every second, not percent or event streaming.
- Playwright assertion failure is a completed run with `overall=FAIL`; orchestration/report parse failure is terminal `failed`.
- `Report preparation` may be marked failed while overall run status is still `completed`.
- Approval failure is not wrapped by `approveRun`; the HTTP request receives an error, but a stage can remain `running` and the prior run status can remain ready.

Proposed Hosted gap:

- durable run identity and recoverable lifecycle
- explicit queued/dispatching/cancel-requested/cancelled/timed-out terminal meanings
- atomic state transition rules and idempotent command handling
- normalized stage progress independent of stdout wording
- separation of test outcome (`PASS/FAIL/SKIPPED`) from system terminal outcome

No new state schema is fixed by this document.

## Error Propagation

| Failure | Current path | Current external result | Category |
| --- | --- | --- | --- |
| URL parse/protocol/credential | `validateTargetUrl` throws in route | HTTP 400 `{error}`; UI text | expected user error |
| Request JSON/size | `readBody` rejects | HTTP 400 | expected user error |
| Target resolves to unsafe network location or redirects there | no Hosted-grade check | execution may proceed | security boundary gap |
| Child spawn failure | `runCommand` `error`; analyze/execute catches | run `failed`; friendly executable message for ENOENT | infrastructure/runtime |
| Python import failure | child nonzero; `friendlyError` pattern | run `failed` with env sync guidance | infrastructure/runtime |
| Scout navigation/browser failure | Node stderr/exit -> Python `None`/RuntimeError -> child nonzero | run `failed`; network/browser patterns may normalize | target or infrastructure |
| Scout invalid stdout JSON | parser returns `None` | generic `scout failed` | engine contract |
| Profile scout failure/invalid JSON | returns empty list | pipeline may continue with reduced Page Identity evidence | target/engine degradation |
| Plan JSON/schema/coverage failure | validator exit 1 | analysis `failed`, broadly labelled Website analysis because orchestrator is one child boundary | engine contract |
| Review/report invalid JSON | report child or controller parse throws | analysis `failed` | engine contract |
| Approval invalid/unsupported | request gate or child failure | HTTP 400; stage consistency gap | expected user or contract error |
| `missingCandidate` / `evidenceChanged` | reconciliation stdout/stderr pattern | run `failed` with re-analysis message | expected stale-review error |
| Interaction plan validation/render failure | child exit 1 | run `failed` with stage label | engine contract |
| Playwright assertion failure | allowed nonzero; JSON read/summarize | run `completed`, overall `FAIL`, HTML evidence if present | target/test outcome |
| Browser crash | Playwright nonzero then JSON expected | `FAIL` if valid JSON exists; otherwise run `failed` | infrastructure/runtime |
| Missing/invalid reporter JSON | filesystem/JSON exception | run `failed` | infrastructure or engine integration |
| Missing HTML report | stage `Report preparation=failed` | run still `completed`; endpoint may fail | infrastructure/runtime |
| Timeout | only scout navigation/test timeout | stage-specific failure; no job timeout state | target or infrastructure |
| User cancellation | not implemented | no API/UI/process termination | unsupported |
| Programming error in route | route catch | generally HTTP 400, except message containing “not found” -> 404 | internal error is not normalized |

Proposed: Hosted needs a normalized error/result contract that preserves category, stage, retryability, safe user message, internal diagnostic reference, and test outcome separately. Exact schema design is deferred.

## Security-Relevant Observations

- Observed URL validation only enforces absolute credential-free HTTP(S). It does not enforce DNS/IP ranges, redirect policy, ports, host allow/deny policy, rebinding protection, or egress policy.
- Target URL is passed as a process argument and embedded in generated plans/specs/reports.
- Child processes inherit the full controller environment. Local deterministic mode does not need an LLM key, but inherited process-global secrets are not minimized.
- Raw scout/report/trace/screenshot/video/debug output can contain target-derived content and must not be a public response by default.
- Static report serving has path containment checks, but authorization is absent because the server is localhost-only.
- Request body is bounded to roughly 1 MiB, while there is no execution quota, target page limit, artifact quota or rate limit.
- Browser/network isolation is not a current property.

Proposed: specify the target URL security boundary before public Hosted execution, then implement it in the isolated execution boundary. This document deliberately does not select or implement the mechanism.

## Existing Test Coverage

| Asset | Boundary protected | Gap |
| --- | --- | --- |
| `controller.test.js` | URL validation, analysis projection, execution selection, navigation-only semantics, result summary, friendly bootstrap errors | no real subprocess, queue, filesystem, lifecycle restart, cancellation, timeout or concurrent run characterization |
| `bootstrap.test.js` | bundled Chromium/headless/workers/retries config | no browser launch |
| `public/app.test.js` | static UI markup and pure helper behavior for filters/labels/cards/SKIPPED | no HTTP/browser event integration |
| `test_write_interaction_approvals.py` | exact snapshot copy and missing-key rejection | only writer unit boundary |
| CLI fixture modes in classifier/approval/reconciliation/plan/renderer modules | deterministic success/failure categories, exact evidence and fail-fast rules | not all are included in `test:python`; require explicit fixture commands |
| tracked JSON fixtures | contract examples and negative mutations | neutral/synthetic, no Hosted lifecycle |
| `product:mvp:smoke` | real Local server/browser flow and report endpoint when explicitly run | external target/browser dependent; not part of required unit command |
| `test:generated`, smoke/regression scripts | real Playwright execution of available specs | generated directory may not exist; not an application boundary test |
| `validate_generated_spec.py` | legacy direct generated spec/static evidence | not the structured Local MVP renderer gate |

Proposed missing characterization tests before migration:

1. controller invokes an injected engine command with exact URL/options and projects exit/stdout/stderr without real browser work;
2. two runs prove current serialization and demonstrate which shared files require isolation;
3. run workspace contains an explicit manifest and no path escapes;
4. timeout terminates the full descendant process tree and produces one terminal transition;
5. cancellation is idempotent before dispatch, during scout and during Playwright;
6. restart/recovery behavior is specified and tested;
7. approval failure cannot leave `running` stage state;
8. missing/invalid JSON reporter and missing HTML report receive distinct normalized failures;
9. public projection excludes raw selectors, logs, filesystem paths and target body content;
10. redirect and resolved-address cases exercise the future target security boundary.

## KEEP

| Module/contract | Hosted usage | Protecting tests | Change risk |
| --- | --- | --- | --- |
| Projection helpers in `agent_orchestrator.py` | engine domain logic behind a path-aware adapter | Python tests/compatibility and cross-site evidence | broad navigation coverage regressions |
| `scout.js` discovery and observed URL provenance | isolated worker subprocess initially | classifier/fixtures and prior runtime evidence | selector/evidence or safety provenance drift |
| `build_test_plan.py` deterministic plan contract | worker stage with job paths | plan validator fixtures/commands | navigation coverage drift |
| `validate_test_plan.py` | mandatory gate | validation commands | invalid specs reaching renderer |
| `render_test_plan.py` and navigation helpers | deterministic executable shape | syntax/discovery and generated execution | arbitrary code shape or assertion drift |
| interaction classifier policy and `candidateKey` | analysis service output, never approval itself | candidate fixture | unsafe eligibility or stale identity errors |
| Report `2.1` evidence contract | internal review input | report/classifier fixture chain | approval evidence mismatch |
| Approval/Reconciliation `3.0` exact snapshot/stale contract | Hosted review submission adapter and worker validation | approval/reconciliation fixtures | stale approval carry-forward |
| Plan `3.0` builder/validator | bounded worker execution input | builder/validator fixtures | unreviewed or unbounded behavior execution |
| interaction renderer fixed templates | deterministic specs inside worker | renderer fixture/static discovery/runtime evidence | restoration/data safety regression |
| `interaction_url.py` same-origin/exact URL rules | retain as inner engine invariant | approval/plan fixtures | observed/start URL provenance loss |
| neutral fixtures and generated-spec validation assets | migration contract suite | current fixture commands | silent behavior change during extraction |

KEEP does not mean raw CLI/file paths are the final Hosted API. It means behavior and data invariants remain unchanged behind adapters.

## EXTRACT

| Candidate | Current location/coupling | Proposed boundary (input -> output; side effect) | Priority | Characterization / first commit size |
| --- | --- | --- | --- | --- |
| Engine invocation service | HMV-001 extracted to `tools/mvp/engine-invocation.js`; controller retains lifecycle/projection | `{command,args,cwd,env}` -> `{command,args,cwd,exitCode,signal,stdout,stderr,spawnError}`; launches existing commands | P0 complete | injected fake spawn and controller request characterization; no behavior change |
| Job workspace allocation | HMV-002 extracted to `tools/mvp/run-workspace.js`; controller binds its map | repository root + safe run ID -> contained logical paths; creates only exact run directories | P0 complete | traversal/reserved/reparse containment, uniqueness, idempotency, physical isolation and controller path-binding tests |
| Artifact manifest | HMV-003 implemented in `tools/mvp/artifact-manifest.js` | workspace definitions -> typed relative snapshot + validated atomic JSON write | P0 complete | initial/partial/present/A-B/path/policy/controller lifecycle tests |
| Normalized terminal result | `summarizePlaywrightResult` plus catch branches | raw Playwright/process results -> execution outcome + system outcome | P0 | preserve current JSON projection fixtures; no public schema promise |
| Target validation use case | server calls basic parser directly | request URL -> canonical request or categorized rejection; no network side effect | P0 | retain current cases, add policy adapter seam; security policy remains separate |
| Execution options | hardcoded args/env in controller | bounded mode/workers/retries/cache/report options -> command args/env | P0 | default equality tests; no user-controlled arbitrary args |
| Timeout/cancellation interface | absent around `runCommand` | deadline/signal -> process-tree termination result | P0 | fake long child tests; implementation follows contract task |
| Progress event projection | `stage`, `persist`, free-form child output | typed stage transition -> listener/storage projection | P1 | exact ordering/terminal-state tests; avoid stdout parsing |
| Approval submission use case | route + `approveRun` | run/report ref + selected keys/reviewer/note -> validated Approval `3.0` ref | P2 | failed approval state and idempotency tests |
| Report/public result projection | `normalizeAnalysis`, `summarizePlaywrightResult`, raw report endpoint | internal manifest/result -> allowlisted public view | P0/P1 | secret/path/raw evidence exclusion tests |
| Retention/cleanup policy port | no current boundary | manifest + terminal time + policy -> deletion decisions | P1 | dry-run policy tests first |

Observed extraction sequence: HMV-001 introduced the framework-free invocation adapter without path changes; HMV-002 then added the workspace contract and migrated the coherent Local deterministic artifact path slice; HMV-003 adds an internal artifact identity/snapshot contract without combining Hosted HTTP, storage or public projection work. HMV-004 is the next additive result boundary.

## REPLACE

| Current implementation | Hosted problem | Abstract replacement responsibility | Do not decide now | Risk / temporary adapter |
| --- | --- | --- | --- | --- |
| process-local `runs` Map | lost on restart; no multi-instance consistency | durable run lifecycle repository | database vendor/schema technology | high; dual-write status adapter can bridge |
| process-local promise queue | only serializes one Node process; head-of-line blocking | dispatcher with claim/lease/idempotency semantics | queue/vendor/runtime | high; retain serial adapter for Local client |
| standalone CLI fixed output defaults | manual/default commands can overlap each other or a caller that omits overrides | require the HMV-002 workspace contract at worker/application boundary | storage product | medium/high; defaults remain only for Local compatibility |
| no enforced manifest of workspace writes | an unlisted future producer can escape isolation unnoticed | manifest plus worker write-policy enforcement | container filesystem/object store | high; HMV-002 lexical/real-path contract is the base adapter |
| unspecified cross-job cache policy | a shared cache can mix stale target evidence | disable or define scoped/versioned cache responsibility | cache product | high; Local controller currently disables cache |
| controller-owned orchestration and UI projection | application logic cannot be reused cleanly | framework-neutral application service and ports | Hosted backend/frontend frameworks | medium; controller delegates incrementally |
| unrestricted inherited environment | unnecessary secret exposure to child/browser tools | allowlisted worker execution environment | secret manager product | high; adapter can construct minimal env |
| basic URL parser as security gate | public URL execution enables SSRF/abuse | target resolution/redirect/egress policy contract | exact infrastructure implementation | critical; no safe public launch before implementation |
| raw Playwright HTML as user report | leaks internal paths/raw target evidence; unstable product contract | sanitized Hosted report projection | report UI framework/storage | high; keep raw report private |
| no job timeout/cancel | runaway queued/child/browser work | deadline ownership + cancellation propagation | dispatcher technology | high; temporary Local queue has no remedy |
| localhost trust/no auth | public report/run access cannot rely on run ID | authorization and scoped artifact access | identity provider | high; Local-only server remains unchanged |
| ever-growing artifacts | disk/privacy exposure | retention, quota, cleanup and legal policy enforcement | storage lifecycle product | high; manual cleanup remains Local-only |

## LOCAL-ONLY

- dependency-free developer/reference UI in `tools/mvp/public/`
- localhost server binding and `MVP_PORT`
- Local HTML report file browser endpoint
- `npm run report` local report viewer
- `product:mvp:smoke` developer end-to-end harness
- manual fixture/debug CLI commands and compatibility matrix
- offline tracked Node dependency workflow and local uv/fnm bootstrap
- optional local raw artifact/debug-log inspection

The Local MVP remains a development and validation reference client. It should delegate to the same extracted application service where practical; it is neither discarded nor promoted unchanged as the commercial Hosted product.

## Hosted-Ready Logical Boundary

```text
Hosted Web UI
  -> Hosted API / Control Plane
  -> Run Application Service
     -> Run Lifecycle Port
     -> Job Dispatcher Port
  -> Isolated Worker Adapter
     -> Engine Invocation Adapter
     -> Existing deterministic engine pipeline (KEEP)
     -> job-scoped Artifact Manifest
     -> Normalized Internal Result
  -> Public Result / Report Projection
  -> Hosted Web UI

Local Reference UI
  -> Local controller adapter
  -> same Run Application Service where feasible
```

Answers to migration questions:

- **Most stable reusable engine entrypoint:** Observed, `agent_orchestrator.py --generation-mode plan --generated-dir <analysis> --navigation-spec-output <spec>` is now the smallest path-parameterized analysis entrypoint. It still owns nested subprocess sequencing and is not a complete application-service entrypoint for review/approval/execution.
- **Smallest first adapter:** Completed, `engine-invocation.js` supplies the explicit process seam, `run-workspace.js` supplies validated paths and `artifact-manifest.js` supplies typed artifact snapshots. The next additive boundary is HMV-004 normalized terminal result projection.
- **First business/application logic to separate:** target request validation, run command construction, execution target selection and normalized terminal projection currently inside `controller.js`.
- **Artifacts requiring isolation:** scout result, profile-tree temp file, menu map, navigation plan, navigation spec, approval, reconciliation, interaction plan/spec, Playwright JSON/HTML, `test-results` attachments/logs; cache needs an explicit separate policy.
- **Progress:** add typed stage hooks at adapter/application boundaries. Do not parse current stdout for semantic progress; retain it only as private diagnostics.
- **Cancellation today:** no. Neither API nor child handle/process-tree termination exists.
- **Timeout ownership:** control plane owns overall deadline; dispatcher/worker enforces lease and job deadline; engine adapter terminates descendants; scout/Playwright retain their inner operation/test timeouts.
- **Playwright vs public report:** Playwright HTML/trace remains private diagnostic evidence. Hosted projection uses allowlisted normalized outcomes/evidence links and never directly exposes the raw report by default.
- **Raw vs sanitized:** artifact manifest labels raw target-derived inputs/evidence, executable internal files and publishable projections separately. Only an explicit sanitizer/projector crosses the public boundary.
- **Hosted approval reuse:** Report `2.1` candidateKey/evidence, Approval/Reconciliation `3.0`, observedUrl and Plan `3.0` can be kept. Hosted UI submits decisions through an adapter; it must not manufacture execution instructions.
- **Shared application service:** yes, proposed. Local controller and Hosted API should be adapters; process dispatch/persistence implementations can differ.
- **Blockers before Hosted skeleton:** normalized lifecycle/result/error contracts and target URL security specification remain; invocation, Local workspace and artifact manifest seams are implemented. Before any public execution, implement target security, isolated worker, timeout/cancellation and retention/abuse controls.

## 최초 Extraction 결과와 다음 후보

Completed first implementation: **HMV-001 — framework-free engine invocation adapter**.

Why first:

- it is the narrowest seam around currently proven commands;
- Local API/UI behavior and engine schemas can remain unchanged;
- dependency injection makes command/result/error characterization possible without browser/network calls;
- both later Local controller cleanup and Hosted worker skeleton can reuse it;
- it exposes, rather than hides, the fixed-path work that HMV-002 must isolate.

Implementation location stayed under `tools/mvp/` because the only current consumer and command compatibility owner is the Local controller. The module itself has no Local HTTP/UI import and can be reused by a future worker. Creating a new engine directory before a second consumer exists would add ownership churn without changing the seam.

Completed second implementation: **HMV-002 — run-scoped workspace path contract**. `createRunWorkspace` is the path source of truth; `ensureRunWorkspace` creates only validated run directories without deleting existing files or mutating global cwd/environment. Controller paths are projected through orchestrator CLI arguments and Playwright environment overrides while process `cwd` remains the repository root for module/config resolution.

Completed third implementation: **HMV-003 — artifact manifest**. It consumes logical workspace paths, records workspace-relative produced/missing/empty state and conservative sensitivity/public eligibility, and leaves storage/public URL technology and raw report projection out of scope.

The next candidate is **HMV-004 — normalized terminal result boundary**. It should consume invocation/lifecycle outcomes and the validated manifest by artifact ID while preserving the current Local response projection and keeping normalized errors as HMV-005.

## Unresolved Questions

- What is the exact run lifecycle transition/idempotency contract across approval and execution retries?
- Which interaction kinds from the agreed initial product scope reach P2 first after tab, and what restoration evidence is mandatory for each?
- What bounded user-facing evidence is sufficient without exposing raw selectors, page content or traces?
- Which redirect, DNS resolution, address range, port and egress rules form the target URL security specification?
- What are artifact size, retention and deletion guarantees for failed/cancelled runs?
- Should a report-preparation failure produce a system-failed terminal state while preserving a test outcome?
- What recovery is required when a worker stops after writing artifacts but before publishing the terminal result?
- Is pageProfile cache ever allowed across Hosted jobs, and if so what target/tenant/version isolation key is required?
- How are reviewer identity and approval audit requirements represented without changing Approval `3.0` prematurely?

## Source Evidence Index

- `package.json` — `scripts`: defines Local MVP, deterministic/LLM generation, validators, Playwright execution/report and environment commands.
- `.gitignore` — generated artifact rules: excludes engine outputs, run directories, Playwright results/reports, review state and Python environments.
- `tools/mvp/server.js` — `route`: accepts analyze/approve/execute requests and exposes status/analysis/result/report.
- `tools/mvp/server.js` — `readBody`: JSON parsing and request-size bound.
- `tools/mvp/server.js` — `serveFile`: static/report file containment and streaming.
- `tools/mvp/controller.js` — `runs`, `operationQueue`, `enqueue`: process-local state and global serialization.
- `tools/mvp/controller.js` — `validateTargetUrl`: credential-free absolute HTTP(S) validation.
- `tools/mvp/controller.js` — `createRun`, `persist`, `stage`: run directory and in-memory/file snapshot state.
- `tools/mvp/run-workspace.js` — `validateRunId`, `createRunWorkspace`, `ensureRunWorkspace`: HMV-002 run ID validation, logical path calculation, lexical/real-path containment and idempotent directory provisioning.
- `tools/mvp/run-workspace.js` — `RUN_WORKSPACE_PATH_OWNERSHIP`: HMV-003 input classification for review, executable, raw execution and public-candidate paths.
- `tools/mvp/run-workspace.test.js` — deterministic path, A/B isolation, invalid ID, containment, idempotency, no-global-mutation and failure-isolation characterization.
- `tools/mvp/artifact-manifest.js` — `ARTIFACT_IDS`, `createArtifactDefinitions`, `createArtifactManifest`, `validateArtifactManifest`, `writeArtifactManifest`: HMV-003 logical identity, relative snapshot, policy validation and atomic persistence.
- `tools/mvp/artifact-manifest.test.js` — initial/partial/present snapshot, A/B isolation, path leakage/traversal, enum/type/order, write/read, controller lifecycle and public-policy characterization.
- `tools/mvp/controller.js` — `runCommand`: adapter delegation plus legacy nonzero/allowFailure, logging and friendly-error compatibility.
- `tools/mvp/engine-invocation.js` — `createEngineInvocationRequest`, `invokeEngineProcess`: HMV-001 explicit process request, environment copy and raw terminal result boundary.
- `tools/mvp/engine-invocation.test.js` — spawn/nonzero/signal/chunk/environment/double-terminal adapter characterization.
- `tools/mvp/controller.js` — `analyzeRun`: binds orchestrator and review commands directly to workspace paths; shared-to-run copying no longer exists.
- `tools/mvp/controller.js` — `normalizeAnalysis`: Local UI projection and tab-only eligibility.
- `tools/mvp/controller.js` — `approveRun`: current Report snapshot writer/Approval validator invocation.
- `tools/mvp/controller.js` — `selectExecutionTargets`, `markInteractionSkipped`: Navigation-only semantics.
- `tools/mvp/controller.js` — `executeRun`: reconciliation, interaction plan, renderer and Playwright/report orchestration.
- `tools/mvp/playwright.config.js` — `MVP_PLAYWRIGHT_TEST_DIR`, `MVP_PLAYWRIGHT_OUTPUT_DIR`: per-invocation spec discovery and raw attachment output roots while preserving repository config/cwd.
- `tools/mvp/controller.js` — `summarizePlaywrightResult`: Local normalized result projection.
- `tools/mvp/controller.js` — `friendlyError`: current pattern-based user messages.
- `tools/mvp/public/app.js` — `pollStatus`, analyze/approve/execute handlers: one-second polling and browser flow.
- `tools/mvp/playwright.config.js` — exported config: bundled Chromium, headless, trace on, one worker, no retry.
- `tools/mvp/smoke.js` — `main`: optional real Local UI/browser/report smoke harness.
- `tools/environment/run-python.js` — top-level wrapper: project Python/uv/pinned requirements for npm Python commands.
- `tools/ai-generator/agent_orchestrator.py` — `run_plan_generation_pipeline`: current complete deterministic navigation entrypoint.
- `tools/ai-generator/agent_orchestrator.py` — `run_scout`, `run_page_profile_scout`: Python-to-Node/stdout and fixed temp-file boundaries.
- `tools/ai-generator/agent_orchestrator.py` — `configure_artifact_paths`, `build_and_save_menu_map`: backward-compatible defaults plus explicit generated/spec output override used by Local workspace binding.
- `tools/ai-generator/render_test_plan.py` — `render_file`: output-relative helper imports allow workspace specs without absolute local paths.
- `tools/ai-generator/agent_orchestrator.py` — `run_subprocess_stage`: builder/validator/renderer child boundaries.
- `tools/ai-generator/scout.js` — `scoutSite`, `collectPrimaryMenuPageProfiles`: browser discovery and stdout JSON.
- `tools/ai-generator/build_test_plan.py` — `build_test_plan`, `write_json`: deterministic navigation plan producer.
- `tools/ai-generator/validate_test_plan.py` — `validate`: navigation schema/coverage gate.
- `tools/ai-generator/render_test_plan.py` — `render_spec`, `render_file`: deterministic navigation spec producer.
- `tools/ai-generator/classify_interaction_candidates.py` — `classify_interaction_candidates`: safe/unsafe/unknown policy and identity.
- `tools/ai-generator/build_analysis_review_report.py` — `build_report`: classifier integration and Report `2.1` creation.
- `tools/ai-generator/write_interaction_approvals.py` — `build_artifact`, `write_artifact`: exact current evidence and atomic Approval `3.0` write.
- `tools/ai-generator/validate_interaction_approvals.py` — `validate_approval_artifact`: strict approval contract.
- `tools/ai-generator/reconcile_interaction_approvals.py` — `reconcile_approvals`: exact stale/reference/eligibility computation.
- `tools/ai-generator/interaction_plan_contract.py` — `bind_plan_inputs`, `write_json`: report/reconciliation binding and atomic plan output.
- `tools/ai-generator/build_interaction_plan.py` — `build_interaction_plan`: eligible candidate to bounded Plan `3.0`.
- `tools/ai-generator/validate_interaction_plan.py` — `validate_plan`: exact evidence/template/state gate.
- `tools/ai-generator/render_interaction_plan.py` — `render_spec`, `write_source_atomic`: fixed interaction code shape and atomic output.
- `tools/ai-generator/validate_generated_spec.py` — `validate`: legacy direct-spec static evidence validator, manual in current Local flow.
- `tools/mvp/controller.test.js` — controller boundary tests.
- `tools/ai-generator/test_agent_orchestrator_invocation.py` — deterministic builder/validator/renderer command ordering and current validator argument characterization.
- `tools/mvp/bootstrap.test.js` — Local Playwright execution setting test.
- `tools/mvp/public/app.test.js` — dependency-free Local UI behavior tests.
- `tools/ai-generator/test_write_interaction_approvals.py` — approval writer unit tests.
- `docs/LOCAL_MVP.md` — current reference product flow and stated limitations.
- `docs/MODULE_MAP.md`, `docs/DATA_FLOW.md` — established module responsibility and data-flow contracts.
- `docs/PUBLIC_REPOSITORY_DATA_POLICY.md` — target-derived/public sanitization policy.
