# Interaction Approval Contract

## Purpose

이 문서는 classified interaction candidate와 Level 3 structured interaction plan 사이의 human approval boundary를 정의한다. Implemented approval schema `3.0`은 interaction target과 previous selected restore target을 bounded pair로 검토한다. Plan schema `3.0`과 deterministic renderer가 이 pair를 exact 소비하며 fresh public runtime에서 paired restore를 2회 검증했다.

목표는 사람이 현재 candidate evidence를 검토해 내린 결정을 versioned JSON artifact로 보존하고, future reconciliation 단계가 승인된 후보만 interaction plan 입력 후보로 전달할 수 있게 하는 것이다. 이 계약은 browser interaction, executable Playwright instruction, interaction plan template을 정의하지 않는다.

## Architecture Position

```text
classified candidate evidence
  -> Analysis Review Report
  -> human review
  -> interaction approval artifact
  -> approval validation / reconciliation
  -> eligible approved candidates
  -> future structured interaction plan
```

각 계층의 책임은 분리한다.

- classifier의 `safe`, `unsafe`, `unknown`은 machine assessment다.
- approval artifact의 `approved`, `held`, `rejected`는 human decision이다.
- reconciliation의 valid/stale/ineligible 결과는 current candidate와 approval artifact를 대조한 derived status다.
- future structured interaction plan은 template, bounded initial/expected state와 page UI reset/restore를 소유한다.

`safe` classification, `approved` decision, valid reconciliation 중 어느 하나도 단독으로 browser execution을 허용하지 않는다.

## Terminology

- **candidate**: classifier가 현재 artifact에서 수집하고 분류한 interaction 후보다.
- **candidateKey**: classifier canonical identity와 deduplication이 공유하는 deterministic reference다.
- **decision**: 사람이 candidate evidence를 검토한 뒤 기록한 `approved`, `held`, `rejected` 값이다.
- **evidence snapshot**: decision 당시 검토한 candidate의 최소 immutable evidence다.
- **stale approval reference**: 현재 candidate set에서 exact reference와 검토 evidence를 유효하게 재확인할 수 없는 approval entry다.
- **eligible candidate**: current `safe` classification, human `approved` decision, valid non-stale reconciliation과 template-specific execution readiness를 모두 만족한 future plan 입력 후보다.
- **restore target**: approved tab interaction 후 original selection을 복원하기 위해 실제 click될 same-group previous selected tab이다.
- **bounded execution pair**: 하나의 approval entry 안에서 함께 검토되는 interaction target과 restore target이다. Restore target은 별도 decision entry가 아니다.

## Artifact Responsibility

Approval artifact가 소유하는 정보:

- 대상 URL scope
- `candidateKey` reference
- human decision
- decision 당시의 최소 evidence snapshot
- reviewer, review time, optional note

Approval artifact가 소유하지 않는 정보:

- classifier output 전체 복사본
- executable selector script 또는 Playwright code
- interaction template과 steps
- expected state assertion
- page UI reset/restore procedure
- execution result 또는 regression promotion state

이 artifact는 test plan이 아니며 selector를 실행하기 위한 script도 아니다. `selector`는 evidence snapshot 안에서 사람이 무엇을 검토했는지 확인하고 stale comparison에 사용하기 위한 값이다.

## File And Storage Contract

MVP 기본 경로:

```text
tools/ai-generator/review/interaction_approvals.json
```

이 위치를 선택한 이유:

- `tools/ai-generator/generated/`는 재생성 가능한 실행 산출물이며 직접 수정하지 않는다는 기존 정책을 유지한다.
- approval은 사람이 의도적으로 작성하거나 수정하는 review state이므로 generated artifact와 분리한다.
- target URL, selector, display text, reviewer identifier가 포함될 수 있으므로 기본적으로 Git commit 대상에서 제외한다.
- future target별 workspace가 도입되면 workspace 내부에서 같은 basename과 schema를 사용할 수 있다. 위치가 달라져도 schema 의미는 바뀌지 않는다.

한 approval artifact는 정확히 하나의 `target.url`에 scope된다. 여러 target의 approval을 한 파일에 합치지 않는다. Runtime validator와 reconciler는 구현되었지만 artifact writer, editor, workspace management는 아직 구현되지 않았다.

## Schema Version Contract

Top-level `schemaVersion`은 필수다. Current implementation은 `3.0`이다. Candidate 실행 위치를 immutable evidence로 보존한 `2.0`에 이어, approved unselected tab의 required bounded restore evidence와 eligibility 의미 변경 때문에 major version을 올렸다.

- major 변경: field 제거/이름 변경, required field 추가, 기존 field 의미 변경, decision 또는 classification enum 변경·확장
- minor 변경: 기존 의미를 바꾸지 않는 optional field 추가
- 문구 정정이나 example 수정처럼 JSON contract를 바꾸지 않는 변경: version 유지

Migration framework는 만들지 않는다. Validator/reconciler는 approval `2.0`을 명시적으로 거부하며 silent default restore target을 만들지 않는다. Strict enum을 사용하므로 enum expansion도 major 변경으로 취급한다.

## Decision Model

`decision`은 다음 세 값만 허용한다.

### `approved`

현재 evidence snapshot을 사람이 검토했고 future interaction plan 입력 후보로 전달해도 된다는 결정이다.

- 즉시 browser execution을 의미하지 않는다.
- snapshot `classification`이 `safe`인 entry에만 허용한다.
- current candidate도 reconciliation 시점에 다시 `safe`여야 한다.

### `held`

판단 근거가 부족하거나 후속 확인 후 다시 검토해야 한다는 결정이다. Future interaction plan 입력 대상이 아니다.

### `rejected`

현재 evidence를 기준으로 interaction automation 후보로 사용하지 않겠다는 명시적 결정이다. Machine `unknown` classification과 다르며, future interaction plan 입력 대상이 아니다.

Entry가 없으면 candidate는 unreviewed다. `unreviewed`, `stale`, `expired`, `archived` 같은 값을 decision enum에 추가하지 않는다.

## Candidate Reference Contract

Approval entry의 primary reference는 `candidateKey`다.

- array index를 reference로 사용하지 않는다.
- selector 원문만을 primary identity로 사용하지 않는다.
- `candidateKey` 형식은 `interaction:<selector|fallback>:<24-character SHA-256 digest>`다.
- selector가 있으면 normalized `pageContext`와 `selector`가 canonical identity다.
- selector가 없으면 normalized `pageContext`, `role`, `type`, `tagName`, case-folded `text`가 fallback identity다.

`candidateKey`는 permanent business identifier가 아니다. Selector 또는 page context가 바뀌면 key가 바뀔 수 있고, target URL은 key 자체에 포함되지 않으므로 artifact의 `target.url` scope가 필수다.

## Evidence Snapshot Contract

`evidenceSnapshot`은 decision 당시 candidate의 최소 immutable review evidence다. Approval entry를 갱신하려면 기존 snapshot을 조용히 덮어쓰는 것이 아니라 사람이 current evidence를 다시 검토하고 `review` metadata와 snapshot을 함께 새로 기록해야 한다.

Required fields:

- `classification`: `safe`, `unsafe`, `unknown`
- `confidence`: `high`, `medium`, `low`
- `pageContext`: string, 값이 없으면 빈 문자열
- `observedUrl`: candidate가 실제 rendered DOM에서 관찰된 absolute credential-free HTTP(S) URL; artifact `target.url`과 same-origin
- `selector`: string, selector가 없으면 빈 문자열
- `text`: classifier가 제공한 display string, 값이 없으면 빈 문자열
- `role`: string, 값이 없으면 빈 문자열
- `type`: string, 값이 없으면 빈 문자열
- `tagName`: normalized lowercase string, 값이 없으면 빈 문자열
- `ariaAttributes`: object, 값이 없으면 빈 object

Conditional fields:

- `interactionKind`: snapshot `classification`이 `safe`이면 필수
- `actionKind`: snapshot `classification`이 `unsafe`이면 필수
- `riskLevel`: snapshot `classification`이 `unsafe`이면 필수

현재 classifier가 제공하지만 snapshot에 저장하지 않는 field:

- `href`, `semanticRegion`, `formAssociation`, `surroundingText`
- `candidateSource`, `candidateSources`
- `reason`, `evidence`, `suggestedAction`

이 field들은 Analysis Review Report에서 상세 검수 근거로 유지되거나 classifier가 다시 생성할 수 있다. Approval artifact는 classifier output의 archive가 아니므로 그대로 복제하지 않는다. Optional human rationale는 `review.note`에 기록한다.

## Reviewer Metadata Boundary

각 approval entry에는 `review` object가 필수다.

- `reviewer`: required non-empty opaque string. Email, account schema, 인증 시스템과 결합하지 않는다.
- `reviewedAt`: required ISO 8601 timestamp with timezone offset or `Z`.
- `note`: optional non-empty string. Human decision의 추가 맥락이며 machine classification을 대체하지 않는다.

Approval artifact는 human-authored state이므로 deterministic generated report와 달리 review timestamp를 갖는다. MVP는 authentication, user management, reviewer directory를 설계하지 않는다.

## Schema `3.0` Tab Restore Evidence

Schema `3.0`은 approved `interactionKind == "tab"` entry를 target-only decision으로 취급하지 않는다. Interaction target click과 restore target click은 하나의 bounded execution pair이며 사람이 pair evidence를 함께 검토한다. Restore target에 별도 `approvals[]` entry나 별도 human decision을 만들지는 않는다.

Schema `3.0` `evidenceSnapshot` allowed fields는 existing schema `2.0` fields에 `tabRestore` 하나를 추가한다. Non-tab snapshot에서는 `tabRestore`를 금지한다.

`evidenceSnapshot.tabRestore`는 다음 조건에서 required다.

- `decision == "approved"`
- `classification == "safe"`
- `interactionKind == "tab"`
- interaction target `ariaAttributes.selected == "false"`

`held`와 `rejected` tab entry에는 `tabRestore`가 optional이다. 존재하면 같은 strict shape와 current report exact-copy rule을 적용한다. Approved tab인데 deterministic restore evidence가 없으면 artifact validation에 실패하므로 future eligibility가 없다. Candidate의 machine classification은 계속 `safe`일 수 있다. 즉 `safe`와 restore readiness는 별도 상태다.

Exact shape:

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

Required invariants:

- `strategy`는 exact `restorePreviousSelection`이다.
- `tabGroupSelector`는 closest explicit `role=tablist` ancestor의 non-empty exact selector다.
- restore target `candidateKey`는 current classified peer의 exact key지만 독립 approval entry를 요구하지 않는다.
- restore target selector는 non-empty이며 interaction target selector와 다르다.
- restore target `observedUrl`과 `pageContext`는 interaction target snapshot과 exact match한다.
- restore target `role == "tab"`, normalized lowercase `tagName`, `ariaAttributes == {"selected": "true"}`다.
- current report evidence는 interaction target과 restore target이 같은 exact group 아래에 있고 group의 selected peer가 정확히 하나임을 증명해야 한다.
- `tabRestore`, nested target과 nested `ariaAttributes`도 unknown field를 거부한다.

Restore snapshot은 classifier archive가 아니다. Confidence, class name, sibling position, surrounding text, alternative locator와 `aria-controls`는 MVP field가 아니다. 사람은 report의 richer evidence를 검토하고 approval에는 stale 비교에 필요한 최소 pair만 보존한다.

## Minimal Schema `3.0` JSON Contract

```json
{
  "schemaVersion": "3.0",
  "target": {
    "url": "https://example.test/"
  },
  "approvals": [
    {
      "candidateKey": "interaction:selector:0123456789abcdef01234567",
      "decision": "approved",
      "evidenceSnapshot": {
        "classification": "safe",
        "confidence": "high",
        "pageContext": "Package manager",
        "observedUrl": "https://example.test/docs/tabs",
        "selector": "#tab-yarn",
        "text": "yarn",
        "role": "tab",
        "type": "",
        "tagName": "button",
        "ariaAttributes": {
          "selected": "false"
        },
        "interactionKind": "tab",
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
      },
      "review": {
        "reviewer": "local-qa",
        "reviewedAt": "2026-07-15T09:30:00+09:00",
        "note": "Target and previous selected restore tab reviewed as one pair."
      }
    }
  ]
}
```

## Current Validation Implementation And Plan Boundary

`tools/ai-generator/validate_interaction_approvals.py`는 schema `3.0`과 bounded tab pair invariant를 strict하게 검증한다.

- top-level required fields: `schemaVersion`, `target`, `approvals`
- `target.url`: required non-empty absolute HTTP(S) URL
- `evidenceSnapshot.observedUrl`: required absolute credential-free HTTP(S) URL이며 target과 same-origin
- approval required fields: `candidateKey`, `decision`, `evidenceSnapshot`, `review`
- `candidateKey`: documented interaction key format
- `decision`: `approved`, `held`, `rejected`
- `classification`: `safe`, `unsafe`, `unknown`
- `confidence`: `high`, `medium`, `low`
- `approved` entry의 snapshot classification은 반드시 `safe`
- conditional kind/risk field 존재 여부
- reviewer와 timezone이 있는 review timestamp
- 같은 artifact 안의 duplicate `candidateKey` 금지
- `approvals` 배열은 비어 있어도 유효함
- 배열 의미는 순서에 의존하지 않으며 writer는 diff 안정성을 위해 `candidateKey` 오름차순으로 저장
- supported schema version의 top-level 및 nested object에서 unknown field를 거부

Unknown field와 unsupported enum을 조용히 무시하지 않는다. Approved safe unselected tab에는 `tabRestore`가 필수이며, validator는 conditional pair shape, exact field type, same URL/context, target/restore selector inequality와 selected false/true state를 검증한다. Group membership와 exactly-one selected peer는 current report evidence를 소비하는 reconciliation이 검증한다.

현재 classifier representation에 맞춰 `ariaAttributes`의 key는 `label`, `expanded`, `pressed`, `selected`, `controls`, `haspopup`, `readonly`만 허용하며 value는 string이어야 한다. `safe` snapshot에는 `interactionKind`만, `unsafe` snapshot에는 `actionKind`와 `riskLevel`만 허용하고 `unknown` snapshot에는 conditional kind/risk field를 허용하지 않는다. Validator는 classifier identity algorithm을 재구현하지 않고 `candidateKey` 형식만 검증한다.

기본 실행:

```text
npm run ai:validate-interaction-approvals
```

기본 approval file이 없거나 JSON parse/schema validation이 실패하면 non-zero로 종료한다.

## Stale Approval Rules

Stale은 human decision이 아니므로 approval artifact의 `decision` enum에 저장하지 않는다. Reconciliation 결과에서 derived status로 표현한다.

Minimum reference statuses:

- `valid`: target scope가 일치하고, current candidate에 exact `candidateKey`가 존재하며, review-critical snapshot field가 일치함
- `missingCandidate`: current candidate set에서 exact `candidateKey`를 찾을 수 없음
- `evidenceChanged`: exact key는 존재하지만 current classification 또는 snapshot field가 달라짐

Review-critical comparison fields는 `classification`, `confidence`, `pageContext`, `observedUrl`, `selector`, `text`, `role`, `type`, `tagName`, `ariaAttributes`와 존재하는 `interactionKind`, `actionKind`, `riskLevel`이다.

Schema `3.0`에서는 `tabRestore` 전체가 additional review-critical evidence다. Stable `changedFields` ordering은 existing top-level order 뒤에 다음 bounded path 순서를 사용한다.

```text
tabRestore.strategy
tabRestore.tabGroupSelector
tabRestore.target.candidateKey
tabRestore.target.selector
tabRestore.target.observedUrl
tabRestore.target.pageContext
tabRestore.target.role
tabRestore.target.tagName
tabRestore.target.text
tabRestore.target.ariaAttributes.selected
```

Case rules:

- approval key가 current candidate set에 없으면 `missingCandidate`이며 실행 eligibility가 없다.
- selector/page context 변화로 새 key가 생성되면 old approval은 `missingCandidate`다.
- heuristic similarity로 replacement candidate를 제안할 수는 있지만 old decision을 새 key로 자동 이전하지 않는다.
- exact key가 같아도 classification, kind, risk 또는 review-critical evidence가 달라지면 `evidenceChanged`이며 재검토 전에는 eligibility가 없다.
- exact key가 같아도 current `observedUrl`이 approval snapshot과 다르면 `changedFields`에 `observedUrl`을 기록하고 `evidenceChanged`로 처리한다. CandidateKey algorithm에는 URL을 추가하지 않는다.
- exact interaction target key가 존재하지만 nested restore candidate가 없어지거나, restore evidence/group/selected uniqueness가 달라지면 `evidenceChanged`이며 eligibility가 없다. `missingCandidate`는 primary interaction target key 자체가 current set에 없을 때만 사용한다.
- restore peer selector가 바뀌어 peer candidateKey도 바뀌면 `tabRestore.target.candidateKey`, `tabRestore.target.selector`를 stable order로 기록한다.
- restore peer text/state/group selector/URL/context 변화도 해당 bounded path를 기록하고 재검토 전에는 eligibility를 주지 않는다.
- group 안의 selected=true peer가 0개 또는 2개 이상이면 current `tabRestore` contract가 성립하지 않으므로 `evidenceChanged`다.
- restore peer가 current safe tab classification을 잃으면 `evidenceChanged`이고 eligibility가 없다. Past bounded approval은 current safety assessment를 override하지 않는다.
- stale entry의 원래 human decision은 audit 의미로 보존한다. Re-review가 완료될 때만 current key/snapshot/review metadata로 명시적으로 갱신한다.

## Reconciliation Implementation

```text
current classified candidates / review report
  + interaction approval artifact
  -> approval reconciliation / validation
  -> valid approved candidates
  -> stale approval references
  -> held/rejected candidates
  -> unreviewed candidates
  -> classification-ineligible candidates
  -> future structured interaction plan builder
```

`tools/ai-generator/reconcile_interaction_approvals.py`는 Analysis Review Report JSON을 current candidate source of truth로 사용한다. Report는 target scope와 classifier의 safe/unsafe/interaction-unknown section을 함께 보존하고, reconciliation이 별도 candidate extraction/classification rule을 만들지 않게 한다.

Reconciliation 단계는 다음을 확인한다.

- supported `schemaVersion`
- artifact `target.url`과 current analysis target 일치
- duplicate approval entry 부재
- exact `candidateKey` match
- evidence snapshot comparison
- current candidate classification
- human decision

Approval artifact validation 또는 current report validation이 실패하면 partial result를 만들지 않는다. Approval `target.url`과 report `summary.targetUrl`이 exact match하지 않아도 non-zero로 종료한다.

Schema `3.0` reconciliation eligibility는 다음 조건을 모두 만족해야 한다.

```text
current classification == safe
AND human decision == approved
AND reference status == valid
AND target/schema/duplicate validation passed
AND template-specific execution readiness is valid
```

과거에 `approved`였더라도 current classification이 `unsafe` 또는 `unknown`이면 eligibility가 없다. Past approval은 current safety assessment를 override하지 않는다. `held`, `rejected`, stale, unreviewed candidate도 plan input에서 제외한다.

Result는 `tools/ai-generator/generated/interaction_approval_reconciliation.json`에 생성한다. Approval entry와 current candidate는 `candidateKey` 오름차순으로 정렬하며 생성 시각을 포함하지 않는다. `referenceStatus`는 `valid`, `missingCandidate`, `evidenceChanged`를 사용하고, `changedFields`는 이 문서의 review-critical field 순서를 따른다. 상세 result schema는 [JSON_SCHEMA.md](JSON_SCHEMA.md)를 따른다.

기본 실행:

```text
npm run ai:reconcile-interaction-approvals
```

## Boundary To Structured Interaction Plan

Approval reconciliation이 implemented plan builder에 제공하는 것은 eligible candidate reference와 human decision에서 파생된 eligibility뿐이다. Exact current execution evidence는 Analysis Review Report에서 가져온다.

Future structured interaction plan이 소유할 정보:

- approved candidate reference
- interaction template
- deterministic interaction steps
- expected visible/state assertion
- reversible-state assertion
- approved pair에서 exact copy한 page UI restore target과 bounded state
- execution validation 및 failure evidence contract

Approval artifact에는 Playwright step, click sequence나 assertion code를 추가하지 않는다. `tabRestore.target.selector`는 실행 script가 아니라 실제 restore click을 사람이 검토하고 stale comparison하기 위한 immutable evidence다. Structured Interaction Plan schema `3.0`의 per-test restore instruction은 [STRUCTURED_INTERACTION_PLAN.md](STRUCTURED_INTERACTION_PLAN.md)가 소유한다. Current renderer는 validated schema `3.0` pair만 소비한다.

## MVP Non-Goals

- approval CLI 또는 editor/UI
- approval artifact writer
- expandedToggle/cross-site browser runtime validation
- reviewer authentication 또는 account management
- heuristic approval migration
- workspace history management

## Contract Quality Checklist

- `safe`와 `approved`는 다른 계층의 상태다.
- `candidateKey`는 permanent identity가 아니다.
- stale approval은 새 candidate로 자동 승계되지 않는다.
- classification, human decision, reconciliation status를 하나의 enum으로 합치지 않는다.
- evidence snapshot은 classifier output 전체 복사본이 아니다.
- approval artifact는 executable interaction detail을 소유하지 않는다.
- current `safe`, human `approved`, valid non-stale reference가 모두 eligibility에 필요하다.
- Tab restore pair approval/validation/reconciliation과 Plan schema `3.0` renderer는 구현됐고 previous-selection runtime은 2회 PASS했다. 이는 approval writer/editor나 expandedToggle runtime 완료를 의미하지 않는다.
