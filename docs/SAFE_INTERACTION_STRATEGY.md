# Safe Interaction Strategy

## Purpose

Safe Interaction Strategy는 Level 3 Safe Interaction Test로 확장하기 전에 safe/unsafe action taxonomy를 정리하는 문서다.

핵심 원칙은 모든 button/input을 자동으로 테스트하지 않는 것이다. 먼저 read-only 또는 reversible interaction부터 후보로 분류하고, 데이터 변경 action은 기본적으로 제외한다.

## Level 3 Goal

Level 3의 목표는 business scenario 자동화가 아니다.

목표는 page-level safe interaction smoke test다.

- 페이지 안의 안전한 UI interaction이 열리고 닫히는지 확인한다.
- tab, accordion, dropdown, modal 같은 상태 변화가 깨지지 않았는지 확인한다.
- 데이터 변경, 외부 전송, 결제, 승인 같은 action은 자동 실행하지 않는다.
- unknown/risky 후보는 report에 남기고 사람 검수 대상으로 둔다.

## Safe Interaction Candidates

초기 safe 후보:

- tab click
- accordion expand/collapse
- dropdown open
- search modal open/close
- expand/collapse
- more/view-more
- carousel next/prev
- read-only filter/select open
- tooltip/popover open

safe 후보라도 항상 실행 대상이 되는 것은 아니다. selector 안정성, page context, URL 변화 여부, surrounding text, form association 등을 함께 본다.

## Unsafe Actions Excluded By Default

다음 action은 기본적으로 자동 실행하지 않는다.

- save
- submit
- create/register
- update/edit
- delete
- payment
- login
- signup
- upload
- approval
- send
- personal information entry
- destructive/irreversible action

이 후보들은 generated test에 넣지 않고 Analysis Review Report에서 검수 대상으로 표시한다.

## Classification Signals

safe/unsafe/unknown 분류는 단일 keyword에만 의존하지 않는다.

사용할 수 있는 signal:

- text keyword
- role/type
- href/ngClick/onClick
- form association
- surrounding text
- semanticRegion
- navigation/pageProfile context
- URL change 여부
- modal/dialog open 여부
- selector 안정성
- input/select/textarea와의 관계

예상 분류:

- `safe`: read-only 또는 reversible 가능성이 높은 interaction
- `unsafe`: 데이터 변경 또는 외부 부작용 가능성이 높은 action
- `unknown`: 자동 판단 근거가 부족한 후보

`unknown`은 자동 실행하지 않는다.

## Structured Interaction Plan Direction

Level 3도 LLM direct Playwright code generation을 사용하지 않는다.

권장 흐름:

```text
scout/projection interaction candidates
  -> safe/unsafe/unknown classification
  -> structured interaction plan JSON
  -> interaction plan validator
  -> deterministic renderer
  -> Playwright safe interaction spec
```

역할 분리:

- scout/projection은 interaction candidates를 수집한다.
- LLM 또는 deterministic classifier는 safe/unsafe/unknown을 분류한다.
- validator는 unsafe action이 plan에 들어가지 못하게 차단한다.
- renderer는 정해진 safe template만 Playwright code로 생성한다.

## Proposed Level 3 Templates

초기 template 후보:

- `interaction.tab`
- `interaction.accordion`
- `interaction.dropdownOpen`
- `interaction.modalOpenClose`
- `interaction.expandCollapse`
- `interaction.carousel`
- `interaction.todoReview`

각 template은 click 대상, expected visible state, rollback/close 가능 여부, URL 변화 여부를 명확히 표현해야 한다.

## Human-In-The-Loop Rule

Level 3는 사람이 승인 가능한 범위에서만 확장한다.

원칙:

- unknown 또는 risky action은 자동 실행하지 않는다.
- unsafe 후보는 report에서 검수 대상으로 표시한다.
- 사용자가 승인한 safe action만 regression 후보가 된다.
- 승인되지 않은 후보를 LLM이 임의로 실행 plan에 넣을 수 없어야 한다.

## MVP Scope

초기 MVP:

- interaction 후보 수집 구조 정의
- safe/unsafe/unknown 분류 기준 정리
- Analysis Review Report에 후보 표시
- 사람이 검수할 수 있는 evidence 제공

MVP에서 하지 않는 것:

- 실제 Playwright interaction 실행
- read-only form 입력 자동화
- login session fixture
- business scenario plan 생성

## Future Extensions

후속 확장 후보:

- read-only form/filter interaction
- login session fixture
- approved safe action memory
- approved flow 저장
- business scenario plan
- workspace 단위 interaction review history
