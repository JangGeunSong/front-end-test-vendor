# Data Flow

## Purpose

이 문서는 대상 URL에서 UI 구조를 수집하고, AI generated spec을 생성한 뒤, validator와 Playwright 실행으로 이어지는 현재 데이터 흐름을 설명한다.

## Current Flow

```text
target URL
  -> tools/ai-generator/scout.js
  -> tools/ai-generator/generated/scout_result.json
  -> tools/ai-generator/generated/menu_map.json
  -> tools/ai-generator/agent_orchestrator.py
  -> LLM generated Playwright spec
  -> tests/generated/generated_menu_access.spec.js
  -> npm run ai:validate
  -> npm run test:generated
  -> npm run test:generated:visual
  -> smoke/regression promotion review
```

## Step Details

### 1. Target URL

테스트 생성의 시작점은 대상 URL이다. 문서와 도구는 특정 도메인 전용이 아니라 임의의 WEB 사이트 URL을 기준으로 동작하도록 정리한다.

### 2. scout.js

`scout.js`는 Playwright/Node.js 기반으로 대상 UI를 탐색한다.

수집 대상:

- navigation/GNB 후보
- menu depth 정보
- DOM 순서 기반 depth1Index 추론 정보
- id, text, href, ngClick, cssPath
- pageProfile 후보
- heading, main container, table/form/tab/button 후보
- error indicator 후보

버튼 클릭, 입력, 저장/삭제 같은 데이터 변경 액션은 수행하지 않는다.

### 3. scout_result.json

`scout_result.json`은 scout의 원본 수집 결과이다.

현재 구조는 다음 성격의 데이터를 포함한다.

- `elements`: Level 1 menu_map 생성을 위한 UI element 후보
- `pageProfiles`: Level 2 Page Identity Test MVP를 위한 후보 데이터

이 파일은 대상 사이트에서 수집된 산출물이므로 제품 샘플이나 고정 fixture로 보지 않는다.

### 4. menu_map.json

`menu_map.json`은 generated spec 생성을 위한 정제 데이터이다.

주요 필드:

- `url`
- `menus`
- `menuTree`
- `pageProfiles`

`menuTree`는 Level 1 navigation test coverage의 기준이 된다. `pageProfiles`는 Level 2 Page Identity assertion 후보의 근거가 된다.

`depth1Index`는 특정 메뉴명 mapping이 아니라 scout가 `.menuContainer .depth1 > li` DOM 순서에서 자동 추론한 값이다. 추론할 수 없으면 null로 남기고 generated spec은 보수적인 TODO를 남긴다.

### 5. agent_orchestrator.py

`agent_orchestrator.py`는 생성 파이프라인을 조율한다.

역할:

- scout 실행
- JSON 저장
- menu 후보 추출
- menuTree 구성
- pageProfiles 연결
- LLM prompt input 구성
- generated Playwright spec 저장

### 6. Generated Spec

`tests/generated/generated_menu_access.spec.js`는 재생성 가능한 자동 생성 산출물이다.

validator 통과 전에는 신뢰된 테스트로 보지 않는다. generated spec에 문제가 있으면 직접 수정하지 않고 생성 규칙을 보완한 뒤 다시 생성한다.

### 7. ai:validate

`npm run ai:validate`는 generated spec을 실행하지 않고 정적으로 검수한다.

검수 대상:

- generated spec
- menu_map.json
- scout_result.json

validator error가 있으면 테스트 실행보다 생성 규칙 보완이 우선이다.

### 8. test:generated

`npm run test:generated`는 generated spec을 실제 Playwright로 실행한다.

실행 전 `npm run ai:validate` 통과를 권장한다.

### 9. visual debug

`npm run test:generated:visual`은 headed mode와 `HIGHLIGHT=true`로 실행한다.

확인 대상:

- navigation hover/click 위치
- depth3 child가 올바른 parent 아래에서 클릭되는지
- Page Identity highlight가 의도한 본문 영역을 가리키는지

### 10. smoke/regression Promotion

generated 테스트는 자동으로 smoke/regression이 되지 않는다.

승격 전 확인:

- validator 통과
- generated 테스트 실행 통과
- visual/debug 확인
- 데이터 변경 없음
- 반복 실행 안정성
- 테스트 목적과 기대 결과 명확성

승격 기준은 `docs/TEST_LEVELS.md`를 따른다.
