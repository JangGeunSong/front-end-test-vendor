# Data Flow

## Purpose

이 문서는 대상 URL에서 UI 구조를 수집하고, AI generated spec을 생성한 뒤, validator와 Playwright 실행으로 이어지는 현재 데이터 흐름을 설명한다.

## Current Flow

```text
target URL
  -> tools/ai-generator/agent_orchestrator.py
  -> tools/ai-generator/scout.js
  -> tools/ai-generator/generated/scout_result.json
  -> primary navigation projection / pageProfile collection
  -> tools/ai-generator/generated/menu_map.json
  -> LLM structured test plan JSON
  -> tools/ai-generator/validate_test_plan.py
  -> tools/ai-generator/render_test_plan.py
  -> tests/generated/generated_from_plan.spec.js
  -> npm run test:generated
  -> npm run test:generated:visual
  -> smoke/regression promotion review
```

기존 direct generated spec 경로도 유지되지만, 현재 제품 방향은 structured test plan JSON과 deterministic renderer를 중심으로 한다. LLM은 Playwright JavaScript를 직접 작성하지 않고, validator가 검증할 수 있는 test plan field를 채운다.

Analysis Review Report 경로는 기존 artifact만 재사용한다.

```text
scout_result.json + menu_map.json + test_plan.llm.json
  -> classify_interaction_candidates.py
  -> build_analysis_review_report.py
  -> analysis_review_report.json
  -> render_analysis_review_report.py
  -> analysis_review_report.md
  -> human review
```

classifier는 browser interaction을 실행하지 않는다. selector, role/type, ARIA state, form association, page context 같은 기존 evidence로 safe/unsafe/unknown 후보를 분류하며, unknown은 자동 실행 대상이 아니다.

각 classified interaction candidate에는 deduplication과 동일한 canonical identity에서 만든 deterministic `candidateKey`와 실제 DOM 관찰 위치인 `observedUrl`이 포함된다. Root 후보는 scout final `window.location.href`, pageProfile 후보는 click 후 `page.url()`을 사용한다. Report JSON/Markdown은 두 값을 보존하며 target root, pageContext, menuPath 또는 href에서 URL을 추론하지 않는다. URL은 candidateKey digest에 포함하지 않으며 URL만 바뀌면 reconciliation evidence가 stale해진다.

Human approval 이후의 validation/reconciliation boundary가 구현되어 있다.

```text
current classified candidates / analysis_review_report.json
  + tools/ai-generator/review/interaction_approvals.json
  -> validate_interaction_approvals.py
  -> reconcile_interaction_approvals.py
  -> generated/interaction_approval_reconciliation.json
  -> eligibleCandidates
  -> build_interaction_plan.py
  -> generated/interaction_plan.generated.json (`tests[].startUrl = observedUrl`)
  -> validate_interaction_plan.py
  -> validated structured interaction plan
  -> render_interaction_plan.py
  -> tests/generated/generated_interaction_plan.spec.js
  -> JavaScript syntax / Playwright test discovery
  -> browser runtime validation (tab restore contract gap identified)
  -> future repeatable execution / execution report
```

Approval artifact는 human decision, candidate reference, immutable evidence snapshot, review metadata만 소유한다. Reconciliation은 Analysis Review Report를 current candidate source로 사용하고 exact `candidateKey`, target scope, snapshot, current classification을 대조한다. Current `safe`와 human `approved`와 valid non-stale reference를 모두 만족한 candidate만 future plan 입력 eligibility를 갖는다.

Structured Interaction Plan은 exact eligible `candidateKey`, current `observedUrl`에서 복사한 per-test `startUrl`, eligible payload에서 복사한 target snapshot, bounded initial/expected state와 required UI reset/restore instruction만 소유한다. Schema `2.0` builder와 validator는 target scope, start URL same-origin과 report/eligible exact equality를 검증한다. Renderer는 plan만 읽어 exact URL/selector와 두 fixed transition을 byte-stable spec으로 생성하며 classification/approval/evidence를 재계산하지 않는다. JavaScript syntax와 test discovery는 검증됐다. 첫 tab browser run은 navigation과 false → true transition을 통과했지만 reload 후 selected state가 지속돼 restore contract gap을 확인했다. Approval 경계는 [INTERACTION_APPROVAL_CONTRACT.md](INTERACTION_APPROVAL_CONTRACT.md), plan 상세 계약은 [STRUCTURED_INTERACTION_PLAN.md](STRUCTURED_INTERACTION_PLAN.md)를 따른다.

Future tab restore flow는 다음 contract로 확정됐다. Source는 아직 구현되지 않았다.

```text
pageProfile tab evidence
  + closest explicit role=tablist selector
  + exactly-one selected peer
  -> Analysis Review Report 2.1 optional tabRestore
  -> human-reviewed interaction target + restore target pair
  -> approval/reconciliation 3.0 exact stale comparison
  -> eligible pair
  -> Structured Interaction Plan 3.0 restorePreviousSelection
  -> deterministic two-selector renderer
  -> browser runtime revalidation
```

`tabGroupSelector`는 별도 business ID가 아니라 exact explicit tablist selector다. Interaction target과 restore target은 exact `observedUrl`, `pageContext`와 group evidence를 공유해야 한다. Missing/ambiguous group evidence는 safety classification을 바꾸지 않지만 approval/plan eligibility를 막는다. Reconciliation은 primary target 부재만 `missingCandidate`로, primary target이 존재한 채 restore evidence가 바뀐 경우는 `evidenceChanged`로 처리한다.

Builder와 validator는 artifact pair를 exact copy/검증할 뿐 DOM을 다시 방문하지 않는다. Renderer는 selected tab 검색, first/sibling/text/index 추론, reload fallback, storage/hash 초기화 또는 selector healing을 수행하지 않는다. ExpandedToggle의 existing `toggleSameTarget` reset 흐름은 변경하지 않는다.

Approval artifact validation, current candidate input validation 또는 exact target scope match가 실패하면 partial reconciliation result를 만들지 않는다. `missingCandidate`는 similarity search 없이 exact key 부재로 판정하고, exact key가 있어도 review-critical evidence가 달라지면 `evidenceChanged`로 판정한다. Reconciliation result는 생성 시각을 포함하지 않고 candidate key 순서로 deterministic하게 생성한다.

## Step Details

### 1. Target URL

테스트 생성의 시작점은 대상 URL이다. 문서와 도구는 특정 도메인 전용이 아니라 임의의 WEB 사이트 URL을 기준으로 동작하도록 정리한다.

### 2. scout.js

`scout.js`는 Playwright/Node.js 기반으로 대상 UI를 탐색한다.

수집 대상:

- navigation/GNB 후보
- menu depth 정보
- navigation region/group과 DOM hierarchy 기반 depth1Index 추론 정보
- semanticRegion, navigationGroupIndex, inferredMenuDepth, confidence, discoveryReason
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

scout는 후보를 넓게 수집한다. header primary navigation뿐 아니라 main CTA, quick link, footer link, unknown region link도 구조화된 후보로 남긴다. 이 후보들은 Level 1/2 generated spec에 모두 들어가지 않고, `menu_map.json`에서 생성 목적별 projection으로 분리한다.

### 4. menu_map.json

`menu_map.json`은 generated spec 생성을 위한 정제 데이터이다.

주요 필드:

- `url`
- `menus`
- `menuTree`
- `pageProfiles`

`menuTree`는 Level 1 navigation test coverage의 기준이 된다. `pageProfiles`는 Level 2 Page Identity assertion 후보의 근거가 된다.

`depth1Index`는 특정 메뉴명 또는 특정 selector mapping이 아니라 scout가 DOM hierarchy를 기반으로 best-effort 추론한 실제 top-level hover/open 대상 index이다. `navigationGroupIndex`는 수집 그룹 식별자이며 `openDepth1ByIndex` 인자로 사용하지 않는다. 추론할 수 없으면 null로 남기고 generated spec은 보수적인 TODO를 남긴다.

scout는 가능한 경우 `hoverTargetCssPath`와 `openTriggerCssPath`도 함께 남긴다. structured plan과 renderer는 이 값을 click/open option으로 보존하고, `utils/gnb.js`는 fixed depth1 selector보다 수집된 trigger path를 우선 사용한다. trigger path가 없을 때만 `depth1Index` 기반 fallback을 사용한다.

`menu_map.json`은 다음 projection을 함께 가진다.

- `menus`: scout가 수집한 전체 navigation/action 후보
- `primaryMenuTree`: Level 1/2 generated spec 입력으로 쓰는 primary navigation tree
- `menuTree`: validator 호환을 위해 `primaryMenuTree`와 동일하게 유지
- `linkCandidates`: main/footer/unknown region link 후보
- `ctaCandidates`: main content CTA/button 후보
- `footerLinks`: footer region link 후보
- `nonPrimaryNavigationCandidates`: primary navigation 생성에서 제외된 후보
- `unresolvedPrimaryNavigationCandidates`: header/navigation 후보처럼 보이지만 parent-child 관계를 안전하게 추론하지 못해 tree에 넣지 않은 후보

`agent_orchestrator.py`는 각 후보에 `candidateKind`/`navigationRole`을 부여해 생성 목적별 projection을 만든다. `navigationTrigger`, `logoHome`, `footerLink`, `contentCta`, `quickLink`, `utilityLink`는 primary navigation parent가 될 수 없다.

Primary navigation projection은 overlay open/close control, search/language/dark-mode 같은 header utility control, relation/external utility link, mobile-only navigation duplicate를 Level 1/2 generated spec 대상에서 제외한다. PC/desktop navigation 후보가 함께 수집된 경우 mobile navigation 후보는 fallback 후보로만 보존하고 `primaryMenuTree`에서는 제외한다. PC navigation의 top-level button과 expanded panel child는 DOM 구조(`nav ... li:nth-of-type(N)`와 `mainMenu-N`)를 기반으로 연결하며, utility/close/open 후보 아래에는 child를 붙이지 않는다.

Docusaurus나 문서 사이트처럼 dropdown open trigger 없이 top-level nav link가 바로 이동 대상인 경우도 지원한다. `semanticRegion`이 header/nav이고, visible/high confidence이며, href와 text가 있는 direct nav link는 `depth1Index`가 null이어도 `primaryNavigationDirect` 후보로 승격할 수 있다. 단 brand home/logo, skip link, search, theme toggle, GitHub/Discord/social utility, footer/main/hero CTA/card link는 primary 대상에서 제외한다.

Dropdown navigation은 parent container와 child cssPath의 DOM 관계를 기반으로 parent-child를 추론한다. dropdown child에는 가능하면 parent dropdown cssPath를 `openTriggerCssPath`/`hoverTargetCssPath`로 보존해 renderer와 helper가 fixed selector가 아닌 수집된 open trigger를 사용할 수 있게 한다. menu 후보가 수집되었는데도 `primaryMenuTree`가 비어 있으면 `projectionDiagnostics`에 warning을 남겨 projection rule을 점검할 수 있게 한다.

Level 1/2 generated spec은 `primaryMenuTree`만 사용한다. main CTA, footer link, quick link는 추후 Level 3/link profile 확장 후보로 보존한다. parent-child 관계가 불확실한 후보는 generic menu trigger 아래에 몰아넣지 않고 `unresolvedPrimaryNavigationCandidates`로 남긴다.

Level 2 `pageProfiles`도 `primaryMenuTree` 기준으로 별도 수집한다. broad discovery에서 발견된 전체 후보를 그대로 클릭하지 않고, generated spec 대상인 parent/child menuPath와 일치하는 profile만 LLM 입력으로 전달한다.

반복 실행 시 `agent_orchestrator.py`는 `tools/ai-generator/generated/page_profile_cache.json`을 사용해 이미 수집된 pageProfile을 재사용할 수 있다. cache key는 target URL, menuPath, href, ngClick, cssPath를 기준으로 하며, cache miss인 메뉴만 scout.js pageProfile 수집 대상으로 전달한다. 최종 `menu_map.pageProfiles`는 cache hit profile과 이번 실행에서 새로 수집한 profile을 primaryMenuTree 순서로 병합한다.

### 5. agent_orchestrator.py

`agent_orchestrator.py`는 생성 파이프라인을 조율한다.

역할:

- scout 실행
- JSON 저장
- menu 후보 추출
- menuTree 구성
- pageProfiles 연결
- pageProfile cache 관리
- deterministic 또는 LLM structured plan generation orchestration
- plan validation과 deterministic renderer 호출

### 6. Structured Plan And Generated Spec

현재 structured 경로는 다음 artifact를 사용한다.

- deterministic plan: `tools/ai-generator/generated/test_plan.generated.json`
- LLM plan: `tools/ai-generator/generated/test_plan.llm.json`
- renderer output: `tests/generated/generated_from_plan.spec.js`

legacy `spec` mode의 `tests/generated/generated_menu_access.spec.js`도 유지되지만 기본 architecture 방향은 structured plan과 deterministic renderer다.

validator 통과 전에는 신뢰된 테스트로 보지 않는다. generated spec에 문제가 있으면 직접 수정하지 않고 생성 규칙을 보완한 뒤 다시 생성한다.

### 7. Validation And Quality Gates

structured plan은 renderer 전에 validation을 통과해야 한다.

- `npm run ai:validate-generated-plan`: deterministic plan schema 검증
- `npm run ai:validate-llm-plan`: LLM plan schema와 `primaryMenuTree` coverage 검증
- `npm run ai:compare-plans:gate`: deterministic/LLM plan의 meaningful difference gate
- `npm run ai:validate`: legacy direct generated spec 정적 검증

validator 또는 required quality gate가 실패하면 테스트 실행보다 원인이 있는 generation 계층 보완이 우선이다.

### 8. test:generated

`npm run test:generated`는 generated spec을 실제 Playwright로 실행한다.

실행 전 현재 generation mode에 대응하는 plan/spec validator 통과를 권장한다.

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
