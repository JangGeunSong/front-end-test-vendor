# Structured Interaction Plan Contract

## Purpose

이 문서는 approval reconciliation의 eligible interaction candidate와 deterministic Level 3 renderer 사이의 structured contract를 정의한다.

목표는 approved safe candidate를 free-form Playwright JavaScript 없이 bounded plan으로 표현하고, validator와 renderer가 classification, approval 또는 selector 추론을 다시 수행하지 않게 하는 것이다. Deterministic builder, strict validator와 두 MVP template의 deterministic renderer가 구현되어 있다. Generated spec의 browser execution은 아직 구현·검증되지 않았다.

## Architecture Position

```text
current classified candidates
  + human approval artifact
  -> approval validation / reconciliation
  -> eligibleCandidates
  -> deterministic interaction plan builder
  -> structured interaction plan
  -> strict interaction plan validator
  -> deterministic Level 3 renderer
  -> generated Playwright interaction spec
  -> future browser execution / execution report
```

계층별 source of truth:

- classifier: `safe`, `unsafe`, `unknown`과 `interactionKind`
- approval artifact: `approved`, `held`, `rejected`와 human review evidence
- reconciliation: exact current reference status와 eligibility
- interaction plan: bounded execution/reset instruction
- renderer: fixed Playwright code shape
- execution report: runtime result와 failure evidence

한 계층의 상태를 다른 계층의 enum으로 합치지 않는다.

## Level 3 MVP Goal

Level 3 MVP는 business scenario automation이 아니라 page-level safe interaction smoke test다.

MVP 원칙:

- input은 reconciliation의 current `safe` + human `approved` + `valid` reference인 eligible candidate뿐이다.
- interaction 전 state를 확인하고, interaction 후 bounded expected state를 확인한다.
- 검증 후 page-level UI state를 deterministic하게 reset하고 restored state를 확인한다.
- 데이터 변경, 인증, 결제, 전송, upload, personal information input은 표현하거나 실행하지 않는다.

Save, submit, create/register, update/edit, delete, payment, approval, send, upload, login/signup과 destructive/irreversible action은 schema의 template으로 존재하지 않는다.

## Terminology

- **interactionKind**: classifier가 candidate의 구조와 의미를 분류한 taxonomy다.
- **plan template**: renderer가 사용할 deterministic interaction/state/reset 전략이다.
- **eligible candidate**: reconciliation result의 `eligibleCandidates[]`에 존재하는 current safe candidate다.
- **observed URL**: candidate가 rendered DOM에서 실제 관찰될 당시 browser의 absolute HTTP(S) URL이다.
- **start URL**: future renderer가 test를 시작할 exact URL이며 current candidate `observedUrl`의 exact copy다.
- **target snapshot**: eligible candidate에서 exact copy한 selector와 interaction kind다.
- **initial state**: interaction 직전에 확인할 bounded UI state다.
- **expected state**: interaction 직후 확인할 bounded UI state다.
- **reset**: interaction으로 바뀐 page-level UI state를 초기 상태로 되돌리는 action이다.
- **restored state**: reset 후 다시 확인할 initial state다.

이 문서에서 rollback은 사용하지 않는다. Database transaction이나 data mutation rollback은 Level 3 MVP 범위가 아니다.

## Plan Responsibility

Structured Interaction Plan이 소유하는 정보:

- 실행할 eligible `candidateKey`
- deterministic plan template
- exact execution target snapshot
- bounded initial/expected state
- required reset strategy와 restored state
- renderer가 고정된 execution shape를 선택하는 데 필요한 최소 field

Structured Interaction Plan이 소유하지 않는 정보:

- human decision, reviewer, review time 또는 approval note
- approval evidence archive
- classifier output 전체
- reconciliation result 전체 또는 stale history
- free-form JavaScript, Playwright locator/assertion code, regex 또는 callback
- execution result, retry history, trace, screenshot binary/data

Plan은 generated intermediate artifact다. Human-authored approval state가 아니며 생성 시각을 포함하지 않는다.

Deterministic builder의 기본 output path는 `tools/ai-generator/generated/interaction_plan.generated.json`이다. 이 파일은 generated intermediate artifact이며 기본적으로 commit하지 않는다. Optional shadow producer가 추가되면 같은 파일을 overwrite하지 않고 별도 artifact path를 사용해야 한다.

## Input And Provenance Boundary

Builder와 validator는 다음 artifact를 함께 읽는다.

- `interaction_approval_reconciliation.json`: eligibility와 exact eligible payload
- `analysis_review_report.json`: current ARIA/state evidence

Eligibility source of truth는 reconciliation result다. Analysis Review Report는 state evidence resolution에만 사용하며 builder/validator가 classification 또는 approval reconciliation을 다시 수행하지 않는다.

Plan build 직전에 reconciliation을 완료하고, target URL과 candidateKey 및 eligible payload의 selector, interactionKind, pageContext, `observedUrl`이 current report candidate와 일치해야 한다. Artifact provenance를 확인할 수 없거나 state evidence가 부족하면 plan case를 만들지 않는다. `target.url`은 전체 분석 scope이고 candidate 실행 위치가 아니다. `pageContext` 또는 target root로 실행 URL을 추론하거나 보충하지 않는다.

## Plan Top-Level Schema

```json
{
  "schemaVersion": "2.0",
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

Top-level contract:

- `schemaVersion`: required, current value `2.0`
- `target.url`: required non-empty absolute HTTP(S) URL; reconciliation/report target와 exact match
- `source.reconciliationPath`: required non-empty string
- `source.analysisReportPath`: required non-empty string
- `tests`: required array

두 source path는 absolute filesystem path가 아니라 portable repository-relative path이며, validator CLI에 실제로 전달된 reconciliation/report artifact를 exact하게 식별해야 한다. Schema validation은 다른 환경에서 artifact를 옮겨 검증할 수 있도록 path 자체의 filesystem existence를 요구하지 않고, CLI가 읽는 input file 존재 여부는 load 단계에서 별도로 확인한다.

`tests`는 `candidateKey` 오름차순으로 저장한다. Eligible candidate가 있어도 supported template state evidence가 없으면 빈 array를 허용한다. Empty plan은 실행할 interaction이 없다는 의미이며 unsafe/unknown candidate를 대체 test로 넣지 않는다.

Top-level과 모든 nested object는 schema `2.0`에서 unknown field를 거부한다. Schema `2.0`은 per-test execution provenance인 required `startUrl` 추가 때문에 `1.0`에서 major version을 올렸다. Migration framework는 제공하지 않으며 validator는 `1.0`을 명시적으로 거부한다. Schema producer가 deterministic builder인지 bounded LLM shadow path인지는 contract에 영향을 주지 않는다. 모든 producer는 같은 validator를 통과해야 한다.

## Common Test Case Fields

모든 `tests[]` item은 다음 field를 가진다.

- `id`: required unique deterministic machine-readable string
- `title`: required human-readable string
- `candidateKey`: required unique exact eligible candidate reference
- `template`: required supported plan template
- `pageContext`: eligible candidate에서 exact copy한 string; 빈 문자열 허용
- `startUrl`: current candidate `observedUrl`의 required exact copy인 absolute credential-free HTTP(S) URL
- `target`: required exact target snapshot
- `initialState`: required template-specific bounded state
- `expectedState`: required template-specific bounded state
- `reset`: required template-specific reset/restore contract

MVP에서는 candidateKey 하나당 test case 하나만 허용한다. 동일 candidate의 execution variation은 근거가 생길 때 별도 schema decision으로 다룬다.

### Deterministic Test ID

Exact format:

```text
interaction-test:<selector|fallback>:<24-character candidate digest>:<tabSelection|expandedToggle>
```

`candidateKey`의 identity kind/digest와 plan template name을 그대로 결합한다. Array index, generation timestamp, Python `hash()`를 사용하지 않는다. Validator는 shared contract function으로 expected ID를 exact recompute한다.

### Target Snapshot

MVP는 selector를 plan에 포함하는 Option B를 선택한다.

```json
{
  "target": {
    "selector": "main [role='tab']:nth-of-type(1)",
    "interactionKind": "tab"
  }
}
```

선택 이유:

- validated plan만으로 renderer가 deterministic target을 사용할 수 있다.
- validator가 reconciliation `eligibleCandidates[]`의 selector와 interactionKind에 exact equality를 요구할 수 있다.
- selector synthesis/shortening을 명시적으로 차단할 수 있다.

`target.selector`와 `target.interactionKind`는 eligible payload의 exact copy다. LLM이나 builder가 selector를 생성, 축약, 조합, fallback하지 않는다. Mismatch는 plan validation error다.

## Candidate Reference Contract

```text
tests[].candidateKey
  -> reconciliation.eligibleCandidates[].candidateKey exact match
```

Plan builder/validator는 다음을 확인해야 한다.

- plan target URL과 reconciliation target URL exact match
- candidateKey가 `eligibleCandidates[]`에 존재
- eligible payload의 `currentClassification`이 `safe`
- plan 안의 unique candidateKey
- startUrl, target selector, interactionKind, pageContext의 exact eligible evidence match
- startUrl과 Analysis Review Report current candidate observedUrl의 exact match

`tests[].startUrl`은 plan `target.url`과 달라도 되지만 같은 origin이어야 한다. Query, fragment, trailing slash와 URL encoding을 포함한 문자열을 normalize하지 않는다. Future renderer는 이 값을 그대로 `page.goto(startUrl)`의 시작 위치로 사용한다.

Array index와 selector 원문만으로 candidate identity를 대신하지 않는다. Missing candidate를 similarity로 교체하거나 old approval을 carry forward하지 않는다.

## Template Taxonomy

`interactionKind`와 plan template은 다른 책임을 가진다.

Classifier가 현재 생성할 수 있는 safe interactionKind:

- `readOnlySelect`
- `tab`
- `accordion`
- `expandCollapse`
- `modalOpen`
- `modalClose`
- `dropdown`
- `popover`
- `carouselPrevious`
- `carouselNext`

Structured Interaction Plan schema `2.0`의 supported template은 두 개다.

| Plan template | Eligible interactionKind | Execution strategy | Reset strategy |
| --- | --- | --- | --- |
| `interaction.tabSelection` | `tab` | click target and verify selection | `reloadPage` |
| `interaction.expandedToggle` | `accordion`, `expandCollapse` | click target and verify expansion | `toggleSameTarget` |

Dialog, dropdown, popover, carousel, read-only select는 candidate classification은 가능하지만 현재 evidence만으로 deterministic expected state와 reset target/pair를 모두 증명할 수 없어 schema `2.0` plan template으로 지원하지 않는다.

Unsupported interactionKind를 generic/todo template으로 실행하지 않는다. Template enum 확장은 state evidence, reset strategy, validator와 renderer contract가 함께 정의될 때 schema version 정책에 따라 수행한다.

## Initial State Contract

Initial state는 template별 fixed object shape를 사용한다. Generic attribute name, expression, JavaScript 또는 arbitrary assertion language를 허용하지 않는다.

### Tab selection

```json
{
  "initialState": {
    "selected": false
  }
}
```

Builder는 current Analysis Review Report의 exact candidate에 `ariaAttributes.selected == "false"` evidence가 있을 때만 이 case를 만든다. 이미 selected 상태이거나 evidence가 없으면 unsupported다.

### Expanded toggle

```json
{
  "initialState": {
    "expanded": false
  }
}
```

Builder는 exact candidate에 `ariaAttributes.expanded == "false"` evidence가 있을 때만 이 case를 만든다. Evidence가 없거나 이미 expanded 상태이면 unsupported다.

## Expected State Contract

Expected state도 template별 fixed object shape를 사용한다.

### Tab selection

```json
{
  "expectedState": {
    "selected": true
  }
}
```

Future renderer는 target click 후 같은 exact target의 selected state가 true인지 확인한다. Associated panel visibility와 previous selected tab 관계는 current eligible payload만으로 증명할 수 없으므로 MVP assertion에 포함하지 않는다.

### Expanded toggle

```json
{
  "expectedState": {
    "expanded": true
  }
}
```

Future renderer는 target click 후 같은 exact target의 expanded state가 true인지 확인한다. Controlled region visibility는 current eligible payload가 controlled target selector를 보존하지 않으므로 MVP required assertion이 아니다.

## Reversible Reset And Restore Contract

모든 schema `2.0` template은 reset을 required로 둔다.

```json
{
  "reset": {
    "required": true,
    "strategy": "toggleSameTarget",
    "restoredState": {
      "expanded": false
    }
  }
}
```

Supported reset strategy:

- `toggleSameTarget`: interaction target을 다시 click하고 restored state를 확인한다. `interaction.expandedToggle` 전용이다.
- `reloadPage`: 현재 page를 reload하고 exact target을 다시 resolve한 뒤 restored state를 확인한다. `interaction.tabSelection` 전용이다.

`none`, `navigateBack`, `pressEscape`, `clickCloseTarget`, `restorePreviousSelection`은 schema `2.0`에서 지원하지 않는다.

- `none`은 reset/restore 기본 원칙을 만족하지 않는다.
- `navigateBack`은 Level 1/2 navigation 책임과 섞이고 URL mutation을 전제로 한다.
- `pressEscape`와 `clickCloseTarget`은 current evidence에 reset support 또는 close target relation이 없다.
- `restorePreviousSelection`은 previous selected target reference가 current eligible payload에 없다.

Reset 성공 후 `restoredState`는 `initialState`와 같은 의미와 값을 가져야 한다.

## Template-Specific Requirements

### `interaction.tabSelection`

Required:

- eligible `interactionKind == "tab"`
- exact non-empty eligible selector
- current report `ariaAttributes.selected == "false"`
- `initialState == {"selected": false}`
- `expectedState == {"selected": true}`
- reset required true
- reset strategy `reloadPage`
- `restoredState == {"selected": false}`

Unsupported:

- initially selected tab
- missing selected evidence
- selector mismatch
- plan that attempts previous-tab discovery or arbitrary panel assertion

### `interaction.expandedToggle`

Required:

- eligible `interactionKind` is `accordion` or `expandCollapse`
- exact non-empty eligible selector
- current report `ariaAttributes.expanded == "false"`
- `initialState == {"expanded": false}`
- `expectedState == {"expanded": true}`
- reset required true
- reset strategy `toggleSameTarget`
- `restoredState == {"expanded": false}`

Unsupported:

- initially expanded target
- missing expanded evidence
- selector mismatch
- controlled-region assertion without exact controlled target evidence

## Plan Validation Invariants

Interaction plan validator는 다음을 strict하게 검증한다.

- supported schema version
- strict top-level/nested unknown field rejection
- absolute HTTP(S) target and exact reconciliation/report target match
- required source object and test array
- unique test id and candidateKey
- candidateKey exists exactly once in reconciliation eligible candidates
- current classification is safe and eligibility came from validated reconciliation
- supported template and interactionKind compatibility
- exact startUrl, selector, interactionKind, pageContext copy from eligible payload
- credential-free absolute HTTP(S) startUrl, target same-origin, report observedUrl exact match
- exact current report candidate state evidence
- template-specific bounded initial/expected/restored state
- reset required true and template-supported reset strategy
- candidateKey order is deterministic
- no executable code, arbitrary expression, locator code, callback or script field
- no unsafe, unknown, held, rejected, stale or unreviewed candidate reference

Plan validator는 classifier를 다시 실행하지 않고 approval decision 또는 reconciliation status를 다시 계산하지 않는다.

## Implemented Builder Boundary

Builder responsibility:

- reconciliation eligible candidate만 입력 후보로 사용
- candidateKey로 current report state evidence resolve
- interactionKind를 supported plan template으로 deterministic mapping
- observedUrl을 `startUrl`로, selector/context를 eligible evidence에서 exact copy
- template-specific state/reset object 생성
- candidateKey 순서와 deterministic id/title 생성
- evidence가 부족한 eligible candidate를 explicit unsupported diagnostic으로 남김

Builder non-responsibility:

- candidate classification 재수행
- human approval 생성 또는 변경
- stale reconciliation 재계산
- heuristic candidate remapping
- selector/assertion synthesis
- Playwright JavaScript 생성
- browser interaction

Unsupported candidate는 executable TODO plan case로 넣지 않는다. 별도 artifact를 늘리지 않고 deterministic CLI summary에서 `unsupportedInteractionKind`, `missingStateEvidence`, `initialStateNotSupported`, `missingSelector`를 candidateKey 순서로 보고한다. Eligible reference가 report에서 누락되거나 target/exact evidence가 불일치하면 unsupported가 아니라 input consistency failure로 처리하고 partial plan을 생성하지 않는다.

기본 command:

```text
npm run ai:build-interaction-plan
npm run ai:validate-interaction-plan
npm run ai:render-interaction-plan
```

Neutral fixture command:

```text
npm run ai:build-interaction-plan -- --fixture tools/ai-generator/fixtures/interaction_plan_builder.fixture.json
npm run ai:validate-interaction-plan -- --fixture tools/ai-generator/fixtures/interaction_plan_validator.fixture.json
```

## Renderer And Execution Boundary

`tools/ai-generator/render_interaction_plan.py`는 validated template과 bounded fields만 해석해 `tests/generated/generated_interaction_plan.spec.js`를 생성한다. Renderer direct invocation은 malformed input과 renderer 필수 field를 fail-fast하지만 strict eligibility/evidence validation은 선행 validator 책임으로 유지한다.

Renderer responsibility:

- exact `startUrl`로 test 시작 위치 준비
- fixed target locator shape
- fixed click sequence
- fixed initial/expected/restored state assertion
- fixed reset strategy implementation
- unsupported template rejection
- timestamp, local absolute path와 environment-dependent output이 없는 byte-stable UTF-8 source

Renderer가 selector fallback, candidate search, approval lookup, generic JavaScript evaluation을 수행하지 않는다.

현재 fixed rendering은 `interaction.tabSelection`의 selected false → true → reload → false assertion과 `interaction.expandedToggle`의 expanded false → true → same-target toggle → false assertion만 지원한다. Reload와 toggle은 restore action이며 restored assertion이 성공 여부를 판정한다.

Generated source는 JavaScript syntax와 Playwright `--list` discovery까지 검증한다. Browser execution과 execution report는 별도 future layer다. Plan JSON에 runtime result를 기록하지 않는다.

## Future Failure Contract

Future execution report는 최소 다음 failure category를 구분해야 한다.

- `targetNotResolvable`
- `initialStateMismatch`
- `expectedStateNotReached`
- `resetUnavailable`
- `restoredStateMismatch`

이 값은 plan schema field가 아니다. Plan은 expected contract만 소유하며 runtime result와 evidence는 future execution report가 소유한다.

## Minimal Neutral Example

```json
{
  "schemaVersion": "2.0",
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
      "title": "Interaction: Overview tab selection",
      "candidateKey": "interaction:selector:0123456789abcdef01234567",
      "template": "interaction.tabSelection",
      "pageContext": "Overview",
      "startUrl": "https://example.test/docs/overview?mode=basic#tabs",
      "target": {
        "selector": "main [role='tab']:nth-of-type(1)",
        "interactionKind": "tab"
      },
      "initialState": {
        "selected": false
      },
      "expectedState": {
        "selected": true
      },
      "reset": {
        "required": true,
        "strategy": "reloadPage",
        "restoredState": {
          "selected": false
        }
      }
    },
    {
      "id": "interaction-test:selector:89abcdef0123456789abcdef:expandedToggle",
      "title": "Interaction: Details expansion",
      "candidateKey": "interaction:selector:89abcdef0123456789abcdef",
      "template": "interaction.expandedToggle",
      "pageContext": "Details",
      "startUrl": "https://example.test/docs/details",
      "target": {
        "selector": "main button.details-trigger",
        "interactionKind": "accordion"
      },
      "initialState": {
        "expanded": false
      },
      "expectedState": {
        "expanded": true
      },
      "reset": {
        "required": true,
        "strategy": "toggleSameTarget",
        "restoredState": {
          "expanded": false
        }
      }
    }
  ]
}
```

## MVP Non-Goals

- approval writer/editor
- Level 3 browser execution과 runtime helper/evidence report
- unsafe or unknown action representation
- business scenario sequencing
- form input and data mutation
- dialog/dropdown/popover/carousel/read-only select execution
- arbitrary assertion DSL or executable script field
- runtime retry, trace, screenshot or result schema

## Open Questions And Future Extensions

- Reconciliation/analysis artifact content hash가 plan provenance에 필요한지
- Controlled target/close target/counterpart selector evidence를 reconciliation eligible payload에 확장할지
- Dialog/dropdown/popover의 bounded visibility/reset contract
- Carousel next/previous pair identity와 restored item contract
- Previous selected tab reference를 수집해 reload 없이 restore할 수 있는지
- Deterministic builder와 optional bounded LLM shadow comparison 경계
