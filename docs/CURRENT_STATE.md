# Current Project State

## Purpose of This Document

이 문서는 새 PC, 새 agent, 새 session이 conversation history 없이 현재 repository snapshot을 빠르게 복원하기 위한 진입점이다. 프로젝트의 일별 history를 요약하지 않으며, 현재 안정화된 capability, active development frontier, 최신 완료 작업, 아직 결정이 필요한 경계만 기록한다.

상대적으로 안정적인 제품 목적과 architecture 개요는 [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md), 과거 작업 근거는 필요할 때만 [TASK_LOG.md](TASK_LOG.md)를 참고한다.

## Current Product / System Goal

이 프로젝트는 URL-first WEB test generation AX pipeline이다. 대상 URL에서 rendered DOM을 분석해 navigation, Page Identity, interaction 후보와 그 근거를 구조화하고, 검증 가능한 structured plan과 deterministic Playwright spec으로 변환한다.

목표는 LLM이 임의의 테스트 코드를 작성하게 하는 것이 아니라, 문서와 기존 TC가 부족한 환경에서도 coverage, 제외 근거, unresolved 후보, review artifact가 남는 human-in-the-loop 자동화 경로를 제공하는 것이다.

## Current Pipeline

현재 primary navigation/Page Identity 실행 경로:

```text
target URL (--url or TARGET_URL)
  -> tools/ai-generator/agent_orchestrator.py
  -> tools/ai-generator/scout.js rendered DOM discovery
  -> tools/ai-generator/generated/scout_result.json
  -> primary navigation projection + pageProfile collection/cache
  -> tools/ai-generator/generated/menu_map.json
  -> deterministic plan builder or LLM structured plan generation
  -> tools/ai-generator/validate_test_plan.py (schema + menu coverage)
  -> optional deterministic/LLM plan comparison quality gate
  -> tools/ai-generator/render_test_plan.py
  -> tests/generated/generated_from_plan.spec.js
  -> Playwright execution and visual review
```

`agent_orchestrator.py`는 `spec`, `plan`, `llm-plan` mode를 유지한다. `spec`은 legacy direct-JS 경로이고, 현재 제품 방향은 structured plan 기반 `plan`/`llm-plan` 경로다. `plan`은 deterministic builder를, `llm-plan`은 LLM의 structured JSON 판단을 사용하며 둘 다 validator와 deterministic renderer 경계를 통과한다.

현재 analysis/review 경로:

```text
scout_result.json + menu_map.json + test_plan.llm.json
  -> tools/ai-generator/classify_interaction_candidates.py
  -> tools/ai-generator/build_analysis_review_report.py
  -> tools/ai-generator/generated/analysis_review_report.json
  -> tools/ai-generator/render_analysis_review_report.py
  -> tools/ai-generator/generated/analysis_review_report.md
  -> human review
```

이 경로는 기존 artifact만 읽으며 browser interaction이나 외부 LLM 호출을 수행하지 않는다.

현재 approval validation/reconciliation 경로:

```text
analysis_review_report.json
  + tools/ai-generator/review/interaction_approvals.json
  -> tools/ai-generator/validate_interaction_approvals.py
  -> tools/ai-generator/reconcile_interaction_approvals.py
  -> tools/ai-generator/generated/interaction_approval_reconciliation.json
  -> eligible approved candidates / unreviewed candidates
```

이 경로는 approval artifact validation 또는 target scope/current evidence validation이 실패하면 partial result를 만들지 않는다.

## Stable Capabilities

현재 구현되어 기본 architecture로 취급하는 capability:

- CLI `--url` 우선, `TARGET_URL` fallback 방식의 target URL 입력. 둘 다 없으면 명시적으로 실패한다.
- framework-agnostic rendered DOM discovery와 broad navigation/action candidate 수집
- Level 1 primary navigation smoke test와 Level 2 Page Identity MVP
- broad discovery를 `primaryMenuTree`, non-primary, utility, CTA, footer, unresolved 후보로 분리하는 projection
- primary menuPath 기반 pageProfile 수집과 cache
- deterministic `build_test_plan.py`와 LLM structured plan generation 경로
- structured plan schema, duplicate, optional field, primary menu coverage validation
- deterministic plan과 LLM plan의 meaningful difference 비교 및 opt-in gate
- URL assertion, locator 형태, test title을 고정하는 deterministic Playwright renderer
- plan의 `openTriggerCssPath`/`hoverTargetCssPath`를 우선 사용하는 generic navigation open/click helper
- Analysis Review Report JSON/Markdown 생성
- safe/unsafe/unknown interaction candidate classification과 report integration
- explicit tablist와 exactly-one selected peer를 보존하는 bounded `tabRestore` evidence, unavailable reason과 Analysis Review Report `2.1`
- interaction candidate deduplication과 future reference를 위한 deterministic `candidateKey`
- root scout final URL과 pageProfile `navigation.url`에서 수집하는 required interaction `observedUrl` provenance
- bounded restore pair를 요구하는 Interaction Approval schema `3.0` strict validation
- exact `candidateKey`와 immutable target/restore evidence snapshot 기반 Approval Reconciliation schema `3.0`
- valid/missingCandidate/evidenceChanged reference status와 approved-only eligible candidate output
- eligible target/restore pair 기반 Structured Interaction Plan schema `3.0`과 per-test exact `startUrl`
- reconciliation/report exact join 기반 deterministic interaction plan builder
- supported template/state/reset/eligibility/evidence를 strict하게 검증하는 interaction plan validator
- validated schema `3.0` plan을 exact per-test `startUrl`/interaction/restore selector와 fixed paired state assertion으로 변환하는 deterministic interaction renderer
- generated interaction spec의 JavaScript syntax와 Playwright test discovery validation
- project venv, requirements, fnm, repository Node version, local `.env` policy를 복원하는 documented environment bootstrap
- generated artifact와 source/docs를 분리하는 ignore 정책

검증된 site type은 complex multi-depth GNB 41 tests, PC/MO overlay navigation 17 tests, direct documentation navigation 8 tests다. 이는 현재 일반화 근거이지 모든 사이트의 무보정 지원을 보장하지 않는다.

## Architecture Boundaries and Invariants

- LLM은 Playwright JavaScript helper, regex, locator code shape를 소유하지 않는다. LLM의 역할은 structured plan의 template과 근거 선택이다.
- executable Playwright shape는 deterministic renderer가 소유한다.
- structured plan은 validator를 통과해야 하며 coverage/schema/compare gate를 조용히 우회하지 않는다.
- generated spec과 generated JSON/Markdown은 원인 수정 없이 직접 고치는 대상이 아니다. 오류는 scout, projection, pageProfile, prompt/normalization, validator, renderer, helper 중 원인이 있는 계층에서 수정한다.
- selector와 Page Identity evidence는 exact menuPath의 수집 근거를 사용한다. sibling fallback, selector 축약·합성·임의 생성은 허용하지 않는다.
- 특정 사이트명, URL, 메뉴명 전용 예외보다 DOM/evidence 기반 일반화 규칙을 우선한다.
- interaction `candidateKey`와 deduplication은 동일 canonical identity를 사용한다. key는 classification이나 승인 상태에 의존하지 않는다.
- `target.url`은 분석 scope, candidate `observedUrl`은 실제 관찰 위치, plan `startUrl`은 exact execution entry point다. pageContext나 target root에서 URL을 추론하지 않는다.
- `safe` classification은 실행 승인과 동일하지 않다. 첫 `tabSelection` browser run에서 navigation과 false → true transition은 확인했지만 `reloadPage` restore가 실패했으므로 Level 3 runtime capability는 아직 완료되지 않았다.
- interaction plan은 reconciliation eligible candidate만 exact `candidateKey`로 참조하고, free-form code 없이 bounded state/reset instruction만 표현한다.
- generated artifact는 기본적으로 commit하지 않으며 tracked fixture 예외만 repository 정책에 따라 유지한다.

## Current Development Frontier

현재 중심 frontier는 static validation을 마친 Plan schema `3.0`/deterministic renderer를 network-accessible explicit-tablist candidate에서 actual browser runtime으로 검증하는 것이다. Schema `2.0`의 `reloadPage` tab restore는 source에서 제거됐다.

완료된 부분:

- 기존 artifact에서 interaction 후보 수집
- safe/unsafe/unknown의 보수적 deterministic 분류
- 분류 evidence, confidence, risk, recommended action을 JSON/Markdown report에 표시
- 동일 normalized candidate를 참조하는 deterministic `candidateKey`
- `approved`/`held`/`rejected` human decision과 최소 immutable evidence snapshot을 저장하는 versioned approval artifact contract
- exact `candidateKey`와 snapshot을 기준으로 stale reference를 판정하고 heuristic approval carry-forward를 금지하는 reconciliation contract
- current `safe` + human `approved` + valid non-stale reference를 future plan eligibility로 사용하는 규칙
- strict approval artifact validator와 deterministic error category/path output
- Analysis Review Report current candidate와 approval artifact의 exact key/evidence reconciliation
- deterministic reconciliation result artifact, eligible candidate set, unreviewed candidate set
- `interactionKind`와 execution plan template을 분리한 Structured Interaction Plan schema `3.0` contract
- discovery의 actual browser URL을 report, approval snapshot, stale comparison, eligible payload와 plan `startUrl`까지 exact하게 전달하는 provenance chain
- exact eligible `candidateKey`/target snapshot과 bounded initial/expected/restored state 계약
- page UI reset/restore를 data rollback과 분리한 reversible interaction 계약
- reconciliation `eligibleCandidates`와 Analysis Review Report exact evidence를 join하는 deterministic plan builder
- `interaction.tabSelection`, `interaction.expandedToggle`만 생성하고 unsupported candidate를 CLI summary로 분리하는 bounded mapping
- eligible membership, exact selector/context/kind, deterministic ID/order, bounded state/reset과 unknown field를 검증하는 strict plan validator
- `interaction.tabSelection`과 `interaction.expandedToggle`만 fixed Playwright shape로 렌더링하는 deterministic interaction renderer
- exact `startUrl`의 `page.goto`, exact selector locator, initial/expected/reset/restored assertion과 stable test traceability
- timestamp/absolute path 없는 byte-stable UTF-8 generated spec과 JavaScript syntax/Playwright discovery 검증
- closest explicit `role=tablist` ancestor의 unique exact selector와 exactly-one selected peer를 수집하는 tab restore evidence producer
- weak parent/sibling/class/text/index inference 없이 readiness failure를 bounded reason으로 보존하는 classifier
- optional `tabRestore`와 ready/unavailable summary를 보존·표시하는 Analysis Review Report `2.1`
- approved unselected tab의 human-reviewed bounded pair를 요구하는 Approval schema `3.0` validator
- restore evidence와 current peer를 exact 비교하고 stable bounded `changedFields`를 만드는 Reconciliation schema `3.0`
- Reconciliation `3.0`/Report `2.1`만 소비하고 target+restore evidence를 exact join하는 Plan `3.0` builder
- tab paired state/restore exact-copy와 expandedToggle reset을 strict 검증하는 Plan `3.0` validator
- exact interaction/restore selector를 클릭하고 paired state를 assertion하는 deterministic renderer
- neutral 3-test generated spec의 Node syntax와 Playwright `--list` discovery

기반 architecture contract와 이번 구현에서 완료된 부분:

- tab runtime navigation, exact locator, initial false, target click과 expected true transition 확인
- reload action과 post-reload locator re-resolution 확인
- reload 후 target true 지속으로 `reloadPage` restore failure 확인
- closest explicit `role=tablist` ancestor exact selector를 사용하는 tab group identity
- same group의 exactly-one selected peer와 exact restore selector evidence
- interaction target + restore target bounded human-approved execution pair
- Analysis Review Report `2.1`, approval/reconciliation `3.0`, plan `3.0` version 결정
- plan `restore.strategy = restorePreviousSelection`과 paired initial/expected/restored state
- builder/validator/renderer가 DOM/runtime inference를 하지 않는 책임 경계

구현되지 않은 boundary:

- approval artifact writer/editor
- `tabSelection` runtime PASS
- `expandedToggle` runtime validation
- runtime failure evidence/screenshot/execution report

Renderer는 validated Plan `3.0`만 executable source shape로 변환한다. TabSelection은 exact target/restore selector 두 개와 paired false/true → true/false → false/true assertion을 생성하며 reload나 runtime peer search를 사용하지 않는다. Approval writer/editor와 repeatable Level 3 browser restore capability는 아직 완료되지 않았다.

Version transition은 완료됐다. `interaction_plan_contract.py`는 Reconciliation `3.0`, Report `2.1`, Plan `3.0`만 허용하며 old `2.0`을 silent accept하지 않는다.

## Latest Completed Work

가장 최근 완료된 작업은 Reconciliation `3.0` eligible pair를 Plan `3.0`과 deterministic `restorePreviousSelection` spec으로 연결하고 static discovery를 검증한 task다. Browser runtime PASS를 완료한 것은 아니다.

Tab previous-selection restore contract:

- 별도 permanent group ID 없이 closest explicit `role=tablist` ancestor의 exact `tabGroupSelector`를 사용
- explicit group relation이 없는 tab-like UI는 MVP execution restore에서 제외
- current same-group `aria-selected=true` peer가 정확히 하나일 때만 bounded `tabRestore` evidence 생성
- restore peer는 existing candidateKey를 nested snapshot에 보존하지만 별도 approval decision을 요구하지 않음
- interaction target과 restore target의 두 selector/click을 하나의 human-reviewed pair로 승인
- pair evidence 변경/누락은 primary target이 존재하는 한 existing `evidenceChanged`; primary target key 부재만 `missingCandidate`
- report `2.1`과 approval/reconciliation `3.0` 구현, plan `3.0` 결정
- tab plan의 `reset.reloadPage`를 제거하고 `restorePreviousSelection` 및 paired state assertions 정의
- expandedToggle `reset.toggleSameTarget` contract는 유지
- first/sibling/text/index/common-class/runtime selected search와 renderer selector inference 금지

Interaction renderer implementation:

- default input/output: `tools/ai-generator/generated/interaction_plan.generated.json` → `tests/generated/generated_interaction_plan.spec.js`
- 각 test의 exact `startUrl`과 selector를 semantic change 없이 JavaScript literal로 encoding
- `interaction.tabSelection`: selected false → click → true → reload → target re-resolution → false
- `interaction.expandedToggle`: expanded false → click → true → same target click → false
- unsupported template와 malformed/missing renderer field에서 전체 fail-fast하고 output을 부분 갱신하지 않음
- neutral fixture 반복 rendering byte equality, Node syntax와 Playwright `--list` discovery 통과
- Renderer implementation task에서는 browser를 실행하지 않았고, subsequent tab runtime task에서 click transition 성공과 reload restore failure를 확인

Execution URL provenance implementation:

- root candidate는 scout의 final `window.location.href`, pageProfile candidate는 click 후 `page.url()`을 source of truth로 사용
- safe/unsafe/unknown 모든 interaction candidate와 Analysis Review Report JSON/Markdown에 `observedUrl` 보존
- approval evidence snapshot과 reconciliation review-critical comparison에 `observedUrl` 포함
- exact candidateKey가 같아도 URL이 바뀌면 `evidenceChanged`; candidateKey algorithm은 유지
- eligible payload의 `observedUrl`과 report evidence를 exact join해 plan `tests[].startUrl` 생성
- absolute credential-free HTTP(S), target same-origin, query/hash/trailing slash exact equality를 validator가 검증
- Playwright public site fresh discovery에서 root와 nested observed URL을 가진 real artifact chain을 plan validation까지 확인

Structured Interaction Plan implementation:

- schema version: `3.0`
- input boundary: reconciliation `eligibleCandidates[]`와 exact current report state evidence
- supported template: `interaction.tabSelection`, `interaction.expandedToggle`
- primary reference: exact eligible `candidateKey`; startUrl/selector/interactionKind/pageContext는 eligible/report evidence에서 exact copy
- tab의 bounded paired initial/expected/restored state와 exact `restorePreviousSelection`; expandedToggle의 existing reset strategy
- page-level UI `reset`/`restore`를 사용하며 data mutation rollback은 범위 밖
- exact candidateKey join과 target/evidence mismatch fail-fast
- supported state evidence가 있는 `tabSelection`/`expandedToggle`만 executable plan case로 생성
- unsupported candidate는 plan에 넣지 않고 bounded CLI diagnostic으로 보고
- candidateKey/template 기반 deterministic ID, candidateKey ordering, timestamp 없는 byte-stable JSON
- strict schema/unknown field/duplicate/eligibility/exact evidence/template/state/reset validation

Approval validation/reconciliation implementation:

- 기본 local review state 경로: `tools/ai-generator/review/interaction_approvals.json`
- schema version: `3.0`
- human decision: `approved`, `held`, `rejected`
- primary reference: deterministic `candidateKey`; target scope URL과 actual `observedUrl`을 포함한 최소 evidence snapshot을 함께 보존
- stale은 decision이 아니라 reconciliation status이며 missing key/evidence change 시 automatic carry-forward를 금지
- future eligibility: current `safe` AND human `approved` AND valid non-stale reference
- approval artifact와 future interaction plan의 template/state/reset 책임을 분리
- `validate_interaction_approvals.py`의 strict schema/unknown-field/duplicate/conditional invariant 검증
- `reconcile_interaction_approvals.py`의 valid/missingCandidate/evidenceChanged 판정과 deterministic result 생성
- approval entry가 없는 current candidate의 별도 unreviewed output

Approval writer/editor와 repeatable Level 3 browser interaction capability는 완료되지 않았다. Reconciliation result, interaction plan과 generated interaction spec은 human-authored review state와 분리된다.

## Latest Runtime Validation Finding

Playwright public-site의 approved `yarn` tab generated spec 한 건을 retry 0으로 실행했다.

- exact `startUrl` navigation과 selector resolution 성공
- initial `aria-selected=false`, click, expected `aria-selected=true` 성공
- `page.reload()` 성공 후 URL과 exact selector는 유지
- page가 selected tab state를 reload 사이에 보존해 restored `aria-selected=false` assertion 실패
- screenshot, trace, HTML report와 DOM snapshot으로 동일 target이 `aria-selected=true`인 상태를 확인

이는 renderer가 plan을 잘못 해석한 문제가 아니라 `reloadPage`를 generic tab restore로 정의한 template/reset contract gap이었다. Storage clear, selector fallback, assertion 완화 또는 generated spec hand edit로 우회하지 않았다. Explicit same-group evidence부터 Plan `3.0`과 exact restore click renderer까지 구현했으며 actual runtime PASS만 아직 확인하지 않았다.

이번 task의 fresh public-site deterministic analysis는 샌드박스의 outbound network 차단으로 root navigation이 `ERR_NETWORK_ACCESS_DENIED`에 실패했고, 권한 상승 요청도 승인되지 않아 실행하지 못했다. Existing ignored public artifact를 새 classifier/report로 재분류한 결과는 unselected tab 12개, restore-ready 0개, `missingTabGroupEvidence` 12개였지만 이는 fresh DOM observation이 아니므로 public structure의 durable 근거로 사용하지 않는다.

## Next Implementation Frontier

```text
network-accessible explicit-tablist candidate
  -> target click paired transition
  -> exact previous-selection restore click
  -> paired restored-state PASS
```

그 다음 분리된 결정은 browser validation execution report contract와 approval writer/editor local workflow다. ExpandedToggle runtime, 검수 UI와 workspace history는 이번 frontier에 포함하지 않는다.

## Recommended Reading by Task

- pipeline/projection 변경: [DATA_FLOW.md](DATA_FLOW.md), [MODULE_MAP.md](MODULE_MAP.md)
- 제품/지원 범위 판단: [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md), [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md), [TEST_LEVELS.md](TEST_LEVELS.md)
- structured navigation plan: [TEST_PLAN_SCHEMA.md](TEST_PLAN_SCHEMA.md), [TEST_TEMPLATE_CATALOG.md](TEST_TEMPLATE_CATALOG.md), [STRUCTURED_PLAN_MIGRATION.md](STRUCTURED_PLAN_MIGRATION.md)
- prompt 변경: [PROMPT_STRATEGY.md](PROMPT_STRATEGY.md)
- Playwright 생성 규칙: [PLAYWRIGHT_CONVENTION.md](PLAYWRIGHT_CONVENTION.md), [TEST_GENERATION_RULES.md](TEST_GENERATION_RULES.md)
- interaction/review 작업: [SAFE_INTERACTION_STRATEGY.md](SAFE_INTERACTION_STRATEGY.md), [ANALYSIS_REVIEW_REPORT.md](ANALYSIS_REVIEW_REPORT.md), [INTERACTION_APPROVAL_CONTRACT.md](INTERACTION_APPROVAL_CONTRACT.md), [STRUCTURED_INTERACTION_PLAN.md](STRUCTURED_INTERACTION_PLAN.md), [JSON_SCHEMA.md](JSON_SCHEMA.md)
- local command/bootstrap 작업: [DEVELOPMENT_ENVIRONMENT.md](DEVELOPMENT_ENVIRONMENT.md)
- 외부 LLM 및 폐쇄망 판단: [OFFLINE_NETWORK_POLICY.md](OFFLINE_NETWORK_POLICY.md)
- 검증된 일반화 근거: [CROSS_SITE_VALIDATION.md](CROSS_SITE_VALIDATION.md)
- 과거 실패 원인과 변경 이력: 필요한 경우에만 [TASK_LOG.md](TASK_LOG.md)

현재 standalone `DECISIONS.md`와 `ROADMAP.md`는 없다. architecture contract는 `AGENTS.md`, `PROJECT_OVERVIEW.md`, 이 문서와 관련 전문 설계 문서를 기준으로 확인한다.

## Handoff Checklist

다른 PC/session으로 넘기기 전 최소 확인:

- source, schema, 관련 전문 문서가 같은 구현 상태를 설명하는지 확인한다.
- stable capability, active frontier, latest completed work가 바뀌면 이 문서를 갱신한다.
- cross-cutting architecture decision은 관련 계약/설계 문서와 `TASK_LOG.md`에 근거를 남긴다.
- meaningful implementation 작업은 `TASK_LOG.md`에 기록하되 이 문서에 history를 복제하지 않는다.
- 변경 비용에 맞는 syntax/fixture/validator/integration 검증을 수행하고 결과를 기록한다.
- generated artifact가 commit 대상에 섞이지 않았는지 `git status`와 ignore 정책을 확인한다.
- 변경 범위와 commit을 확인하고 공유가 필요하면 remote에 push한다.

