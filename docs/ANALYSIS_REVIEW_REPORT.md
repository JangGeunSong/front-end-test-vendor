# Analysis Review Report

## Purpose

Analysis Review Report는 generated test, 제외된 후보, unresolved 후보, safe/unsafe interaction 후보를 사람이 검수할 수 있게 만드는 review artifact 설계 문서다.

현재 Level 1/2 navigation/page identity 테스트는 안정화되었지만, 결과가 CLI 로그와 JSON 중심이라 사용자가 검수하기 어렵다. 사용자는 다음 질문에 대한 답을 한눈에 보고 싶어 한다.

- 무엇이 테스트로 생성되었는가?
- 무엇이 제외되었는가?
- 왜 제외되었는가?
- 어떤 후보를 사람이 검토해야 하는가?
- 어떤 항목이 다음 테스트 확장 후보인가?

이 문서는 추후 Markdown/JSON report, 나아가 웹 기반 검수 UI의 기준이 된다.

## Proposed Outputs

초기 산출물:

- `tools/ai-generator/generated/analysis_review_report.json`
- `tools/ai-generator/generated/analysis_review_report.md`

이 파일들은 실행 산출물이므로 generated artifact로 취급한다. 기본적으로 git commit 대상이 아니다.

## Report Sections

### Summary

전체 분석 결과를 요약한다.

예상 필드:

- `targetUrl`
- `generatedTestCount`
- `primaryNavigationCount`
- `pageProfileCount`
- `excludedCandidateCount`
- `safeInteractionCandidateCount`
- `unsafeActionCandidateCount`
- `unresolvedCandidateCount`
- `recommendedActionCount`

### Generated Navigation Tests

Level 1/2 generated test 대상이 된 primary navigation 항목을 보여준다.

예상 필드:

- `menuPath`
- `template`
- `href`
- `depth1Index`
- `openTriggerCssPath`
- `hoverTargetCssPath`
- `confidence`
- `evidence`
- `suggestedAction`

### Page Identity Assertions

각 generated test가 어떤 page identity 근거를 사용했는지 보여준다.

예상 필드:

- `menuPath`
- `identityType`
- `text`
- `selector`
- `sourceMenuPath`
- `confidence`
- `reason`
- `evidence`
- `suggestedAction`

### Excluded Utility Controls

primary navigation에서 제외된 utility/control 후보를 보여준다.

예상 필드:

- `text`
- `candidateKind`
- `navigationRole`
- `semanticRegion`
- `reason`
- `confidence`
- `signals`
- `suggestedAction`

예상 후보:

- open/close control
- search
- theme toggle
- language switch
- social/community link
- brand/logo home
- footer utility link

### Non-primary Navigation Candidates

Level 1/2 generated spec 대상은 아니지만 추후 link check, Level 3, 또는 manual review에 유용한 후보를 보여준다.

예상 필드:

- `text`
- `href`
- `candidateKind`
- `semanticRegion`
- `reason`
- `confidence`
- `evidence`
- `suggestedAction`

### Safe Interaction Candidates

데이터 변경 없이 실행 가능할 수 있는 interaction 후보를 보여준다.

예상 필드:

- `text`
- `interactionKind`
- `selector`
- `role`
- `type`
- `semanticRegion`
- `pageContext`
- `confidence`
- `evidence`
- `suggestedAction`

예상 후보:

- tab
- accordion
- dropdown open
- modal open/close
- expand/collapse
- carousel next/prev
- tooltip/popover

### Unsafe Action Candidates

자동 실행하면 데이터 변경이나 외부 부작용이 발생할 수 있는 후보를 보여준다.

예상 필드:

- `text`
- `actionKind`
- `selector`
- `role`
- `type`
- `formAssociation`
- `surroundingText`
- `reason`
- `riskLevel`
- `evidence`
- `suggestedAction`

예상 후보:

- save
- submit
- create/register
- update/edit
- delete
- payment
- login/signup
- upload
- approval
- send
- personal information entry

### Unresolved Candidates

분류 근거가 부족하거나 primary/non-primary/safe/unsafe를 확정하기 어려운 후보를 보여준다.

예상 필드:

- `text`
- `candidateKind`
- `semanticRegion`
- `reason`
- `confidence`
- `evidence`
- `suggestedAction`

### Recommended Next Actions

사람이 다음에 할 일을 정리한다.

예상 항목:

- generated test visual debug 확인
- weak page identity 후보 검수
- excluded utility 후보가 실제 primary menu인지 확인
- safe interaction 후보 승인/보류
- unsafe action 후보 수동 테스트 케이스 작성 여부 검토
- unresolved 후보 classification rule 보강

## Evidence-Based Review Principle

Analysis Review Report는 단순 pass/fail report가 아니다.

핵심 원칙:

- 어떤 후보가 선택되었는지뿐 아니라 왜 선택되었는지를 남긴다.
- 어떤 후보가 제외되었는지뿐 아니라 어떤 signal 때문에 제외되었는지를 남긴다.
- confidence와 evidence를 함께 제공한다.
- 사용자가 승인, 보류, reject, rule 보강 같은 행동을 할 수 있는 구조여야 한다.

즉, report는 자동화 결과를 사람이 신뢰할 수 있게 만드는 중간 산출물이다.

## MVP Scope

초기 MVP:

- Markdown report 생성
- JSON report 생성
- generated navigation tests 요약
- page identity assertion 요약
- excluded/non-primary/unresolved 후보 요약
- safe/unsafe interaction 후보 분류 결과 표시

MVP에서 하지 않는 것:

- 웹 UI 구현
- 사용자의 승인 결과 저장
- 다음 generation에 review result 반영
- 실제 Level 3 interaction test 실행

## Future Extensions

후속 확장 후보:

- review result 저장
- approved/rejected classification memory
- workspace/project 단위 report history
- 검수 UI
- report 기반 rule tuning
- regression 승격 후보 추천
- safe interaction approval flow
