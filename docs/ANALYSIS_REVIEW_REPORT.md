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

현재 구현 상태:

- JSON report builder 구현 완료
- JSON report를 입력으로 사용하는 deterministic Markdown renderer 구현 완료
- deterministic safe/unsafe/unknown interaction candidate classifier 연결 완료
- Markdown report는 warning과 recommended action을 상단에 배치하고, 긴 selector/evidence는 접을 수 있는 상세 영역으로 분리한다.
- 빈 후보 section은 숨기지 않고 `No candidates.`로 표시한다.
- JSON/Markdown report 모두 생성 시각을 포함하지 않아 동일 입력에서 동일한 결과를 생성한다.

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

- `candidateKey`
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

- `candidateKey`
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

- `candidateKey` (interaction 후보인 경우)
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

Report는 approval decision을 소유하지 않는다. Human decision은 report의 `candidateKey`와 최소 evidence를 검토한 뒤 별도 approval artifact에 기록하며, 계약은 [INTERACTION_APPROVAL_CONTRACT.md](INTERACTION_APPROVAL_CONTRACT.md)를 따른다.

## MVP Scope

초기 MVP 구현 완료:

- Markdown report 생성
- JSON report 생성
- generated navigation tests 요약
- page identity assertion 요약
- excluded/non-primary/unresolved 후보 요약
- safe/unsafe interaction 후보 분류 결과 표시

현재 artifact에서 구조 근거가 확인된 후보만 safe/unsafe로 분류한다. 근거가 부족한 action 후보는 `candidateSubtype: interaction`인 unresolved 후보로 표시하고 자동 실행 대상으로 취급하지 않는다. 해당 분류가 0건인 section도 Markdown에서 숨기지 않는다.

safe, unsafe, interaction unknown candidate의 `candidateKey`는 classifier output에서 JSON report로 그대로 보존되며 Markdown의 Candidate Details에서 확인할 수 있다. 이 key는 future approval 및 structured interaction plan reference를 위한 identity이고 승인 상태를 의미하지 않는다. 동일 normalized artifact에서는 deterministic하지만 selector나 page context가 바뀌면 변경될 수 있다.

MVP에서 하지 않는 것:

- 웹 UI 구현
- 사용자의 승인 결과 저장
- 다음 generation에 review result 반영
- 실제 Level 3 interaction test 실행

## Future Extensions

후속 확장 후보:

- approval artifact writer/editor와 reconciliation 구현
- approved/rejected human decision history
- workspace/project 단위 report history
- 검수 UI
- report 기반 rule tuning
- regression 승격 후보 추천
- approval contract 기반 structured interaction plan 연결
