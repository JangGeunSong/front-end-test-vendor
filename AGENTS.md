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
3. `docs/CURRENT_STATE.md`
4. current task packet 또는 현재 요청
5. 작업 패킷에 지정된 관련 design/schema 문서
6. 문서에서 범위를 좁힌 직접 관련 source 파일

`docs/TASK_LOG.md` 전체는 기본 startup reading 대상이 아니다. 과거 실패 원인, historical reasoning, 이전 decision 배경이 현재 작업에 필요할 때만 관련 항목을 읽는다. repository 전체 source도 선행 탐색하지 않고, 위 문서에서 현재 frontier와 관련 module을 식별한 뒤 필요한 파일만 확인한다.

작업 유형별 권장 문서:

- local development environment: `docs/DEVELOPMENT_ENVIRONMENT.md`
- 제품 방향: `docs/PRODUCT_DIRECTION.md`
- 아키텍처와 data flow: `docs/MODULE_MAP.md`, `docs/DATA_FLOW.md`
- 테스트 단계: `docs/TEST_LEVELS.md`
- 생성 규칙: `docs/TEST_GENERATION_RULES.md`
- Playwright 코드 규칙: `docs/PLAYWRIGHT_CONVENTION.md`
- structured navigation plan: `docs/TEST_PLAN_SCHEMA.md`, `docs/TEST_TEMPLATE_CATALOG.md`
- structured interaction plan: `docs/STRUCTURED_INTERACTION_PLAN.md`
- prompt: `docs/PROMPT_STRATEGY.md`
- Review Report: `docs/ANALYSIS_REVIEW_REPORT.md`
- Safe Interaction: `docs/SAFE_INTERACTION_STRATEGY.md`
- Interaction approval: `docs/INTERACTION_APPROVAL_CONTRACT.md`
- Structured interaction plan: `docs/STRUCTURED_INTERACTION_PLAN.md`
- 오프라인/폐쇄망: `docs/OFFLINE_NETWORK_POLICY.md`
- 검증 이력: `docs/CROSS_SITE_VALIDATION.md`
- 작업 기록: `docs/TASK_LOG.md`

## New Session Bootstrap

새 PC에서 repository를 clone했거나 conversation history가 없는 새 session을 시작하면 다음을 수행한다.

1. 위 required reading order를 따른다.
2. 현재 pipeline과 stable capability를 짧게 요약한다.
3. `docs/CURRENT_STATE.md`에서 active development frontier와 latest completed work를 식별한다.
4. 현재 요청이 frontier를 이어가는지, 별도 유지보수 작업인지 확인한다.
5. 관련 문서와 source가 충돌하는지 구현 전에 확인한다.
6. command 실행이 필요한 task이면 `docs/DEVELOPMENT_ENVIRONMENT.md`에 따라 project venv와 fnm/Node environment를 확인하고 활성화한다.
7. 충돌이 없으면 관련 module만 읽고 작업 범위를 확정한다.

local path, session ID, conversation transcript를 project memory로 사용하지 않는다. repository documentation과 검증 가능한 source/history를 durable context로 사용한다. 기존 architecture를 이유 없이 다시 설계하지 않으며, 현재 contract를 바꿔야 한다면 영향과 필요한 decision을 먼저 보고한다.

## Local Execution Environment Bootstrap

Python command 실행 전:

- project-local `venv` policy와 `tools/ai-generator/requirements.txt`를 확인한다.
- `venv`를 활성화하고 `sys.executable`이 project venv interpreter인지 확인한다.
- system/global Python dependency를 전제로 하지 않는다.
- dependency availability를 먼저 확인하고 누락된 경우에만 requirements 기준으로 설치한다.

Node/npm command 실행 전:

- `node` 또는 `npm`이 없으면 Node 미설치로 단정하지 않고 먼저 `fnm`을 확인한다.
- fresh shell에서는 fnm PowerShell environment를 활성화한 뒤 repository version declaration에 맞는 Node를 선택한다.
- `node --version`, `npm --version`과 dependency availability를 확인한다.
- dependency가 필요한 경우 `package-lock.json`과 repository policy를 기준으로 설치한다.

External LLM command 실행 전:

- 필요한 local `.env` 존재만 확인하고 secret 값을 출력하거나 commit하지 않는다.
- deterministic validator/reconciler command에는 external LLM key를 요구하지 않는다.

상세 command와 troubleshooting contract는 `docs/DEVELOPMENT_ENVIRONMENT.md`를 따른다. `npm not found` 또는 Python import error를 곧바로 implementation failure로 보고하지 않고 local environment 복원 가능성을 먼저 확인한다.

## Source Of Truth Priority

- 에이전트 운영 규칙: `AGENTS.md`
- 안정적인 제품/architecture 개요: `docs/PROJECT_OVERVIEW.md`
- 현재 repository snapshot과 active frontier: `docs/CURRENT_STATE.md`
- local execution environment: `docs/DEVELOPMENT_ENVIRONMENT.md`
- 제품 목적과 방향: `docs/PRODUCT_DIRECTION.md`
- 실제 구조와 흐름: `docs/MODULE_MAP.md`, `docs/DATA_FLOW.md`
- schema/template 계약: `docs/JSON_SCHEMA.md`, `docs/TEST_PLAN_SCHEMA.md`, `docs/TEST_TEMPLATE_CATALOG.md`, `docs/STRUCTURED_INTERACTION_PLAN.md`
- 실행 규칙: `docs/TEST_GENERATION_RULES.md`, `docs/PLAYWRIGHT_CONVENTION.md`
- 기능별 설계: `docs/ANALYSIS_REVIEW_REPORT.md`, `docs/SAFE_INTERACTION_STRATEGY.md`, `docs/INTERACTION_APPROVAL_CONTRACT.md`, `docs/STRUCTURED_INTERACTION_PLAN.md`
- 이력: `docs/TASK_LOG.md`

문서와 실제 코드가 충돌하면 실제 코드와 검증 결과를 확인한다. 임의로 한쪽을 가정하지 않는다. 구현이 맞다면 문서를 갱신한다. 의사결정이 필요하면 중단하고 보고한다.

## Change Rules

- prompt 수정 시 `docs/PROMPT_STRATEGY.md` 검토
- JSON 구조 수정 시 producer, consumer, validator, `docs/JSON_SCHEMA.md` 검토
- structured navigation plan field 수정 시 `docs/TEST_PLAN_SCHEMA.md` 검토
- structured interaction plan field/template/reset 의미 수정 시 `docs/STRUCTURED_INTERACTION_PLAN.md`와 `docs/JSON_SCHEMA.md` 검토
- interaction approval field/meaning 수정 시 `docs/INTERACTION_APPROVAL_CONTRACT.md`와 `docs/JSON_SCHEMA.md` 검토
- interaction `observedUrl`/plan `startUrl` provenance 수정 시 producer, approval/reconciliation, `docs/STRUCTURED_INTERACTION_PLAN.md`, `docs/DATA_FLOW.md` 검토
- navigation template 수정 시 `docs/TEST_TEMPLATE_CATALOG.md` 검토
- data flow 수정 시 `docs/DATA_FLOW.md` 검토
- 모듈 책임 변경 시 `docs/MODULE_MAP.md`와 `docs/DATA_FLOW.md` 검토
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
