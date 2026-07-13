# Agent Operation Guide

이 문서는 이 repository에서 수행되는 모든 AI agent 작업의 최상위 운영 규칙이다. 제품 설명서를 길게 복사하는 문서가 아니며, 상세 프로젝트 정보는 [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)와 관련 전문 문서를 따른다.

## Project Mission

이 프로젝트는 URL-first WEB test generation AX pipeline이다.

핵심 가치는 문서, QA 인력, 기존 TC가 부족한 환경에서도 웹 검증 대상을 분석하고 테스트 가능한 구조로 체계화하는 것이다. 단순 Playwright 파일 생성기가 아니라 분석 근거, coverage, 제외 후보, unresolved 후보, 실행 가능한 테스트를 함께 제공하는 도구를 지향한다.

최종 사용자 경험은 URL 입력과 분석 실행으로 단순하게 만들되, 내부는 검증 가능한 계층 구조를 유지한다.

## Core Architecture Rules

- LLM은 자유로운 Playwright JavaScript 작성자가 아니다.
- LLM은 structured plan의 판단과 후보 선택을 담당한다.
- executable Playwright code shape는 deterministic renderer가 소유한다.
- validator와 quality gate를 우회하지 않는다.
- generated artifact를 직접 수정하지 않는다.
- 생성 결과가 잘못되면 원인이 있는 계층을 수정한다.
  - scout
  - projection
  - pageProfile
  - prompt
  - normalization
  - validator
  - renderer
  - helper
- 특정 사이트명, URL, 메뉴명 전용 하드코딩을 추가하지 않는다.

## Document Reading Order

모든 작업에서 전체 docs를 읽지 않는다.

기본 순서:

1. `AGENTS.md`
2. `docs/PROJECT_OVERVIEW.md`
3. 작업 패킷에 지정된 관련 문서
4. 직접 관련된 source 파일

작업 유형별 권장 문서:

- 제품 방향: `docs/PRODUCT_DIRECTION.md`
- 아키텍처: `docs/ARCHITECTURE.md`, `docs/MODULE_MAP.md`, `docs/DATA_FLOW.md`
- 테스트 단계: `docs/TEST_LEVELS.md`
- 생성 규칙: `docs/TEST_GENERATION_RULES.md`
- Playwright 코드 규칙: `docs/PLAYWRIGHT_CONVENTION.md`
- structured plan: `docs/TEST_PLAN_SCHEMA.md`, `docs/TEST_TEMPLATE_CATALOG.md`
- prompt: `docs/PROMPT_STRATEGY.md`
- Review Report: `docs/ANALYSIS_REVIEW_REPORT.md`
- Safe Interaction: `docs/SAFE_INTERACTION_STRATEGY.md`
- 오프라인/폐쇄망: `docs/OFFLINE_NETWORK_POLICY.md`
- 검증 이력: `docs/CROSS_SITE_VALIDATION.md`
- 작업 기록: `docs/TASK_LOG.md`

## Source Of Truth Priority

- 에이전트 운영 규칙: `AGENTS.md`
- 압축된 현재 상태: `docs/PROJECT_OVERVIEW.md`
- 제품 목적과 방향: `docs/PRODUCT_DIRECTION.md`
- 실제 구조와 흐름: `docs/ARCHITECTURE.md`, `docs/MODULE_MAP.md`, `docs/DATA_FLOW.md`
- schema/template 계약: `docs/JSON_SCHEMA.md`, `docs/TEST_PLAN_SCHEMA.md`, `docs/TEST_TEMPLATE_CATALOG.md`
- 실행 규칙: `docs/TEST_GENERATION_RULES.md`, `docs/PLAYWRIGHT_CONVENTION.md`
- 기능별 설계: `docs/ANALYSIS_REVIEW_REPORT.md`, `docs/SAFE_INTERACTION_STRATEGY.md`
- 이력: `docs/TASK_LOG.md`

문서와 실제 코드가 충돌하면 실제 코드와 검증 결과를 확인한다. 임의로 한쪽을 가정하지 않는다. 구현이 맞다면 문서를 갱신한다. 의사결정이 필요하면 중단하고 보고한다.

## Change Rules

- prompt 수정 시 `docs/PROMPT_STRATEGY.md` 검토
- JSON 구조 수정 시 producer, consumer, validator, `docs/JSON_SCHEMA.md` 검토
- structured plan field 수정 시 `docs/TEST_PLAN_SCHEMA.md` 검토
- template 수정 시 `docs/TEST_TEMPLATE_CATALOG.md` 검토
- data flow 수정 시 `docs/DATA_FLOW.md` 검토
- 모듈 책임 변경 시 `docs/MODULE_MAP.md`와 `docs/ARCHITECTURE.md` 검토
- Playwright 생성 형태 수정 시 `docs/PLAYWRIGHT_CONVENTION.md`와 `docs/TEST_GENERATION_RULES.md` 검토
- 지원 Level 변경 시 `docs/TEST_LEVELS.md` 검토
- 구현 완료 시 `docs/TASK_LOG.md` 갱신

## Generated Artifact Policy

다음 항목은 실행 산출물이며 기본적으로 직접 수정하거나 commit하지 않는다.

- `tests/generated/`
- `tools/ai-generator/generated/`
- `test-results/`
- `playwright-report/`

예외 fixture가 존재하는 경우 `.gitignore` 정책과 repository tracking 상태를 확인한다.

## AI And Data Policy

- 외부 LLM API를 사용하는 개발 모드와 폐쇄망/on-premise 실행 방향을 구분한다.
- 실제 민감 업무 데이터, 인증정보, 개인정보를 외부 API로 전송하지 않는다.
- 외부 LLM 사용 시 익명화되고 필요한 최소 구조 데이터만 사용한다.
- 폐쇄망에서는 현재 가능한 deterministic path와 future local model 방향을 구분해서 표현한다.
- 현재 구현되지 않은 on-premise/local AI 기능을 구현된 것처럼 표현하지 않는다.
- 자세한 내용은 `docs/OFFLINE_NETWORK_POLICY.md`를 따른다.

## Validation Cost Policy

가장 저렴한 검증부터 수행한다.

개발 중:

- `py_compile`
- Node syntax check
- JSON parse
- fixture 검증
- 기존 generated artifact 재사용
- 관련 단위 검증

기능 완료 시:

- 관련 최소 integration check
- 필요한 경우 빠른 target 1개

핵심 pipeline 변경 시:

- 필요한 site type cross-site regression

문서/report-only 작업에서는 기본적으로 scout 재실행, pageProfile 재수집, LLM API 재호출, 전체 사이트 회귀를 하지 않는다. 필요한 경우에만 작업 패킷에 명시한다.

## Agent Autonomy

허용 범위 안에서 에이전트는 다음을 자율 수행할 수 있다.

- 관련 파일 탐색
- 짧은 계획 수립
- 구현
- 검증
- 원인이 명확한 실패 수정
- 관련 문서 갱신

다음 조건에서는 자동 반복을 중단한다.

- 동일 원인으로 2회 이상 실패
- 신규 dependency 필요
- schema breaking change 필요
- 대규모 architecture 변경 필요
- 작업 비범위를 수정해야 함
- 기존 안정 경로를 깨야 함

## Stop Conditions

중단 시 다음을 보고한다.

- 발견 내용
- 중단 이유
- 필요한 의사결정
- 가능한 대안
- 추천안

## Final Report Format

최종 보고는 불필요하게 길게 작성하지 않는다. 기본 형식:

- 구현 요약
- 변경 파일
- 실행한 검증과 결과
- 발견된 문제 및 제한사항
- 다음 추천 작업
- 추천 commit message
