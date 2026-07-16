# Safe Interaction Strategy

## Purpose

Safe Interaction Strategy는 Level 3 Safe Interaction Test로 확장하기 전에 safe/unsafe action taxonomy를 정리하는 문서다.

핵심 원칙은 모든 button/input을 자동으로 테스트하지 않는 것이다. 먼저 read-only 또는 reversible interaction부터 후보로 분류하고, 데이터 변경 action은 기본적으로 제외한다.

## Current MVP Status

deterministic Safe Interaction candidate classification MVP가 구현되어 있다.

- 기존 `scout_result.json`과 `menu_map.json`의 action/pageProfile 후보만 사용한다.
- 후보를 `safe`, `unsafe`, `unknown`으로 보수적으로 분류한다.
- unsafe 판정을 safe보다 먼저 적용한다.
- safe는 selector와 role/type/ARIA state 같은 구조 신호가 충분하고 confidence가 medium 이상일 때만 허용한다.
- unknown은 자동 실행 대상이 아니며 Analysis Review Report의 unresolved interaction 후보로 표시한다.
- selector, page context, role/type, text를 조합한 canonical identity로 중복을 deterministic하게 제거한다.
- 모든 classified candidate에는 동일 canonical identity의 SHA-256 digest에서 만든 `candidateKey`가 포함된다.
- 모든 classified candidate에는 actual rendered browser location을 보존한 required `observedUrl`이 포함된다.
- human-authored approval artifact를 strict하게 검증하고 current report candidate와 deterministic하게 reconciliation할 수 있다.
- eligible candidate와 current report evidence를 exact key로 결합하는 deterministic Structured Interaction Plan builder와 strict validator가 구현되어 있다.
- 두 supported template의 deterministic Playwright spec rendering과 static test discovery가 구현되어 있다.
- 실제 browser interaction과 reset/restore runtime validation은 아직 구현하지 않는다.

### Candidate Identity Contract

`candidateKey`는 classifier output에서 candidate를 안정적으로 참조하기 위한 classification-neutral identity다. selector가 있으면 normalized selector와 page context를 우선 사용하고, selector가 없으면 기존 dedup fallback signal인 page context, role, type, tag name, normalized text를 사용한다.

- 형식: `interaction:<selector|fallback>:<stable-digest>`
- 배열 index, 생성 시각, Python process `hash()`에 의존하지 않는다.
- deduplication과 `candidateKey` 생성은 같은 canonical identity를 사용한다.
- 동일 normalized artifact의 동일 candidate는 classification rule이 바뀌어도 가능한 한 같은 key를 유지한다.
- DOM selector 또는 page context가 바뀌면 candidate identity가 달라지므로 key도 바뀔 수 있다.

`candidateKey`는 향후 human approval 결과와 structured interaction plan이 candidate를 참조하기 위한 기반일 뿐 승인 자체가 아니다. `safe` classification과 stable key가 모두 있어도 사람이 승인하기 전에는 자동 실행 대상이 아니다.

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
  -> human approval validation / reconciliation
  -> eligible candidates
  -> structured interaction plan builder
  -> structured interaction plan JSON
  -> interaction plan validator
  -> deterministic renderer
  -> Playwright safe interaction spec
```

역할 분리:

- scout/projection은 interaction candidates를 수집한다.
- scout/pageProfile은 root final URL 또는 click 후 actual page URL을 `observedUrl` source of truth로 제공한다.
- classifier는 safe/unsafe/unknown과 `interactionKind`를 소유한다.
- approval reconciliation은 current safe + human approved + valid reference만 eligible input으로 제공한다.
- builder는 eligible candidate를 supported plan template과 bounded state/reset field로 변환한다.
- validator는 eligibility reference, exact evidence와 template invariant를 검증한다.
- renderer는 정해진 safe template만 Playwright code로 생성한다.
- renderer는 test별 exact `startUrl`과 selector를 변경 없이 사용하고 bounded initial/expected/reset/restored assertion만 생성한다.

현재 renderer output은 `tests/generated/generated_interaction_plan.spec.js`이며 JavaScript syntax와 Playwright test discovery까지만 검증한다. Generated test body의 click/reload/toggle은 아직 실행하지 않는다.

## Structured Interaction Plan Templates

Classifier의 `interactionKind`와 execution plan template은 다른 taxonomy다. Candidate classification이 가능한 모든 kind를 즉시 실행 template으로 만들지 않는다.

Schema `2.0` documentation contract가 지원하는 template이며 각 test는 exact candidate `observedUrl`을 `startUrl`로 가진다.

- `interaction.tabSelection`: `tab`, selected false → true, reload 후 false restore
- `interaction.expandedToggle`: `accordion` 또는 `expandCollapse`, expanded false → true, same target toggle 후 false restore

Dialog, dropdown, popover, carousel, read-only select는 현재 eligible payload와 report evidence만으로 expected state와 reset target/pair를 deterministic하게 증명할 수 없어 deferred다. Generic TODO template으로 실행하지 않는다. Exact schema와 template requirement는 [STRUCTURED_INTERACTION_PLAN.md](STRUCTURED_INTERACTION_PLAN.md)를 따른다.

## Human-In-The-Loop Rule

Level 3는 사람이 승인 가능한 범위에서만 확장한다.

원칙:

- unknown 또는 risky action은 자동 실행하지 않는다.
- unsafe 후보는 report에서 검수 대상으로 표시한다.
- current classification이 `safe`이고 사람이 `approved`했으며 approval reference가 valid/non-stale인 action만 future interaction plan 후보가 된다.
- 승인되지 않은 후보를 LLM이 임의로 실행 plan에 넣을 수 없어야 한다.

Human decision enum, evidence snapshot, stale rule과 future eligibility는 [INTERACTION_APPROVAL_CONTRACT.md](INTERACTION_APPROVAL_CONTRACT.md)를 따른다. Classification, human decision, reconciliation status를 하나의 상태로 합치지 않는다.

## MVP Scope

초기 분류 MVP 구현 완료:

- interaction 후보 수집 구조 정의
- safe/unsafe/unknown 분류 기준 정리
- stable `candidateKey`와 dedup identity 계약
- Analysis Review Report에 후보 표시
- 사람이 검수할 수 있는 evidence 제공
- versioned Interaction Approval Contract와 approved-only eligibility 규칙 정의
- strict approval artifact validator와 exact key/evidence 기반 reconciliation
- valid/missingCandidate/evidenceChanged status, eligible candidate와 unreviewed candidate generated output
- exact eligible candidate reference, bounded initial/expected state, required page UI reset/restore의 Structured Interaction Plan contract
- `interaction.tabSelection`, `interaction.expandedToggle`만 생성하는 deterministic builder와 strict validator

분류 결과는 `safeInteractionCandidates`, `unsafeActionCandidates`, `unresolvedCandidates`에 연결된다. `unresolvedCandidates.candidateSubtype`이 `interaction`인 항목은 동작 의미를 확정할 수 없어 자동 실행에서 제외된 후보다.

MVP에서 하지 않는 것:

- approval artifact writer/editor
- 실제 Playwright interaction 실행
- read-only form 입력 자동화
- login session fixture
- business scenario plan 생성

## Future Extensions

후속 확장 후보:

- read-only form/filter interaction
- login session fixture
- supported interaction evidence와 template 확장
- approved flow 저장
- business scenario plan
- workspace 단위 interaction review history
