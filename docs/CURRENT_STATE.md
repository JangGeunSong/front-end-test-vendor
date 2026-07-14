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
- generated artifact는 기본적으로 commit하지 않으며 tracked fixture 예외만 repository 정책에 따라 유지한다.

## Current Development Frontier

현재 중심 frontier는 classified interaction candidate를 human approval 및 structured interaction plan으로 안전하게 연결하는 경계다.

완료된 부분:

- 기존 artifact에서 interaction 후보 수집
- safe/unsafe/unknown의 보수적 deterministic 분류
- 분류 evidence, confidence, risk, recommended action을 JSON/Markdown report에 표시
- 동일 normalized candidate를 참조하는 deterministic `candidateKey`

열린 boundary:

- 사람이 승인·보류·거절한 결과를 어떤 versioned artifact로 저장할지
- approval이 어떤 `candidateKey`와 evidence snapshot을 참조해야 하는지
- selector/page context 변화로 key가 달라졌을 때 stale approval을 어떻게 감지할지
- 승인된 safe 후보만 structured interaction plan으로 변환하는 계약
- interaction plan validator와 reversible state assertion/rollback 계약

이 frontier는 interaction을 즉시 클릭하는 작업과 다르다. approval contract와 plan validation 없이 Level 3 browser execution을 먼저 구현하지 않는다.

## Latest Completed Work

가장 최근 완료된 구현은 deterministic interaction `candidateKey`다.

- 목적: classified candidate를 배열 index나 selector 원문 전체 대신 stable identity로 review/approval 및 future plan에서 참조하기 위함
- 형식: `interaction:<selector|fallback>:<24-character SHA-256 digest>`
- selector가 있는 경우 canonical input: normalized `pageContext`와 `selector`
- selector가 없는 경우 fallback input: normalized `pageContext`, `role`, `type`, `tagName`, case-folded `text`
- classification, 배열 index, 생성 시각, Python process `hash()`는 identity에 포함하지 않음
- 동일 identity가 여러 source에서 수집되면 key 하나로 dedup하고 `candidateSources`를 병합
- selector 또는 page context가 바뀌면 key가 바뀔 수 있음
- safe/unsafe/unknown classifier output과 Analysis Review Report JSON에서 key를 보존하고 Markdown Candidate Details에 표시

fixture는 key 존재·유일성·반복 안정성, selector 없는 fallback, source 병합, safe `interactionKind`, unsafe `actionKind`/`riskLevel`을 검증한다.

## Open Questions / Next Decisions

현재 frontier에서 바로 결정할 항목만 유지한다.

1. Approval artifact의 version, 저장 위치, decision 값, reviewer/evidence metadata 범위
2. `candidateKey` 변경 또는 미발견 시 기존 approval을 stale로 처리하는 규칙
3. approved candidate에서 structured interaction plan으로 변환할 최소 field와 template 계약
4. unsafe/unknown 또는 승인되지 않은 candidate를 plan validator가 차단하는 방식
5. reversible interaction의 expected state, close/rollback, failure evidence 계약

검수 UI, workspace history, Level 3 execution은 위 계약 이후의 단계다.

## Recommended Reading by Task

- pipeline/projection 변경: [DATA_FLOW.md](DATA_FLOW.md), [MODULE_MAP.md](MODULE_MAP.md)
- 제품/지원 범위 판단: [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md), [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md), [TEST_LEVELS.md](TEST_LEVELS.md)
- structured navigation plan: [TEST_PLAN_SCHEMA.md](TEST_PLAN_SCHEMA.md), [TEST_TEMPLATE_CATALOG.md](TEST_TEMPLATE_CATALOG.md), [STRUCTURED_PLAN_MIGRATION.md](STRUCTURED_PLAN_MIGRATION.md)
- prompt 변경: [PROMPT_STRATEGY.md](PROMPT_STRATEGY.md)
- Playwright 생성 규칙: [PLAYWRIGHT_CONVENTION.md](PLAYWRIGHT_CONVENTION.md), [TEST_GENERATION_RULES.md](TEST_GENERATION_RULES.md)
- interaction/review 작업: [SAFE_INTERACTION_STRATEGY.md](SAFE_INTERACTION_STRATEGY.md), [ANALYSIS_REVIEW_REPORT.md](ANALYSIS_REVIEW_REPORT.md), [JSON_SCHEMA.md](JSON_SCHEMA.md)
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

