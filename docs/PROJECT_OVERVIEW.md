# Project Overview

이 문서는 프로젝트의 상대적으로 안정적인 identity, goal, architecture overview를 제공한다. 현재 repository snapshot, active frontier, latest completed work는 [CURRENT_STATE.md](CURRENT_STATE.md)를 따르고, 세부 규칙은 관련 전문 문서를 따른다.

## Product Mission

이 프로젝트는 URL-first WEB test generation AX pipeline이다. 대상 URL을 입력하면 실제 브라우저로 웹 UI를 탐색하고, primary navigation과 page identity 근거를 수집한 뒤, structured test plan과 deterministic Playwright spec을 생성하는 것을 목표로 한다.

## Core Value

핵심 가치는 문서, QA 인력, 기존 테스트 케이스가 부족한 환경에서도 웹 검증 대상을 분석 가능한 구조로 바꾸는 것이다.

이 프로젝트는 테스트 실행 파일만 생성하지 않는다. 함께 제공해야 할 것은 다음이다.

- 수집된 UI 후보
- primary navigation projection
- page identity 근거
- coverage
- 제외 후보와 unresolved 후보
- validator와 quality gate 결과
- 사람이 검수할 수 있는 review artifact

## Target Users

- QA 전담 인력이 없는 소규모 제품 팀
- 1인 SaaS 또는 소규모 비즈니스 운영자
- 문서와 TC가 부족한 레거시 웹 제품 담당자
- 유지보수/SM 업체
- 외부 SaaS 사용이 어렵거나 제한적인 on-premise/폐쇄망 조직

## Established Architecture Baseline

Level 1 navigation과 Level 2 Page Identity, structured plan validation, deterministic rendering, evidence-based review artifact는 현재 architecture baseline이다. Interaction 후보 분류, actual observed URL provenance, tab group/previous selected peer evidence, Analysis Review Report `2.1`, human approval/reconciliation `3.0`, Structured Interaction Plan `3.0` builder/validator와 fixed restore renderer가 구현되어 있다. Fresh public evidence chain의 `interaction.tabSelection` previous-selection restore는 retry 없이 2회 browser PASS를 확인했다.

현재 capability checklist, active frontier, latest completed work는 [CURRENT_STATE.md](CURRENT_STATE.md)에 유지한다.

## Current Architecture

주요 원칙:

- LLM은 Playwright JavaScript를 직접 작성하지 않는다.
- LLM은 structured test plan의 template과 후보 근거를 판단한다.
- validator가 schema, coverage, 중복, optional field를 검증한다.
- renderer가 executable Playwright code shape를 deterministic하게 생성한다.
- helper는 plan에 포함된 open/click 근거를 사용해 navigation을 수행한다.

## Main Data Flow

```text
target URL
  -> scout.js rendered DOM discovery
  -> scout_result.json
  -> agent_orchestrator.py projection
  -> menu_map.json
  -> primaryMenuTree-based pageProfile collection
  -> LLM structured test plan JSON
  -> validate_test_plan.py
  -> render_test_plan.py
  -> tests/generated/generated_from_plan.spec.js
  -> Playwright execution
```

기존 direct generated spec 경로도 남아 있지만, 제품 방향은 structured plan + validator + renderer 중심이다.

## Main Modules And Responsibilities

- `tools/ai-generator/scout.js`: 대상 URL의 rendered DOM에서 navigation/action/pageProfile 후보를 수집한다.
- `tools/ai-generator/agent_orchestrator.py`: scout 실행, menu_map projection, pageProfile cache, LLM structured plan 생성, plan/render orchestration을 담당한다.
- `tools/ai-generator/build_test_plan.py`: deterministic plan을 menu_map에서 생성한다.
- `tools/ai-generator/validate_test_plan.py`: structured test plan schema와 coverage를 검증한다.
- `tools/ai-generator/render_test_plan.py`: structured test plan을 Playwright spec으로 렌더링한다.
- `tools/ai-generator/compare_test_plans.py`: deterministic plan과 LLM plan의 meaningful quality difference를 비교한다.
- `tools/ai-generator/classify_interaction_candidates.py`: 기존 artifact의 action 후보를 safe, unsafe, unknown으로 분류하고 deterministic `candidateKey`와 source-provided `observedUrl`을 보존한다.
- `tools/ai-generator/build_analysis_review_report.py`: navigation, Page Identity, interaction 분류 evidence를 JSON review artifact로 구성한다.
- `tools/ai-generator/render_analysis_review_report.py`: Analysis Review Report JSON을 사람이 읽을 수 있는 Markdown으로 렌더링한다.
- `tools/ai-generator/validate_interaction_approvals.py`: human approval artifact를 strict하게 검증한다.
- `tools/ai-generator/reconcile_interaction_approvals.py`: current report candidate와 validated approval을 deterministic하게 대조해 eligibility를 생성한다.
- `tools/ai-generator/build_interaction_plan.py`: eligible candidate와 exact report state evidence를 deterministic bounded interaction plan으로 변환한다.
- `tools/ai-generator/validate_interaction_plan.py`: plan schema, eligibility, exact evidence, template와 bounded state/reset contract를 strict하게 검증한다.
- `tools/ai-generator/render_interaction_plan.py`: validated interaction plan의 exact startUrl/selector와 두 fixed template을 deterministic Playwright spec으로 렌더링한다.
- `utils/gnb.js`: plan 기반 navigation open/click helper를 제공한다.
- `utils/highlight.js`: visual debug highlight를 담당한다.

## Current Supported Scope

- primary navigation discovery/projection
- Level 1 navigation smoke
- Level 2 page identity MVP
- structured test plan validation
- deterministic Playwright rendering
- generated spec 실행
- cross-site primary navigation projection
- plan comparison quality gate
- Analysis Review Report JSON/Markdown
- safe/unsafe/unknown interaction candidate classification, stable identity, and report integration
- versioned interaction approval validation과 exact key/evidence 기반 reconciliation
- eligible candidate를 exact per-test `startUrl`과 bounded state/reset instruction으로 전달하는 Structured Interaction Plan contract
- deterministic Structured Interaction Plan builder와 strict validator
- `interaction.tabSelection`/`interaction.expandedToggle` deterministic spec rendering과 static syntax/test discovery

## Current Unsupported Scope

- 모든 사이트 100% 무보정 지원
- 데이터 변경 action 자동 실행
- 완전한 business scenario 자동 생성
- login/session 자동 처리
- visual regression
- self-healing selector
- full test management dashboard
- production-grade 검수 UI
- `interaction.expandedToggle` runtime validation과 interaction cross-site regression
- durable approval editor/history와 general execution result workflow

## Verified Site Types

현재 검증된 site type:

| Site Type | Result | Notes |
| --- | --- | --- |
| Business/complex GNB site | 41 passed | 복합 GNB, depth2/depth3, 동일 child text 반복 |
| Corporate PC/MO overlay GNB site | 17 passed | PC/MO duplicate, overlay utility 후보 분리 |
| Docs/Docusaurus direct nav site | 8 passed | depth1Index 없는 direct top-level nav link 처리 |

실제 회사명과 서비스명은 문서화하지 않는다. 세부 검증 원칙은 `docs/CROSS_SITE_VALIDATION.md`를 따른다.

## Key Design Decisions

- LLM direct JS generation보다 structured plan을 우선한다.
- deterministic renderer가 실행 코드를 소유한다.
- coverage/schema gate를 우선한다.
- 특정 사이트 예외보다 일반화 규칙을 우선한다.
- 100% 자동화보다 evidence-based human review를 우선한다.
- generated artifact와 source를 분리한다.
- 불확실한 후보는 강한 assertion으로 만들지 않는다.
- machine classification, human approval, reconciliation status를 분리하며 current `safe`, human `approved`, valid reference가 모두 있어야 future interaction plan 후보가 될 수 있다.

## Immediate Next Milestones

현재 active frontier와 바로 이어질 milestone은 [CURRENT_STATE.md](CURRENT_STATE.md)에 유지한다. 이 문서는 장기적으로 안정적인 지원 범위와 architecture 설명만 유지한다.

## Validation Strategy

작업 비용에 맞게 검증 범위를 조절한다.

- 문서 작업: Markdown 구조, 링크, git status 확인
- Python 변경: `python -m py_compile ...`
- Node 변경: `node -c ...`
- JSON/schema 변경: JSON parse와 validator 실행
- renderer/plan 변경: 관련 fixture 또는 기존 generated artifact 재사용
- 핵심 pipeline 변경: 필요한 site type cross-site regression

문서/report-only 작업에서는 scout 재실행, pageProfile 재수집, LLM API 재호출, 전체 회귀를 기본적으로 수행하지 않는다.

## Generated Artifact Policy

다음은 실행 산출물이며 기본적으로 직접 수정하거나 commit하지 않는다.

- `tests/generated/`
- `tools/ai-generator/generated/`
- `test-results/`
- `playwright-report/`

예외 fixture는 `.gitignore`와 repository tracking 상태를 확인한다.

## AI/Data/Deployment Modes

현재 개발 흐름은 외부 LLM API를 사용할 수 있다. 단, 실제 민감 업무 데이터, 인증정보, 개인정보를 외부 API로 전송하지 않는다.

폐쇄망/on-premise 방향은 별도로 다룬다. 현재 구현된 deterministic path와 future local model 방향을 구분해서 표현한다. 구현되지 않은 기능을 구현된 것처럼 쓰지 않는다.

상세 정책은 `docs/OFFLINE_NETWORK_POLICY.md`를 따른다.

## Documentation Map

- agent 운영 규칙: `AGENTS.md`
- local development environment: `docs/DEVELOPMENT_ENVIRONMENT.md`
- 현재 repository snapshot: `docs/CURRENT_STATE.md`
- 제품 방향: `docs/PRODUCT_DIRECTION.md`
- 구조와 흐름: `docs/MODULE_MAP.md`, `docs/DATA_FLOW.md`
- 테스트 수준: `docs/TEST_LEVELS.md`
- 생성 규칙: `docs/TEST_GENERATION_RULES.md`
- Playwright 규칙: `docs/PLAYWRIGHT_CONVENTION.md`
- structured plan 계약: `docs/TEST_PLAN_SCHEMA.md`, `docs/TEST_TEMPLATE_CATALOG.md`
- structured interaction plan 계약: `docs/STRUCTURED_INTERACTION_PLAN.md`
- JSON 구조: `docs/JSON_SCHEMA.md`
- prompt 전략: `docs/PROMPT_STRATEGY.md`
- generated spec validation: `docs/GENERATED_SPEC_VALIDATION.md`
- Analysis Review Report: `docs/ANALYSIS_REVIEW_REPORT.md`
- Safe Interaction Strategy: `docs/SAFE_INTERACTION_STRATEGY.md`
- Interaction Approval Contract: `docs/INTERACTION_APPROVAL_CONTRACT.md`
- cross-site 검증: `docs/CROSS_SITE_VALIDATION.md`
- 작업 이력: `docs/TASK_LOG.md`

참고: `docs/ARCHITECTURE.md`는 현재 비어 있다. 실제 구조 확인은 우선 `docs/MODULE_MAP.md`와 `docs/DATA_FLOW.md`를 사용한다.
