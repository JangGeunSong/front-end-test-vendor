# Agent Task Template

이 문서는 작업별 agent prompt를 짧고 일관되게 작성하기 위한 template이다.

사용 규칙:

- `AGENTS.md`와 `docs/PROJECT_OVERVIEW.md`의 공통 설명을 반복하지 않는다.
- 작업별 차이만 작성한다.
- 작은 작업은 불필요한 section을 축약할 수 있다.
- 전체 회귀 필요 여부를 명시한다.
- 외부 LLM API 호출 필요 여부를 명시한다.
- 기존 generated artifact 재사용 여부를 명시한다.
- 명시되지 않은 기능을 임의로 확장하지 않는다.

## Template

```markdown
# Agent Task

## Task Title

## Goal

## Why This Matters

## Required Reading

## Relevant Files

## Inputs

## Expected Outputs

## Allowed Changes

## Forbidden Changes

## Implementation Requirements

## Validation

## Regression Scope

## LLM/API Usage

## Generated Artifact Usage

## Done Definition

## Stop Conditions

## Final Report Format

## Suggested Commit Message
```

## Field Guide

### Required Reading

작업에 필요한 문서만 지정한다. 기본적으로 `AGENTS.md`와 `docs/PROJECT_OVERVIEW.md`는 이미 읽는 것으로 본다.

### Allowed Changes / Forbidden Changes

수정 가능한 파일과 수정 금지 파일을 명확히 나눈다. source code, docs, generated artifact, package scripts 중 무엇이 범위인지 분리한다.

### Validation

가장 저렴한 검증부터 쓴다. 문서 작업이면 Markdown/link/git status 확인이면 충분할 수 있다. pipeline 변경이면 필요한 site type regression을 명시한다.

### LLM/API Usage

LLM 호출이 필요한지 명시한다. 문서/report-only 작업은 기본적으로 LLM API 재호출을 하지 않는다.

### Generated Artifact Usage

기존 generated artifact를 읽어도 되는지, 새로 생성해도 되는지, commit 대상인지 명시한다.

## Sample Task Packet

```markdown
# Agent Task

## Task Title

Analysis Review Report JSON MVP

## Goal

`menu_map.json`, `test_plan.llm.json`, validation 결과를 기반으로 사람이 검수할 수 있는 `analysis_review_report.json` 초안을 생성한다.

## Required Reading

- `docs/ANALYSIS_REVIEW_REPORT.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/DATA_FLOW.md`
- `docs/JSON_SCHEMA.md`

## Relevant Files

- `tools/ai-generator/generated/menu_map.json`
- `tools/ai-generator/generated/test_plan.llm.json`
- 신규 구현 파일은 작업자가 제안한다.

## Allowed Changes

- report builder source
- 필요한 최소 docs
- `docs/TASK_LOG.md`

## Forbidden Changes

- scout 재수집 로직 변경
- renderer 변경
- validator 완화
- generated spec 직접 수정

## Validation

- Python 문법 확인
- 기존 generated artifact를 입력으로 report JSON 생성
- JSON parse 확인

## Regression Scope

전체 사이트 회귀 없음. 기존 artifact 기반 검증만 수행한다.

## LLM/API Usage

외부 LLM API 호출 없음.

## Generated Artifact Usage

기존 generated artifact는 입력으로 읽을 수 있다. 새 report 산출물은 commit하지 않는다.

## Stop Conditions

- report에 필요한 필드가 현재 artifact에 없어 추정이 필요한 경우
- schema 변경이 필요한 경우
- source pipeline 변경 없이는 구현할 수 없는 경우

## Suggested Commit Message

feat: add analysis review report builder
```
