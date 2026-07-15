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
- interaction candidate deduplication과 future reference를 위한 deterministic `candidateKey`
- strict interaction approval artifact validation
- exact `candidateKey`와 immutable evidence snapshot 기반 deterministic reconciliation
- valid/missingCandidate/evidenceChanged reference status와 approved-only eligible candidate output
- eligible candidate 기반 Structured Interaction Plan schema `1.0` documentation contract
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
- `safe` classification은 실행 승인과 동일하지 않다. 실제 Level 3 interaction 실행은 아직 구현되지 않았다.
- interaction plan은 reconciliation eligible candidate만 exact `candidateKey`로 참조하고, free-form code 없이 bounded state/reset instruction만 표현한다.
- generated artifact는 기본적으로 commit하지 않으며 tracked fixture 예외만 repository 정책에 따라 유지한다.

## Current Development Frontier

현재 중심 frontier는 documentation contract로 확정된 Structured Interaction Plan을 executable builder/validator 계층으로 연결하는 경계다.

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
- `interactionKind`와 execution plan template을 분리한 Structured Interaction Plan schema `1.0` contract
- exact eligible `candidateKey`/target snapshot과 bounded initial/expected/restored state 계약
- page UI reset/restore를 data rollback과 분리한 reversible interaction 계약

열린 boundary:

- approval artifact writer/editor
- deterministic interaction plan builder와 unsupported diagnostic
- interaction plan validator
- Level 3 deterministic renderer와 reset/restore execution

이 frontier는 interaction을 즉시 클릭하는 작업과 다르다. Structured Interaction Plan은 contract만 정의되었고 builder/validator, Approval writer/editor와 Level 3 execution은 아직 구현되지 않았다.

## Latest Completed Work

가장 최근 완료된 architecture 작업은 Structured Interaction Plan documentation contract 정의다. 가장 최근 완료된 구현 작업은 Interaction Approval Contract의 executable validation/reconciliation layer다.

Structured Interaction Plan contract:

- schema version: `1.0`
- input boundary: reconciliation `eligibleCandidates[]`와 exact current report state evidence
- supported template: `interaction.tabSelection`, `interaction.expandedToggle`
- primary reference: exact eligible `candidateKey`; selector/interactionKind/pageContext는 eligible payload에서 exact copy
- bounded initial/expected/restored state와 required reset strategy
- page-level UI `reset`/`restore`를 사용하며 data mutation rollback은 범위 밖
- plan builder, validator, renderer와 browser execution은 구현하지 않음

Approval validation/reconciliation implementation:

- 기본 local review state 경로: `tools/ai-generator/review/interaction_approvals.json`
- schema version: `1.0`
- human decision: `approved`, `held`, `rejected`
- primary reference: deterministic `candidateKey`; target URL과 최소 evidence snapshot을 함께 보존
- stale은 decision이 아니라 reconciliation status이며 missing key/evidence change 시 automatic carry-forward를 금지
- future eligibility: current `safe` AND human `approved` AND valid non-stale reference
- approval artifact와 future interaction plan의 template/state/reset 책임을 분리
- `validate_interaction_approvals.py`의 strict schema/unknown-field/duplicate/conditional invariant 검증
- `reconcile_interaction_approvals.py`의 valid/missingCandidate/evidenceChanged 판정과 deterministic result 생성
- approval entry가 없는 current candidate의 별도 unreviewed output

Approval writer/editor, structured interaction plan builder/validator와 browser interaction은 구현하지 않았다. Reconciliation result는 generated artifact이며 human-authored review state와 분리된다.

## Open Questions / Next Decisions

현재 frontier에서 바로 결정할 항목만 유지한다.

1. Deterministic interaction plan builder의 output path, unsupported diagnostic과 provenance 확인 방식
2. Interaction plan validator의 error contract와 reconciliation/report input binding
3. Approval artifact writer/editor의 local review workflow와 overwrite/re-review 경계
4. Level 3 renderer의 fixed locator/assertion과 reset/restore execution contract

검수 UI, workspace history, Level 3 execution은 위 계약 이후의 단계다.

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

