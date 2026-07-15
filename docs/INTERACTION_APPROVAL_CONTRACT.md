# Interaction Approval Contract

## Purpose

이 문서는 classified interaction candidate와 future Level 3 structured interaction plan 사이의 human approval boundary를 정의한다.

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
- **eligible candidate**: current `safe` classification, human `approved` decision, valid non-stale reconciliation을 모두 만족한 future plan 입력 후보다.

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

Top-level `schemaVersion`은 필수이며 MVP 값은 `1.0`이다. 형식은 `major.minor`를 사용한다.

- major 변경: field 제거/이름 변경, required field 추가, 기존 field 의미 변경, decision 또는 classification enum 변경·확장
- minor 변경: 기존 의미를 바꾸지 않는 optional field 추가
- 문구 정정이나 example 수정처럼 JSON contract를 바꾸지 않는 변경: version 유지

MVP에서는 migration framework를 만들지 않는다. Validator/reconciler는 자신이 지원하지 않는 version을 명시적으로 거부한다. Strict enum을 사용하므로 enum expansion도 major 변경으로 취급한다.

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

## Minimal JSON Contract

```json
{
  "schemaVersion": "1.0",
  "target": {
    "url": "https://sample.local/"
  },
  "approvals": [
    {
      "candidateKey": "interaction:selector:0123456789abcdef01234567",
      "decision": "approved",
      "evidenceSnapshot": {
        "classification": "safe",
        "confidence": "high",
        "pageContext": "Overview",
        "selector": "main [role='tab']:nth-of-type(1)",
        "text": "Overview",
        "role": "tab",
        "type": "",
        "tagName": "li",
        "ariaAttributes": {
          "selected": "false"
        },
        "interactionKind": "tab"
      },
      "review": {
        "reviewer": "local-qa",
        "reviewedAt": "2026-07-15T09:30:00+09:00",
        "note": "Read-only tab transition reviewed."
      }
    }
  ]
}
```

## Validation Implementation

`tools/ai-generator/validate_interaction_approvals.py`는 다음 invariant를 strict하게 검증한다.

- top-level required fields: `schemaVersion`, `target`, `approvals`
- `target.url`: required non-empty absolute HTTP(S) URL
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

Unknown field와 unsupported enum을 조용히 무시하지 않는다. Optional field 확장이 필요하면 schema version을 먼저 변경한다.

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

Review-critical comparison fields는 `classification`, `confidence`, `pageContext`, `selector`, `text`, `role`, `type`, `tagName`, `ariaAttributes`와 존재하는 `interactionKind`, `actionKind`, `riskLevel`이다.

Case rules:

- approval key가 current candidate set에 없으면 `missingCandidate`이며 실행 eligibility가 없다.
- selector/page context 변화로 새 key가 생성되면 old approval은 `missingCandidate`다.
- heuristic similarity로 replacement candidate를 제안할 수는 있지만 old decision을 새 key로 자동 이전하지 않는다.
- exact key가 같아도 classification, kind, risk 또는 review-critical evidence가 달라지면 `evidenceChanged`이며 재검토 전에는 eligibility가 없다.
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

Future interaction plan eligibility는 다음 조건을 모두 만족해야 한다.

```text
current classification == safe
AND human decision == approved
AND reference status == valid
AND target/schema/duplicate validation passed
```

과거에 `approved`였더라도 current classification이 `unsafe` 또는 `unknown`이면 eligibility가 없다. Past approval은 current safety assessment를 override하지 않는다. `held`, `rejected`, stale, unreviewed candidate도 plan input에서 제외한다.

Result는 `tools/ai-generator/generated/interaction_approval_reconciliation.json`에 생성한다. Approval entry와 current candidate는 `candidateKey` 오름차순으로 정렬하며 생성 시각을 포함하지 않는다. `referenceStatus`는 `valid`, `missingCandidate`, `evidenceChanged`를 사용하고, `changedFields`는 이 문서의 review-critical field 순서를 따른다. 상세 result schema는 [JSON_SCHEMA.md](JSON_SCHEMA.md)를 따른다.

기본 실행:

```text
npm run ai:reconcile-interaction-approvals
```

## Boundary To Structured Interaction Plan

Approval artifact가 future plan builder에 제공하는 것은 eligible candidate reference와 human decision 근거뿐이다.

Future structured interaction plan이 소유할 정보:

- approved candidate reference
- interaction template
- deterministic interaction steps
- expected visible/state assertion
- reversible-state assertion
- page UI reset/restore behavior
- execution validation 및 failure evidence contract

Approval artifact에는 Playwright step, click sequence, assertion locator, reset selector를 추가하지 않는다. Structured Interaction Plan schema `1.0` documentation contract는 [STRUCTURED_INTERACTION_PLAN.md](STRUCTURED_INTERACTION_PLAN.md)가 소유한다. Builder, validator, renderer와 browser execution은 아직 구현되지 않았다.

## MVP Non-Goals

- approval CLI 또는 editor/UI
- approval artifact writer
- structured interaction plan builder
- Level 3 renderer
- browser interaction execution
- reset/restore execution implementation
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
- Level 3 execution은 아직 구현되지 않았다.
