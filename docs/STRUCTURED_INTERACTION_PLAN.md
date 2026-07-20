# Structured Interaction Plan Contract

## Purpose

이 문서는 approval reconciliation의 eligible interaction candidate와 deterministic Level 3 renderer 사이의 structured contract를 정의한다.

구현된 schema `3.0` builder, validator, renderer는 `interaction.tabSelection`의 approved/current target+restore pair를 exact하게 소비하고 `restorePreviousSelection` fixed spec을 생성한다. Schema `2.0`의 `reloadPage` tab restore는 제거됐다. Fresh public evidence chain에서 static discovery와 retry 없는 browser runtime 2회 PASS를 확인했다.

## Architecture Position

```text
current classified candidates + tab group/selected-peer evidence
  -> Analysis Review Report 2.1
  -> human approval 3.0 validation / reconciliation 3.0
  -> eligible bounded interaction pair
  -> deterministic interaction plan builder 3.0
  -> strict interaction plan validator 3.0
  -> deterministic renderer
  -> generated Playwright interaction spec
  -> browser execution
```

계층별 source of truth:

- scout/pageProfile producer: actual `observedUrl`, exact selectors, ARIA roles/states와 explicit tab group relation
- classifier: `safe`, `unsafe`, `unknown`과 `interactionKind`; restore readiness를 safety classification과 합치지 않음
- approval artifact: interaction target과 실제 클릭될 restore target의 bounded human-reviewed evidence pair
- reconciliation: current exact pair의 reference status와 eligibility
- interaction plan: bounded execution/restore instruction
- renderer: validated selector 두 개를 사용하는 fixed Playwright code shape
- Playwright assertion/report/trace: runtime failure evidence

## Terminology

- **interaction target**: 사람이 승인했고 plan이 실행하는 initially unselected tab이다. Initial `selected=false`, expected `selected=true`다.
- **tab group**: mutually exclusive selection state를 공유하며 같은 explicit `role=tablist` ancestor 아래에 있는 tab 집합이다.
- **previous selected tab**: interaction 실행 직전 같은 tab group에서 `aria-selected=true`인 유일한 tab이다.
- **restore target**: original page UI state를 되돌리기 위해 클릭하는 exact previous selected tab이다. MVP에서는 restore target과 previous selected tab이 같다.
- **restore action**: plan에 보존된 exact restore selector를 click하는 동작이다.
- **restored state**: restore 후 interaction target `selected=false`와 restore target `selected=true`를 함께 확인한 bounded state다.

Page-level UI에는 `restore`를 사용한다. 데이터 mutation의 rollback과 혼동하지 않는다. 구현된 expanded toggle의 existing `reset` field는 schema `3.0`에서도 그대로 유지하며 이번 tab contract가 그 의미를 변경하지 않는다.

## Tab Group Identity Contract

MVP는 별도 permanent `tabGroupKey`를 만들지 않고 `tabGroupSelector`를 사용한다.

`tabGroupSelector`는 target과 restore target의 closest explicit `role=tablist` ancestor에서 producer가 수집한 exact stable selector다. 다음 조건이 모두 충족될 때만 `restorePreviousSelection` evidence를 만들 수 있다.

- 두 tab의 `observedUrl`이 exact match한다.
- 두 element 모두 computed/exposed role이 `tab`이다.
- 두 element가 같은 exact `tabGroupSelector`의 descendant다.
- group selector는 하나의 explicit `role=tablist` element를 resolve하는 evidence다.
- group 안에 `aria-selected=true` tab이 정확히 하나 존재한다.
- interaction target은 `aria-selected=false`이고 selected peer는 `aria-selected=true`다.
- 두 tab에 서로 다른 non-empty exact selector가 있다.

Explicit `role=tablist` relation이 없는 tab-like UI는 MVP restore contract에서 제외한다. 같은 parent, sibling, class name, text similarity, DOM proximity 또는 같은 페이지의 모든 tab이라는 추론은 group evidence가 아니다. Current artifact의 selector common prefix도 과거 DOM을 사후 해석한 group proof로 사용하지 않는다.

`tabGroupSelector`는 사람이 확인할 수 있고 validator가 exact copy를 비교할 수 있는 최소 identity다. URL과 selector를 hash한 새 business ID는 현재 MVP에 추가하지 않는다.

### Implemented Upstream Evidence Boundary

Current `scout.js collectTabs()`는 visible tab-like element마다 selector/role/tag/text/observed URL과 `selected`를 수집한다. Unselected explicit tab에는 closest unique `role=tablist` selector와 exactly-one selected peer가 있을 때 bounded `tabRestore`를 만들고, 그렇지 않으면 typed unavailable reason을 남긴다. Classifier/Report `2.1`은 이를 보존하고 Approval/Reconciliation `3.0`은 human-reviewed pair와 current peer를 검증한다.

Explicit tablist member selector는 exact group selector 아래의 state-independent structural path로 수집한다. `active`/`selected`처럼 interaction으로 변경되는 class를 target 또는 restore selector identity에 포함하지 않으며, selector 변경은 새 evidence/candidate identity로 처리한다.

Current Report `2.1`과 Reconciliation `3.0`은 다음 relation을 bounded evidence로 보존한다.

- target group의 exact explicit `tabGroupSelector`
- target과 restore peer의 same URL/context relationship
- group 안의 exactly-one selected peer evidence
- approved/current restore peer candidateKey와 exact selector

Current Plan `3.0`은 이 pair에서 execution에 필요한 group selector, interaction selector와 restore selector만 exact copy한다. DOM path를 파싱하거나 common prefix로 group identity를 사후 생성하지 않는다.

## Previous Selected Tab Evidence

Previous selected tab은 별도 approval entry가 아니라 interaction target의 bounded `tabRestore` evidence snapshot으로 표현한다. 다만 current classified peer를 exact하게 다시 찾을 수 있도록 peer의 existing `candidateKey`를 snapshot 안에 보존한다.

이 선택은 다음 책임을 유지한다.

- interaction target과 restore target은 하나의 bounded execution pair로 승인된다.
- restore target에 별도 human decision을 만들지 않는다.
- peer `candidateKey`는 identity/reconciliation에 재사용하지만 approval entry 자체를 독립적으로 요구하지 않는다.
- primary target key가 존재하고 nested restore peer만 없어지면 primary approval은 `missingCandidate`가 아니라 `evidenceChanged`다.

Report/approval의 required bounded restore evidence:

```json
{
  "tabRestore": {
    "strategy": "restorePreviousSelection",
    "tabGroupSelector": "main [role='tablist']",
    "target": {
      "candidateKey": "interaction:selector:89abcdef0123456789abcdef",
      "selector": "#tab-npm",
      "observedUrl": "https://example.test/docs/tabs",
      "pageContext": "Package manager",
      "role": "tab",
      "tagName": "button",
      "text": "npm",
      "ariaAttributes": {
        "selected": "true"
      }
    }
  }
}
```

`type`과 `aria-controls`는 group identity나 restore click에 필요하지 않으므로 MVP restore snapshot field가 아니다. Role과 normalized `tagName`이 element kind review evidence를 제공한다. Bounded target `ariaAttributes`는 `selected`만 허용한다. Full classifier archive, class name, sibling index, surrounding text와 locator alternatives를 복사하지 않는다.

## Schema Version Decision

Artifact별 version 결정:

| Artifact | Current version | 이유 |
| --- | --- | --- |
| Analysis Review Report | `2.1` | `tabRestore`는 safe tab classification을 바꾸지 않는 optional evidence addition이다. Evidence가 없으면 candidate는 계속 report될 수 있다. |
| Interaction Approval artifact | `3.0` | approved tab entry에 bounded restore evidence를 conditionally required로 추가한다. |
| Approval Reconciliation result | `3.0` | tab eligibility와 eligible payload 의미가 target-only에서 approved pair로 바뀐다. |
| Structured Interaction Plan | `3.0` | tab `reset.reloadPage`를 제거하고 required `restorePreviousSelection` pair/state로 바꾼다. |
| Generated Playwright spec | 별도 JSON schema 없음 | Renderer output source이며 plan version을 소비한다. |

Migration framework는 만들지 않는다. Approval/Reconciliation 및 Plan validator/renderer는 old `2.0`을 unsupported version으로 명시적으로 거부한다.

## Plan Top-Level Schema

Schema `3.0` top-level은 schema `2.0`의 shape와 ordering을 유지한다.

```json
{
  "schemaVersion": "3.0",
  "target": {
    "url": "https://example.test"
  },
  "source": {
    "reconciliationPath": "tools/ai-generator/generated/interaction_approval_reconciliation.json",
    "analysisReportPath": "tools/ai-generator/generated/analysis_review_report.json"
  },
  "tests": []
}
```

Top-level과 nested object는 unknown field를 거부한다. `tests`는 `candidateKey` 오름차순이며 candidateKey 하나당 하나의 test만 허용한다. `startUrl`은 current target `observedUrl`의 exact copy이고 target scope와 same-origin이어야 한다.

## Common Test Case Fields

- `id`: existing deterministic ID contract의 exact value
- `title`: non-empty display title
- `candidateKey`: approved interaction target reference
- `template`: supported template
- `pageContext`: eligible target evidence exact copy
- `startUrl`: target `observedUrl` exact copy
- `target`: template-specific exact target snapshot
- `initialState`: template-specific bounded initial state
- `expectedState`: template-specific bounded post-interaction state
- `restore`: `interaction.tabSelection` 전용 restore instruction
- `restoredState`: `interaction.tabSelection` 전용 bounded restored state
- `reset`: `interaction.expandedToggle` 전용 existing reset contract

`restore`와 `restoredState`는 tabSelection에서 required이고 `reset`은 금지한다. ExpandedToggle에서는 `reset`이 required이고 tab-specific `restore`/`restoredState`를 금지한다.

## `interaction.tabSelection` Contract

Target shape:

```json
{
  "target": {
    "selector": "#tab-yarn",
    "interactionKind": "tab",
    "tabGroupSelector": "main [role='tablist']"
  }
}
```

State and restore shape:

```json
{
  "initialState": {
    "interactionTarget": { "selected": false },
    "restoreTarget": { "selected": true }
  },
  "expectedState": {
    "interactionTarget": { "selected": true },
    "restoreTarget": { "selected": false }
  },
  "restore": {
    "strategy": "restorePreviousSelection",
    "target": {
      "candidateKey": "interaction:selector:89abcdef0123456789abcdef",
      "selector": "#tab-npm"
    }
  },
  "restoredState": {
    "interactionTarget": { "selected": false },
    "restoreTarget": { "selected": true }
  }
}
```

Required invariants:

- target `interactionKind == "tab"`
- target selector and restore selector are non-empty, different, exact evidence copies
- target `tabGroupSelector` is the approved/report exact group selector
- target and restore target share exact `observedUrl`, `pageContext` and group evidence in upstream artifacts
- current group contains exactly one selected peer
- restore peer current classification is `safe`, interactionKind is `tab`, role is `tab`, selected is string `"true"`
- interaction target current selected evidence is string `"false"`
- initial/expected/restored objects exactly equal the fixed shapes above

`reloadPage` is not a supported tab strategy in schema `3.0`. A schema `3.0` tab plan containing `reset`, `reloadPage`, arbitrary restore code, a missing peer, or a runtime-derived selector is invalid.

## `interaction.expandedToggle` Contract

Schema `3.0` preserves the implemented schema `2.0` contract without semantic change:

```json
{
  "target": {
    "selector": "main button.details-trigger",
    "interactionKind": "accordion"
  },
  "initialState": { "expanded": false },
  "expectedState": { "expanded": true },
  "reset": {
    "required": true,
    "strategy": "toggleSameTarget",
    "restoredState": { "expanded": false }
  }
}
```

This contract definition does not claim expandedToggle browser runtime PASS.

## Builder Boundary

Builder responsibility:

- reconciliation `eligibleCandidates[]`만 입력 후보로 사용
- exact target `candidateKey`로 current report를 join
- approved/current `tabRestore` snapshot exact match 확인
- explicit group selector와 exactly-one selected peer invariant 확인
- target/restore selector, observedUrl, pageContext와 group relation exact equality 확인
- evidence를 변경 없이 schema `3.0` plan에 복사
- fixed template/state/restore object와 deterministic ID/order 생성

Builder non-responsibility:

- DOM 또는 browser 재탐색
- runtime selected tab 추론
- first/sibling/nearest/text/index 기반 peer 선택
- selector 생성·축약·healing
- classification, human approval 또는 stale status 생성
- Playwright JavaScript 생성이나 browser interaction

Missing group evidence, no selected peer, multiple selected peers, missing restore selector, different group 또는 observed URL mismatch에서는 fake plan을 만들지 않는다. Upstream diagnostic vocabulary는 다음 bounded categories를 사용한다.

- `missingTabGroupEvidence`
- `missingPreviousSelection`
- `ambiguousPreviousSelection`
- `invalidRestoreTarget`

정상 schema `3.0` reconciliation은 이런 candidate를 eligible payload에 넣지 않아야 한다. 따라서 builder가 eligible input에서 이 상태를 발견하면 partial unsupported test가 아니라 input consistency failure로 전체 build를 중단한다. Existing non-tab unsupported categories는 유지한다.

## Validator Boundary

Approval validator와 reconciliation invariant는 [INTERACTION_APPROVAL_CONTRACT.md](INTERACTION_APPROVAL_CONTRACT.md)가 소유한다. Plan validator는 다음을 strict하게 검증한다.

- plan/reconciliation schema `3.0`과 report version `2.1`
- strict unknown-field rejection
- candidateKey eligible membership과 exact current report join
- exact `startUrl`, target selector, interactionKind, pageContext copy
- exact approved/current restore candidateKey, selector와 group selector copy
- target/restore selector inequality와 same URL/context/group relation
- exactly-one selected peer evidence
- `restorePreviousSelection`은 tabSelection에서만 허용
- fixed paired initial/expected/restored states
- tabSelection의 `reloadPage`와 `reset` 거부
- expandedToggle의 existing `toggleSameTarget` reset contract 유지
- executable code, arbitrary expression, callback, fallback selector field 금지

Validator는 DOM을 방문하거나 tab peer를 다시 탐색하지 않는다.

## Renderer Boundary

Renderer는 schema `3.0` strict validator를 통과한 plan만 소비하고 exact selector 두 개를 literal로 사용한다.

Conceptual fixed rendering:

```javascript
await page.goto(startUrl);

const interactionTarget = page.locator(interactionSelector);
const restoreTarget = page.locator(restoreSelector);

await expect(interactionTarget).toHaveAttribute('aria-selected', 'false');
await expect(restoreTarget).toHaveAttribute('aria-selected', 'true');

await interactionTarget.click();
await expect(interactionTarget).toHaveAttribute('aria-selected', 'true');
await expect(restoreTarget).toHaveAttribute('aria-selected', 'false');

await restoreTarget.click();
await expect(restoreTarget).toHaveAttribute('aria-selected', 'true');
await expect(interactionTarget).toHaveAttribute('aria-selected', 'false');
```

Renderer는 selected tab 검색, tablist first tab 선택, sibling/parent traversal, reload fallback, storage/hash 초기화, selector healing 또는 approval lookup을 하지 않는다. `tabGroupSelector`는 validated relationship evidence로 plan에 보존하지만 renderer는 selector를 상대화하거나 runtime group 탐색에 사용하지 않는다.

## Failure Semantics

이번 contract는 execution report schema를 추가하지 않는다. Playwright assertion, HTML report와 trace가 다음 runtime stage를 구분하는 현재 evidence boundary를 유지한다.

- restore target resolution failure
- restore target initial selected-state mismatch
- interaction 후 restore target이 false가 되지 않음
- restore click 후 restore target이 true가 되지 않음
- restore click 후 interaction target이 false가 되지 않음

## Neutral Schema `3.0` Example

```json
{
  "schemaVersion": "3.0",
  "target": {
    "url": "https://example.test"
  },
  "source": {
    "reconciliationPath": "tools/ai-generator/generated/interaction_approval_reconciliation.json",
    "analysisReportPath": "tools/ai-generator/generated/analysis_review_report.json"
  },
  "tests": [
    {
      "id": "interaction-test:selector:0123456789abcdef01234567:tabSelection",
      "title": "Interaction: package manager tab selection",
      "candidateKey": "interaction:selector:0123456789abcdef01234567",
      "template": "interaction.tabSelection",
      "pageContext": "Package manager",
      "startUrl": "https://example.test/docs/tabs",
      "target": {
        "selector": "#tab-yarn",
        "interactionKind": "tab",
        "tabGroupSelector": "main [role='tablist']"
      },
      "initialState": {
        "interactionTarget": { "selected": false },
        "restoreTarget": { "selected": true }
      },
      "expectedState": {
        "interactionTarget": { "selected": true },
        "restoreTarget": { "selected": false }
      },
      "restore": {
        "strategy": "restorePreviousSelection",
        "target": {
          "candidateKey": "interaction:selector:89abcdef0123456789abcdef",
          "selector": "#tab-npm"
        }
      },
      "restoredState": {
        "interactionTarget": { "selected": false },
        "restoreTarget": { "selected": true }
      }
    }
  ]
}
```

## Runtime Verification And Next Frontier

Completed evidence:

- exact navigation and locator resolution
- initial selected false assertion
- target click and expected selected true transition
- reload action and post-reload locator resolution
- reloadPage restore failure identification
- previous-selection restore documentation contract
- plan builder/validator schema `3.0`
- deterministic `restorePreviousSelection` renderer
- neutral generated spec Node syntax와 Playwright static discovery
- fresh Report `2.1` → Approval/Reconciliation `3.0` → Plan `3.0` chain
- exact target click과 restore click의 paired state assertion
- workers 1, retries 0, trace on으로 동일 public tab test 2회 PASS

Not implemented:

- expandedToggle runtime
- cross-site interaction runtime regression

Next frontier:

```text
expandedToggle runtime validation
  or
approval writer/editor product integration
```
