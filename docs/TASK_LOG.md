# Task Log

## 2026-07-22 - Connect navigation and tab approval pipelines through a local MVP UI

### 구현

- Dependency-free localhost UI/API와 thin controller를 추가해 URL analysis, Page Navigation/Page Identity review, `tabSelection` explicit approval, reconciliation, Plan `3.0` validation, deterministic rendering, Playwright execution과 HTML report를 한 흐름으로 연결했다.
- Deterministic approval writer는 selected current Report `2.1` candidate만 exact snapshot으로 Approval `3.0`에 복사하고 기존 validator를 통과시킨다.
- Evidence, approval, reconciliation, plan, JSON result와 HTML report는 run ID별 generated directory에 분리한다. Generated specs는 기존 renderer relative import 계약을 유지하는 run-specific filename을 사용한다.
- Playwright 실행은 workers 1, retries 0, trace on이며 HTML/JSON reporter를 함께 사용한다.
- Fresh runtime에서 발견된 generic navigation producer 결함을 수정했다. Exact placeholder `href="#"`는 pageProfile observed navigation URL을 사용하고, collected `openTriggerCssPath`/`hoverTargetCssPath`를 deterministic click plan에 보존한다.

### 검증

- Python/Node syntax, approval writer 2 tests, controller 3 tests PASS.
- interaction classification/approval/reconciliation/plan builder/validator/renderer fixture regression 전체 PASS.
- Playwright.dev fresh run 1: navigation 8/8, Page Identity 8/8, approved tab 1/1, restoration 1/1, overall PASS.
- Playwright.dev fresh run 2: 별도 run ID/artifact로 동일 결과 PASS. HTML report endpoint 200 확인.
- 두 run 모두 workers 1, retries 0이며 arbitrary timeout 증가, selector fallback/healing, generated artifact hand edit 또는 site-specific hardcoding을 추가하지 않았다.

### 남은 경계

- `interaction.expandedToggle` actual runtime, broad cross-site interaction regression, persistent project/history storage, authentication/cloud/SaaS와 production-grade UI는 미구현이다.

## 2026-07-20 - Validate previous tab selection runtime

### 작업 목적

- `https://playwright.dev`에서 URL부터 fresh deterministic evidence chain을 생성한다.
- Report `2.1` → temporary Approval/Reconciliation `3.0` → Plan `3.0` → generated spec의 previous-selection restore를 실제 browser에서 검증한다.

### Fresh Evidence And First Runtime

- 일반 sandbox root navigation은 `ERR_NETWORK_ACCESS_DENIED`였고 승인된 network execution에서 root와 8개 pageProfile을 fresh 수집했다.
- Report는 interaction candidate 22건(safe 18, unsafe 0, unknown 4), safe tab 18건, unselected/restore-ready tab 12건, unique explicit tab group 6개를 제공했다.
- Exact fresh pair 한 건을 temporary Approval `3.0`으로 검증했고 reconciliation은 approval 1, valid reference 1, eligible 1이었다. Plan `3.0`과 generated spec은 test 한 건, reload/runtime peer search 0건으로 static validation을 통과했다.
- 최초 run은 navigation, target/restore initial resolution, false/true initial pair, target click과 target selected true까지 통과했다. Expected restore target false assertion은 locator 0건으로 실패했다.
- Screenshot, error context와 trace DOM snapshot은 selected peer가 DOM에서 사라진 것이 아니라 selector의 mutable `.tabs__item--active` class가 target click 후 제거됐음을 보여줬다.

### Generic Correction

- `scout.js collectTabs()`는 explicit tablist member selector를 group exact selector 아래 state-independent structural path로 생성한다.
- Interaction으로 변경되는 selected-state class를 target/restore selector에 포함하지 않는다. Group relation, exactly-one selected peer, approval pair와 renderer exact-copy contract는 변경하지 않았다.
- Classifier fixture의 safe tab pair를 같은 explicit-group structural selector shape로 갱신하고 deterministic candidateKey/preservation을 검증했다.
- Generated spec hand edit, selector fallback, runtime selected search, reload, sleep, timeout 증가 또는 retry를 추가하지 않았다.

### Result And Boundary

- URL부터 Report/Approval/Reconciliation/Plan/spec을 다시 생성하고 syntax와 Playwright discovery를 재검증했다.
- Chromium, workers 1, retries 0, trace on에서 동일 test를 두 번 실행했다. 두 실행 모두 navigation → initial false/true → target click → expected true/false → restore click → restored false/true를 PASS했다.
- 각 successful run은 HTML report와 trace를 생성했다. 최초 failure는 screenshot, video, error context와 trace를 보존했다.
- `interaction.tabSelection` previous-selection smoke는 runtime verified다. ExpandedToggle, cross-site interaction regression, approval writer/editor와 custom execution report schema는 완료하지 않았다.

## 2026-07-20 - Implement deterministic previous tab selection restore plans

### 작업 목적

- Report `2.1`과 Reconciliation `3.0`의 eligible target+restore pair를 Structured Interaction Plan `3.0`으로 exact 변환한다.
- TabSelection의 `reloadPage`를 제거하고 exact previous selected tab click과 paired restored state를 fixed renderer source로 생성한다.
- Browser body 실행 없이 neutral fixture, Node syntax와 Playwright static discovery까지 검증한다.

### 구현 결과

- `interaction_plan_contract.py`를 Plan/Reconciliation `3.0`, Report `2.1` hard boundary로 전환하고 old `2.0` silent compatibility를 두지 않았다.
- Builder input binding은 eligible/report `tabRestore`의 strategy, group selector, restore peer key/selector/URL/context/role/tag/text/state를 exact 비교하고 current selected peer도 report에서 exact 확인한다.
- Tab plan은 `target.tabGroupSelector`, paired initial/expected/restored state와 `restorePreviousSelection.target`의 exact candidateKey/selector만 소유한다. ExpandedToggle은 `reset.toggleSameTarget` semantics를 유지한다.
- Strict validator는 tab `reset`/`reloadPage`, missing/different selector, wrong pair state, wrong group/restore evidence, arbitrary field와 old schema를 거부한다.
- Renderer는 exact interaction/restore selector 두 개를 literal로 사용해 initial false/true, expected true/false, restored false/true를 assertion한다. Runtime selected search, DOM traversal, selector fallback과 reload는 생성하지 않는다.
- Builder JSON과 renderer output은 atomic replace하며 invalid renderer input에서 existing output preservation을 fixture로 확인했다.

### 검증

- Builder fixture: 3 tests(2 tab, 1 expanded), 1 bounded unsupported, 12 input consistency failures 통과.
- Validator fixture: valid 3 tests, empty plan, 18 strict failure scenarios 통과.
- Renderer fixture: valid 3 tests, 9 direct safety failures와 repeated byte equality 통과.
- Generated spec: target click 2, restore click 2, expanded click 2, selected assertion 12, `page.reload` 0, runtime selected search 0.
- Node syntax와 Playwright `--list` 3-test discovery를 통과했다. Browser test body는 실행하지 않았다.
- Existing ignored public Report는 `2.1`이지만 Reconciliation artifact는 stale `2.0`이고 restore pair가 없어 actual artifact chain smoke는 수행하지 않았다.

### 다음 작업

```text
network-accessible explicit-tablist candidate
  -> actual target/restore browser runtime
  -> paired restored-state PASS
```

## 2026-07-20 - Implement previous tab selection evidence and approval reconciliation

### 작업 목적

- Closest explicit tablist와 exactly-one selected peer evidence를 producer에서 bounded `tabRestore`로 수집한다.
- Analysis Review Report `2.1`, Interaction Approval `3.0`, Approval Reconciliation `3.0`까지 target/restore pair를 exact하게 전달하고 stale 처리한다.
- Structured Interaction Plan과 renderer는 schema `2.0`에 유지해 다음 implementation boundary를 분리한다.

### 구현 결과

- `scout.js`는 unselected exact `role=tab`에서 closest explicit `[role="tablist"]`를 찾고 group selector가 document에서 unique하며 visible selected peer가 정확히 하나일 때만 restore evidence를 만든다.
- Group/peer evidence가 없거나 모호하면 `missingTabGroupEvidence`, `missingPreviousSelection`, `ambiguousPreviousSelection`, `invalidRestoreTarget`을 기록한다. Parent, sibling, class, text, index 또는 DOM-wide selected tab fallback은 사용하지 않는다.
- Classifier는 target identity algorithm을 변경하지 않고 restore peer에 같은 algorithm의 `candidateKey`를 부여한다. 같은 canonical target의 restore evidence가 source 사이에서 다르면 fail-fast한다.
- Report `2.1` JSON/Markdown은 bounded pair와 restore-ready/unavailable count를 표시한다. Restore readiness는 safe classification과 분리된다.
- Approval `3.0` validator는 approved safe unselected tab에 human-reviewed `tabRestore` snapshot을 required로 하고 nested unknown field, URL/context/state/selector invariant를 strict하게 검증한다. Old `2.0`은 unsupported다.
- Reconciliation `3.0`은 current report의 restore snapshot과 selected peer를 exact 검증한다. Primary target 부재만 `missingCandidate`이며 restore peer/evidence 문제는 stable bounded path의 `evidenceChanged`다. Eligible tab payload는 exact `tabRestore`를 보존한다.
- Neutral fixtures는 valid pair, no group/no peer/ambiguous/invalid reason, restore conflict, stale group/peer, missing peer와 quote/backslash/Unicode selector/text preservation을 포함한다.

### 검증 및 제한

- Python compile, Node syntax, JSON parse, candidate/approval/reconciliation fixtures와 기존 Structured Interaction Plan `2.0` builder/validator/renderer fixtures를 통과했다.
- Existing ignored public artifact를 재분류한 결과 unselected tab 12개는 모두 `missingTabGroupEvidence`였고 ready pair는 0개였다. 이 결과는 fresh DOM observation이 아니다.
- Fresh public-site deterministic analysis는 sandbox outbound network 차단으로 `ERR_NETWORK_ACCESS_DENIED`에 실패했고 권한 상승 요청도 승인되지 않아 완료하지 못했다. 따라서 public DOM의 current tablist distribution이나 temporary approval success를 주장하지 않는다.
- Plan schema `3.0`, `restorePreviousSelection` renderer, browser runtime과 expandedToggle runtime은 구현하거나 실행하지 않았다.

### 다음 작업

```text
Structured Interaction Plan schema 3.0 builder/validator
  -> exact restorePreviousSelection renderer
  -> Playwright public-site runtime revalidation
```

## 2026-07-20 - Define previous tab selection restore contract

### 작업 목적

- First tab runtime에서 확인된 `reloadPage` restore failure를 evidence, approval, reconciliation, plan, validator와 renderer 책임으로 분해한다.
- Interaction 실행 전 같은 tab group에서 selected였던 exact peer를 human-reviewed structured evidence로 보존하는 future contract를 확정한다.

### 확인 결과

- Runtime은 exact navigation/locator, initial `aria-selected=false`, target click, expected `true`와 reload 후 locator re-resolution까지 통과했다.
- Page가 selection을 reload 사이에 유지해 restored false가 실패했으며 `reloadPage`는 reset action일 수 있어도 deterministic tab restore strategy가 아니다.
- Current scout/pageProfile/report는 individual tab의 selector, role, tagName, selected state와 observed URL을 보존하지만 explicit tablist ancestor selector나 deterministic same-group relation은 보존하지 않는다.
- Existing ignored public artifact에는 같은 URL의 여러 tab 묶음과 selected/unselected peers가 있지만 common selector prefix, parent/class/text/sibling을 durable group proof로 사용하지 않았다.

### Architecture Decision

- Tab group identity는 새 permanent key가 아니라 closest explicit `role=tablist` ancestor의 exact `tabGroupSelector`를 사용한다.
- Explicit tablist relation, target selected false, same-group selected true peer exactly one, distinct exact selectors와 same observed URL/context가 모두 있을 때만 `restorePreviousSelection`을 지원한다.
- Explicit group relation이 없는 tab-like UI는 MVP execution restore에서 제외한다. First tab, nearest sibling, DOM-wide selected tab, text/index/class 추론과 storage/hash 초기화는 금지한다.
- Previous selected peer는 target approval entry의 bounded `tabRestore` snapshot으로 보존한다. Peer의 existing `candidateKey`를 포함하지만 별도 approval decision entry를 만들지 않는다.
- Interaction target click과 restore target click은 하나의 human-reviewed execution pair다. Approval evidence 밖의 restore element를 renderer가 선택하지 않는다.
- Primary target key 부재는 existing `missingCandidate`다. Primary target은 존재하지만 restore peer/group/selected evidence가 바뀌거나 없어지면 existing `evidenceChanged`이며 eligibility가 없다.
- Safety classification과 restore readiness를 분리한다. Candidate가 `safe`여도 deterministic restore evidence가 없으면 approved executable tab plan이 될 수 없다.
- Analysis Review Report는 optional evidence addition이므로 future `2.1`, approval/reconciliation과 Structured Interaction Plan은 required shape/eligibility 변경이므로 future `3.0`으로 결정했다.
- Plan `3.0` tabSelection은 `reset.reloadPage`를 제거하고 exact restore selector의 `restorePreviousSelection`과 interaction/restore target의 paired initial, expected, restored state를 요구한다.
- ExpandedToggle의 existing `reset.toggleSameTarget` contract는 변경하지 않는다.

### Future Implementation Boundary

- Producer는 explicit group selector와 exactly-one selected peer evidence를 수집한다.
- Approval validator/reconciler는 bounded pair shape와 exact stale comparison을 구현한다.
- Builder/validator는 eligible/report evidence를 exact copy/검증하며 missing/ambiguous evidence에서는 fake plan을 만들지 않는다.
- Renderer는 validated selector 두 개만 click하고 selected peer search, selector healing이나 reload fallback을 하지 않는다.
- Current source, fixture와 renderer는 여전히 schema `2.0`/`reloadPage`다. Source implementation, schema validator 변경, browser re-run과 runtime PASS는 후속 task다.

### 다음 작업

```text
tab group + previous selected peer evidence
  -> approval/reconciliation implementation
  -> interaction plan restorePreviousSelection
  -> deterministic renderer
  -> Playwright public-site runtime revalidation
```

## 2026-07-16 - Validate first tab interaction runtime path

### 작업 목적

- 실제 generated interaction spec의 approved `yarn` tab 한 건을 Playwright로 실행한다.
- 기본 HTML report, trace, screenshot과 assertion evidence로 runtime failure stage와 root cause 계층을 확인한다.

### 실행 결과

- Schema `2.0` plan strict validation, renderer 반복 output byte equality, Node syntax와 1-test discovery를 다시 확인했다.
- Project venv Python 3.10.11, fnm Node 24.15.0, npm 11.12.1과 Playwright 1.59.1을 사용했다. Installed Chromium을 재사용하고 browser를 재설치하지 않았다.
- Generated spec의 `interaction:selector:f3e8ee3f82c5ccb372ab62e2` 한 건만 workers 1, retries 0, trace on으로 실행했다.
- Exact `https://playwright.dev/docs/intro` navigation, target resolution, initial `aria-selected=false`, click과 expected `aria-selected=true`는 성공했다.
- `page.reload()`과 동일 URL/selector 재해석은 성공했지만 target이 계속 `aria-selected=true`여서 restored false assertion이 실패했다.
- Console assertion, HTML report, trace action timeline, DOM snapshot, failure screenshot과 video가 동일 restore mismatch를 보여줬다.

### 판단

- Failure stage는 restore mismatch이며 environment, URL provenance, selector, click 또는 renderer dispatch 문제가 아니다.
- Page가 tab selection을 reload 사이에 보존하므로 schema `2.0`의 `reloadPage` reset strategy가 generic restore를 보장하지 못한다.
- Generated spec hand edit, selector fallback, storage clear, timeout/retry, assertion 완화로 우회하지 않았다.
- Correct fix는 previous selected tab의 exact evidence와 approval/reset target을 plan에 보존하는 breaking contract decision이 필요하므로 이번 runtime validation task에서는 source/schema를 변경하지 않았다.

### 다음 작업

- Previous selected tab reference의 producer, approval boundary, plan schema와 bounded `restorePreviousSelection` strategy를 설계한다.
- Contract 적용 후 동일 single tab test를 retries 0으로 두 번 통과시켜 runtime smoke를 완료한다.
- `expandedToggle` runtime과 custom execution result schema는 별도 후속 범위로 유지한다.

## 2026-07-16 - Render Structured Interaction Plans

### 작업 목적

- Validated Structured Interaction Plan schema `2.0`을 deterministic Playwright interaction spec으로 변환한다.
- 실제 browser interaction 전에 JavaScript syntax와 Playwright test discovery까지 정적으로 검증한다.

### 변경 내용

- `render_interaction_plan.py`를 추가해 plan 외 report, approval, reconciliation artifact를 다시 읽지 않는 renderer boundary를 구현했다.
- 각 test의 exact `startUrl`을 `page.goto()`에, exact selector를 `page.locator()`에 semantic change 없이 JSON string literal로 encoding한다.
- `interaction.tabSelection`은 selected false → click → true → reload → target re-resolution → false를, `interaction.expandedToggle`은 expanded false → click → true → same-target click → false를 고정 shape로 생성한다.
- Reload/toggle은 restore action이며 restored-state assertion이 성공 여부를 판정한다. Timeout, sleep, fallback selector와 free-form code는 생성하지 않는다.
- Renderer direct safety check는 schema `2.0`, required renderer field, duplicate/order, supported template와 bounded state/reset을 검사하고 전체 source 완성 후 atomic replace한다.
- Neutral renderer fixture와 `ai:render-interaction-plan` command를 추가했다. Output은 timestamp와 local path 없이 UTF-8 LF/trailing newline을 사용한다.

### 확인 결과

- Project `venv` Python 3.10.11에서 renderer syntax, neutral fixture의 두 template와 4개 direct failure scenario를 통과했다.
- Quote, backslash, newline과 Unicode selector를 exact literal로 보존하고 repeated render byte equality를 확인했다.
- Fixture generated spec은 Node syntax check와 Playwright `--list`에서 2 tests로 discovery됐다.
- Existing ignored schema `2.0` public-site plan은 strict validator 통과 후 npm wrapper로 1 tabSelection spec을 생성했고 syntax 및 1-test discovery를 통과했다.
- Interaction plan builder/validator, approval reconciliation과 navigation plan validator/renderer regression을 확인했다.
- 실제 Playwright test body, browser click, reload/toggle runtime transition, screenshot과 execution report는 실행하지 않았다.

### 다음 작업

- Generated interaction spec의 실제 browser transition과 reset/restore assertion을 최소 public-site target에서 검증한다.
- Runtime failure evidence/screenshot/execution report contract를 renderer와 분리해 정의한다.
- Approval writer/editor는 browser execution과 분리된 human review workflow로 유지한다.

## 2026-07-16 - Preserve interaction execution URL provenance

### 작업 목적

- Renderer 구현 전에 발견된 per-candidate execution URL 누락을 discovery/evidence 계층에서 해결한다.
- 분석 scope `target.url`, 실제 관찰 위치 `observedUrl`, plan 실행 시작점 `startUrl`의 책임을 분리한다.

### 변경 내용

- Root scout element에 final `window.location.href`, pageProfile candidate에 click 후 `page.url()`을 provenance source of truth로 사용했다.
- Projection과 classifier가 `observedUrl`을 보존하고 safe/unsafe/unknown 모든 candidate에 absolute credential-free HTTP(S), target same-origin을 요구하도록 했다.
- CandidateKey algorithm은 유지했다. 같은 canonical candidate source의 observed URL이 충돌하면 조용히 덮어쓰지 않고 input consistency error로 종료한다.
- Analysis Review Report JSON/Markdown에 candidate `observedUrl`을 추가했다.
- Interaction Approval schema를 `2.0`으로 올리고 immutable evidence snapshot에 required `observedUrl`을 추가했다. Approval validator는 invalid scheme, credentials와 cross-origin을 거부한다.
- Reconciliation result를 `2.0`으로 올리고 review-critical comparison과 eligible payload에 `observedUrl`을 추가했다. URL만 변경돼도 `evidenceChanged`이며 eligibility가 없다.
- Structured Interaction Plan을 `2.0`으로 올리고 required `tests[].startUrl`을 current observed URL의 exact copy로 정의했다. Builder/validator는 target root fallback이나 URL normalization 없이 eligible/report provenance exact equality를 검증한다.
- Shared `interaction_url.py`, neutral success/failure/version fixtures와 관련 architecture/schema 문서를 actual contract에 맞췄다.

### 확인 결과

- Project `venv` Python 3.10.11에서 변경 module syntax와 classifier, report, approval validator, reconciliation, plan builder/validator fixture를 통과했다.
- Missing/invalid/cross-origin observed URL, old schema version, URL-only stale change, missing/mismatched/query/hash/trailing-slash/cross-origin start URL과 source conflict를 검증했다.
- `https://playwright.dev`를 `npm run ai:generate-plan -- --url https://playwright.dev --clear-profile-cache`로 fresh 수집했다. Windows CP949 진단 실패는 source 변경 없이 UTF-8 console environment로 재실행해 해결했다.
- Fresh report의 interaction candidate는 22개, unique observed URL은 2개였다. `https://playwright.dev/` 4개, `https://playwright.dev/docs/intro` 18개이며 missing/invalid/cross-origin은 0개였다.
- Nested `/docs/intro`의 unselected `yarn` tab 1개를 local ignored temporary approval로 검증했다. Approval validation, reconciliation 1 eligible/21 unreviewed, plan build 1 tabSelection, plan validation을 통과했으며 smoke 후 temporary approval file은 제거했다.
- Candidate/report/approval/eligible/plan의 URL이 모두 `https://playwright.dev/docs/intro`로 exact 일치했고 report, reconciliation, plan 반복 생성은 byte-stable했다.
- Renderer, generated interaction spec, interaction click, reset/restore browser execution, screenshot, execution report와 external LLM API는 구현하거나 실행하지 않았다.

### 다음 작업

- Validated schema `2.0` plan의 exact per-test `startUrl`을 사용하는 deterministic Level 3 renderer를 구현하고 static generated spec validation을 수행한다.
- Browser interaction과 reset/restore runtime validation은 renderer 이후 별도 task로 유지한다.
- Approval writer/editor는 execution 계층과 분리된 human review workflow로 유지한다.

## 2026-07-16 - Build and validate Structured Interaction Plans

### 작업 목적

- Approval reconciliation의 `eligibleCandidates[]`와 Analysis Review Report의 exact current evidence를 validated Structured Interaction Plan JSON으로 변환한다.
- Level 3 renderer/browser execution 전 deterministic planning/validation boundary를 구현한다.

### 변경 내용

- `interaction_plan_contract.py`에 schema/version/path, supported template mapping, candidateKey 기반 deterministic test ID와 reconciliation/report input binding을 공통 계약으로 추가했다.
- `build_interaction_plan.py`를 추가했다.
  - exact `candidateKey` join만 사용하고 reconciliation eligibility를 재계산하지 않는다.
  - `tab`은 `interaction.tabSelection`, `accordion`/`expandCollapse`는 `interaction.expandedToggle`로만 mapping한다.
  - current ARIA state가 string `"false"`로 확인될 때만 bounded initial/expected/restored state와 fixed reset strategy를 생성한다.
  - unsupported candidate는 executable TODO로 만들지 않고 `unsupportedInteractionKind`, `missingStateEvidence`, `initialStateNotSupported`, `missingSelector` CLI summary로 분리한다.
  - missing exact report candidate, target mismatch와 eligible/report evidence mismatch는 input consistency failure로 처리해 partial plan을 생성하지 않는다.
- `validate_interaction_plan.py`를 추가했다.
  - strict unknown-field/schema/URL/source path/test shape와 duplicate ID/candidateKey를 검증한다.
  - 모든 plan candidate가 reconciliation eligible set에 있는지와 selector/interactionKind/pageContext exact copy를 검증한다.
  - 두 supported template의 compatibility, current ARIA evidence, bounded state/reset/restore와 deterministic ID/order를 exact하게 검증한다.
  - free-form executable field는 unknown field로 거부한다.
- Neutral builder/validator/malformed fixture와 `ai:build-interaction-plan`, `ai:validate-interaction-plan` npm command를 추가했다.
- Structured plan, current state, module/data flow, schema, approval/report/safe-interaction와 README를 actual builder/validator 구현 상태에 맞췄다.

### 확인 결과

- Project venv의 Python 3.12.10으로 새 module syntax와 builder/validator fixture를 통과했다.
- Builder fixture에서 3개 executable plan, 4개 bounded unsupported result, 4개 input consistency failure와 반복 build byte equality/JSON parse를 확인했다.
- Validator fixture에서 tab/expanded plan, empty plan과 18개 strict failure scenario를 확인했다.
- 기존 interaction classifier, approval validator, approval reconciliation fixture를 모두 통과했다.
- `.node-version`의 Node 24.15.0과 npm 11.12.1을 fnm으로 선택하고 두 fixture npm wrapper를 통과했다.
- Default npm command는 runtime generated reconciliation/report/plan이 없는 현재 workspace에서 expected missing-artifact error로 종료함을 확인했다.
- Malformed JSON과 missing input이 non-zero로 종료하고, Markdown H1/relative link, JSON example/fixture parse와 `git diff --check`를 확인했다.
- Scout/pageProfile 수집, Playwright/browser test와 external LLM API는 실행하지 않았다.

### 다음 작업

- Validated Structured Interaction Plan의 두 template만 해석하는 deterministic Level 3 renderer를 설계/구현한다.
- Initial/expected/reset/restored state의 browser validation과 execution failure evidence contract를 구현한다.
- Approval writer/editor는 browser execution과 분리된 human review workflow task로 유지한다.

## 2026-07-15 - Define Structured Interaction Plan contract

### 작업 목적

- Approval reconciliation의 eligible candidate와 future deterministic Level 3 execution 사이의 Structured Interaction Plan contract를 정의한다.
- Classification, human decision, reconciliation, planning, rendering 책임을 분리한 채 safe reversible page interaction만 bounded schema로 표현한다.

### 변경 내용

- `docs/STRUCTURED_INTERACTION_PLAN.md`를 추가해 schema `1.0`의 architecture position, ownership, future generated artifact path, top-level/test field와 strict validation invariant를 정의했다.
- Classifier `interactionKind`와 execution plan template을 다른 taxonomy로 분리했다.
- Exact reconciliation `eligibleCandidates[].candidateKey`를 primary reference로 사용하고 selector, interactionKind, pageContext는 eligible payload에서 exact copy하도록 했다.
- Current report의 exact ARIA state evidence가 있는 `interaction.tabSelection`과 `interaction.expandedToggle`만 MVP template으로 정의했다.
- Initial, expected, restored state를 template별 boolean object로 제한하고 free-form expression, JavaScript와 Playwright code field를 금지했다.
- 모든 MVP case에 deterministic reset/restore를 요구했다. Page-level UI reset/restore와 data mutation rollback을 구분했다.
- Future builder는 classification/reconciliation을 재수행하지 않고 unsupported evidence를 실행 TODO로 만들지 않으며, validator/renderer/execution report 책임도 별도 계층으로 정의했다.
- Current state, project overview, module/data flow, approval/safe interaction/schema/navigation plan 문서를 contract-defined/implementation-not-yet 상태와 동기화했다.

### 확인 결과

- Neutral example JSON parse와 candidateKey 형식을 확인했다.
- Example/template/reset enum이 schema `1.0` taxonomy와 일치하는지 확인했다.
- Actual classifier `interactionKind`와 reconciliation `eligibleCandidates` field를 contract와 대조했다.
- Navigation plan의 candidate/evidence → plan → validator → deterministic renderer 책임 분리를 유지하는지 확인했다.
- Markdown H1, relative link target, referenced path와 `git diff --check`를 확인했다.
- Source implementation, package script, generated artifact는 변경하지 않았고 scout, pageProfile, Playwright와 external LLM API는 실행하지 않았다.

### 다음 작업

- Deterministic interaction plan builder와 unsupported diagnostic artifact를 구현한다.
- Reconciliation/report input binding과 strict error contract를 가진 interaction plan validator를 구현한다.
- Approval writer/editor와 Level 3 renderer/reset execution은 각각 별도 task로 진행한다.

## 2026-07-15 - Validate and reconcile interaction approvals

### 작업 목적

- documentation contract로 확정된 Interaction Approval 경계를 executable validation/reconciliation layer로 연결한다.
- machine classification, human decision, reconciliation status를 분리한 채 valid approved candidate만 future interaction plan 입력 eligibility를 갖게 한다.

### 변경 내용

- `validate_interaction_approvals.py`를 추가했다.
  - approval schema `1.0`, absolute target URL, strict enum/unknown field, candidateKey format, evidence snapshot conditional field, reviewer metadata를 검증한다.
  - duplicate candidateKey와 approved/unsafe snapshot 조합을 거부하며 deterministic error code와 field path를 출력한다.
- `reconcile_interaction_approvals.py`를 추가했다.
  - Analysis Review Report의 classified interaction section을 current candidate source로 사용한다.
  - exact candidateKey와 review-critical evidence를 대조해 `valid`, `missingCandidate`, `evidenceChanged`를 계산한다.
  - current `safe` + human `approved` + valid reference만 eligible로 출력하고 current unsafe/unknown이 old approval로 override되지 않게 한다.
  - approval entry가 없는 current candidate는 human decision enum을 변경하지 않고 별도 unreviewed candidate set으로 출력한다.
- `interaction_approval_reconciliation.json` generated result schema와 deterministic ordering을 정의했다.
- neutral validator/reconciliation fixture와 npm validation/reconciliation command를 추가했다.
- `docs/DEVELOPMENT_ENVIRONMENT.md`와 `.node-version`을 추가해 fresh shell이 project `venv`, requirements-managed Python, fnm-managed Node, package lock, local `.env` policy를 repository documentation만으로 복원하게 했다.
- AGENTS startup/read map과 README quick start를 environment contract에 연결했다.
- current state, module/data flow, schema, approval/review/safe-interaction 문서를 실제 구현 상태와 동기화했다.

### 확인 결과

- Python syntax check와 validator/reconciliation fixture를 통과했다.
- unsupported version, missing target, invalid decision/key, duplicate key, approved unsafe snapshot, malformed/conditional evidence, unknown field를 검증했다.
- valid/missingCandidate/evidenceChanged, current unsafe/unknown 재평가, eligible/non-eligible, unreviewed와 반복 실행 byte stability를 확인했다.
- malformed JSON과 missing input이 non-zero로 종료하고 invalid approval에서 partial reconciliation을 만들지 않는 것을 확인했다.
- Project venv interpreter와 requirements import를 확인하고 fnm PowerShell environment를 활성화해 `.node-version`의 Node와 npm을 복원했다.
- npm wrapper default command가 Python entry point까지 호출된 뒤 missing local approval artifact로 exit 1을 반환하고, 두 fixture wrapper는 exit 0으로 통과하는 것을 확인했다.
- `.env`, `venv`, human-authored approval과 generated reconciliation output의 ignore policy를 확인했다.
- scout/pageProfile 재수집, Playwright browser test, 외부 LLM API는 실행하지 않았다.

### 다음 작업

- approval artifact writer/editor의 human re-review workflow를 별도 task로 정의한다.
- eligible candidate 기반 structured interaction plan 최소 field와 reversible state/rollback contract를 후속 task로 정의한다.
- Level 3 browser interaction은 위 계약과 validator 이후에 진행한다.

## 2026-07-15 - Define Interaction Approval artifact contract

### 작업 목적

- classified interaction candidate와 future Level 3 interaction execution 사이에 human approval boundary를 정의한다.
- `safe` machine classification과 사람의 approval decision을 분리하고, approved-only plan eligibility에 필요한 보수적 reconciliation 원칙을 확정한다.

### 변경 내용

- `docs/INTERACTION_APPROVAL_CONTRACT.md`를 추가했다.
  - human-authored local state 기본 경로를 `tools/ai-generator/review/interaction_approvals.json`, schema version을 `1.0`으로 정의했다.
  - decision enum을 `approved`, `held`, `rejected`로 제한하고 classification/reconciliation status와 분리했다.
  - `candidateKey` exact reference와 decision 당시의 최소 immutable evidence snapshot, reviewer metadata 계약을 정의했다.
  - missing key 또는 evidence change를 stale reconciliation 결과로 처리하고 heuristic similarity만으로 old approval을 새 candidate에 자동 승계하지 않도록 했다.
  - current `safe` + human `approved` + valid non-stale reference를 future interaction plan eligibility로 정의했다.
  - approval artifact의 human decision/evidence 책임과 future plan의 template/step/assertion/rollback 책임을 분리했다.
- approval local state가 generated output이나 source로 commit되지 않도록 `.gitignore`에 review JSON 경로를 추가했다.
- current-state, data-flow, module/schema/review/safe-interaction 문서를 새 contract와 일치시켰다.
- `AGENTS.md`와 project documentation map에 interaction approval 작업의 required contract 문서를 연결했다.

### 확인 결과

- Markdown H1/구조, 상대 링크와 참조 경로, inline JSON example parse를 확인했다.
- `candidateKey` format/canonical identity와 classifier/report evidence field가 source와 일치함을 재확인했다.
- `CURRENT_STATE.md`가 contract-defined/writer-not-implemented 상태와 다음 reconciliation/plan frontier를 구분하는지 확인했다.
- `git diff --check`를 통과했다.
- source feature, generated artifact, scout/pageProfile, Playwright, 외부 LLM API는 수정하거나 실행하지 않았다.

### 다음 작업

- approval artifact writer/validator와 current candidate reconciliation result schema를 별도 task로 설계·구현한다.
- valid approved candidate만 입력받는 structured interaction plan의 최소 field와 reversible-state contract를 후속 task로 정의한다.

## 2026-07-14 - Add durable current-state handoff documentation

### 작업 목적

- Codex local conversation이나 특정 session을 project memory로 사용하지 않고, 새 PC와 새 agent session이 repository documentation만으로 현재 위치를 복원하게 한다.
- stable project overview, current snapshot, historical task log의 책임을 분리해 startup reading cost를 줄인다.

### 변경 내용

- `docs/CURRENT_STATE.md`를 추가해 현재 pipeline, stable capability, architecture invariant, active interaction frontier, 최신 `candidateKey` 구현, open decision을 snapshot으로 정리했다.
- `AGENTS.md`의 기본 reading order에 `CURRENT_STATE.md`를 추가하고, `TASK_LOG.md`는 historical reasoning이 필요한 경우에만 읽도록 분리했다.
- 새 session이 pipeline, stable capability, frontier, latest work와 문서/source 불일치를 먼저 확인하는 `New Session Bootstrap` contract를 추가했다.
- `PROJECT_OVERVIEW.md`는 상대적으로 안정적인 제품/architecture overview로 책임을 좁히고 current milestone은 `CURRENT_STATE.md`로 위임했다.
- `MODULE_MAP.md`에 structured plan, compare gate, interaction classifier, Analysis Review Report 모듈의 현재 책임을 보완하고 `DATA_FLOW.md`의 orchestrator/open-trigger 흐름을 실제 구현과 맞췄다.
- repository에는 standalone `DECISIONS.md`와 `ROADMAP.md`가 없음을 확인하고 이번 작업에서 임의 생성하지 않았다.

### 확인 결과

- Markdown heading과 상대 링크, 참조 파일 존재 여부, source/git history 기반 capability와 최신 구현 설명을 확인했다.
- source code, generated artifact, package script, test는 수정하거나 실행하지 않았다.

### 다음 작업

- `candidateKey`를 참조하는 human approval artifact와 structured interaction plan의 계약을 다음 agent task로 정의한다.
- cross-cutting architecture decision log가 실제로 필요해지는 시점에 standalone decision 문서 도입 여부를 결정한다.

## 2026-07-14 - Add stable interaction candidate identity

### 작업 목적

- safe/unsafe/unknown classified candidate를 향후 human approval과 structured interaction plan에서 배열 index나 selector 원문에 의존하지 않고 참조할 수 있게 한다.
- 기존 deduplication과 candidate identity가 서로 다른 기준을 사용하지 않도록 하나의 deterministic 계약으로 정리한다.

### 변경 내용

- classifier의 selector-first dedup signal을 canonical identity로 정리하고 SHA-256 digest 기반 `candidateKey`를 모든 classified candidate에 추가했다.
- 동일 identity가 여러 source에서 수집되면 하나의 key로 dedup하고 `candidateSources`를 병합하도록 기존 동작과 identity 계약을 연결했다.
- fixture를 `fixtureId` 기반 상세 기대값으로 확장해 safe `interactionKind`, unsafe `actionKind`/`riskLevel`, key 존재·유일성·반복 실행 안정성, source 병합을 검증한다.
- Analysis Review Report JSON에서 key를 보존하고 Markdown Candidate Details에서 확인할 수 있게 했다.
- Safe Interaction, Analysis Review Report, JSON schema, data flow, project overview 문서에 stable identity의 용도와 한계를 반영했다.

### 확인 결과

- Python 문법, fixture 상세 검증, 기존 artifact 분류와 report JSON/Markdown 재생성을 확인했다.
- 동일 입력 반복 실행의 candidateKey sequence 및 report hash 일치와 generated artifact ignore 상태를 확인했다.
- scout/pageProfile 재수집, Playwright 실행, 외부 LLM API 호출은 수행하지 않았다.

### 다음 작업

- 사람의 승인 결과가 `candidateKey`를 참조하는 structured interaction plan 계약을 별도 작업으로 정의한다.
- safe classification과 approval을 분리하고, interaction plan validator가 승인되지 않은 후보 실행을 차단하도록 설계한다.

## 2026-07-13 - Add Safe Interaction candidate classification MVP

### 작업 목적

- 기존 generated artifact의 action 후보를 safe, unsafe, unknown으로 보수적으로 분류해 Level 3 실행 전 사람이 검수할 수 있게 한다.
- 분류 결과를 Analysis Review Report JSON/Markdown의 safe, unsafe, unresolved section과 summary에 연결한다.

### 변경 내용

- `tools/ai-generator/classify_interaction_candidates.py`를 추가했다.
  - scout element, pageProfile tab/button/form/control, non-primary action 후보를 구조화하고 deterministic하게 중복 제거한다.
  - unsafe 신호를 우선 적용하고, selector와 role/type/ARIA state 근거가 충분한 read-only/reversible 후보만 safe로 분류한다.
  - 근거가 부족하거나 보이지 않는 후보는 unknown으로 유지하며 자동 실행 대상으로 취급하지 않는다.
- 중립 fixture `tools/ai-generator/fixtures/interaction_candidates.fixture.json`을 추가했다.
  - tab, accordion, dialog control, submit, save/delete/upload/login/signup/payment/send/approve, personal information, generic/충돌 후보를 검증한다.
- `build_analysis_review_report.py`가 classifier 결과를 safe/unsafe/unresolved section과 summary count, recommended action에 연결하도록 했다.
- `render_analysis_review_report.py`가 classification, subtype, risk, ARIA, candidate source와 evidence를 상세 영역에 표시하도록 했다.
- Safe Interaction, Analysis Review Report, JSON schema, data flow, project overview 문서를 현재 분류 MVP 상태에 맞게 갱신했다.

### 확인 결과

- Python 문법과 fixture 검증을 수행했다.
- 기존 artifact 기반 JSON/Markdown report 재생성, count 일치, deterministic hash, 빈 후보 및 malformed JSON 처리를 확인했다.
- 사이트 재분석, scout/pageProfile 재수집, Playwright 실행, 외부 LLM API 호출은 수행하지 않았다.

### 다음 작업

- 사람이 승인한 safe 후보만 표현할 수 있는 structured interaction plan 계약을 정의한다.
- 실제 Level 3 실행은 interaction plan validator와 deterministic renderer 설계 이후 별도 작업으로 진행한다.

## 2026-07-13 - Add Analysis Review Report Markdown MVP

### 작업 목적

- Analysis Review Report JSON을 사람이 직접 JSON을 열지 않고 검수할 수 있는 deterministic Markdown report로 렌더링한다.
- warning, recommended action, summary와 약한 Page Identity 근거를 빠르게 확인할 수 있게 한다.

### 변경 내용

- `tools/ai-generator/render_analysis_review_report.py`를 추가했다.
  - 기존 `analysis_review_report.json`만 입력으로 사용해 `analysis_review_report.md`를 생성한다.
  - 모든 report section을 heading, table, list로 표현하고 빈 section은 `No candidates.`로 유지한다.
  - warning과 recommended action을 상단에 배치하고, 긴 selector/evidence는 접을 수 있는 상세 영역으로 분리했다.
  - 생성 시각을 넣지 않아 동일 JSON 입력에서 동일 Markdown 결과를 생성한다.
- `docs/ANALYSIS_REVIEW_REPORT.md`에 JSON/Markdown MVP 구현 상태와 렌더링 원칙을 반영했다.
- `docs/PROJECT_OVERVIEW.md`의 구현 완료 목록과 Immediate Next Milestones를 Markdown MVP 완료 상태에 맞게 동기화했다.

### 확인 결과

- Python 문법 확인과 기존 report JSON 기반 Markdown 생성을 수행했다.
- 주요 section heading, summary count, 빈 safe/unsafe section 표시, 동일 입력 재생성 결과를 확인했다.
- 사이트 재분석, Playwright 실행, 외부 LLM API 호출은 수행하지 않았다.

### 다음 작업

- Safe Interaction candidate classification을 Analysis Review Report의 빈 safe/unsafe section과 연결한다.
- report 검수 흐름이 안정화되면 review/approval UI 또는 workspace 확장을 검토한다.

## 2026-07-13 - Add Analysis Review Report JSON MVP

### 작업 목적

- 기존 scout, menu map, structured test plan artifact를 사람이 검수할 수 있는 단일 JSON report로 재구성한다.
- 테스트 생성 결과뿐 아니라 Page Identity 근거, 제외 후보, non-primary 후보, unresolved 후보와 다음 검수 작업을 함께 제공한다.

### 변경 내용

- `tools/ai-generator/build_analysis_review_report.py`를 추가했다.
  - 기존 `scout_result.json`, `menu_map.json`, `test_plan.llm.json`만 읽어 `analysis_review_report.json`을 생성한다.
  - Summary, Generated Navigation Tests, Page Identity Assertions, Excluded Utility Controls, Non-primary Navigation Candidates, Safe/Unsafe Interaction Candidates, Unresolved Candidates, Recommended Next Actions를 구성한다.
  - 필수 파일 누락과 malformed JSON은 명확히 실패하고, optional field 누락은 warning과 빈 section으로 처리한다.
  - 생성 시각을 넣지 않고 입력 순서를 유지해 동일 입력에서 deterministic output을 만든다.
- `docs/JSON_SCHEMA.md`에 Analysis Review Report JSON의 입력, top-level section, ordering과 warning 정책을 기록했다.
- `docs/JSON_SCHEMA.md`의 구현 상태를 현재 pipeline에 맞게 정정했다.
  - Level 1, Level 2 Page Identity MVP, structured plan/report artifact는 현재 구현으로 구분하고, Level 3 interactionProfile과 Safe Interaction 실행만 planned candidate로 남겼다.
- `docs/PROJECT_OVERVIEW.md`의 구현 완료 목록과 Immediate Next Milestones를 Analysis Review Report JSON MVP 완료 상태에 맞게 동기화했다.
- 현재 artifact에는 safe/unsafe interaction 분류가 없으므로 이를 임의 추론하지 않고 빈 배열, warning, recommended action으로 남기도록 했다.

### 확인 결과

- Python 문법 확인과 기존 artifact 기반 report 생성을 수행했다.
- generated test count, primary navigation count, JSON parse, 동일 입력 재생성 결과를 확인했다.
- scout 재실행, pageProfile 재수집, 외부 LLM API 호출, 전체 사이트 회귀는 수행하지 않았다.

### 다음 작업

- 생성된 report JSON의 검수 정보가 충분한지 확인한 뒤 Markdown Review Report를 별도 단계로 구현한다.
- Safe Interaction candidate classification을 추가할 때 report의 빈 safe/unsafe section을 실제 분류 결과와 연결한다.

## 2026-07-13 - Establish agentic coding context and rules

### 작업 목적

- repository-aware agentic coding 방식으로 작업을 운영하기 위해 최상위 agent 운영 규칙과 압축 프로젝트 context를 정리한다.
- 매 작업 프롬프트에 프로젝트 설명을 반복하지 않고, `AGENTS.md`, `docs/PROJECT_OVERVIEW.md`, 작업별 task packet으로 필요한 문맥을 연결할 수 있게 한다.

### 변경 내용

- root `AGENTS.md`를 현재 URL-first WEB test generation AX pipeline에 맞는 최상위 agent operation guide로 개편했다.
  - architecture rules, document reading order, source of truth priority, change rules, generated artifact policy, AI/data policy, validation cost policy, stop condition을 정리했다.
- `docs/PROJECT_OVERVIEW.md`를 새 agent와 새 세션이 빠르게 읽을 수 있는 압축 context 문서로 갱신했다.
  - 현재 구현 상태, 주요 모듈, data flow, 지원/비지원 범위, 검증된 site type, next milestones, documentation map을 정리했다.
- `docs/AGENT_TASK_TEMPLATE.md`를 신규 추가했다.
  - 작업별 prompt template과 Analysis Review Report JSON MVP sample task packet을 포함했다.
- `README.md` 참고 문서 목록에 `AGENTS.md`, `docs/PROJECT_OVERVIEW.md`, `docs/AGENT_TASK_TEMPLATE.md` entry point를 추가했다.
- `.agents/` 디렉터리를 점검했다.
  - 현재 내부 파일이 없어 root `AGENTS.md`와 충돌하거나 중복되는 규칙은 없었다.

### 확인 결과

- source code, package scripts, generated artifact, test files는 수정하지 않았다.
- `docs/ARCHITECTURE.md`는 현재 빈 파일임을 확인했다. 이번 작업에서는 수정하지 않고, 실제 구조 확인은 `docs/MODULE_MAP.md`와 `docs/DATA_FLOW.md`를 우선하도록 문서화했다.

### 다음 작업

- 다음 agentic task는 `docs/AGENT_TASK_TEMPLATE.md`를 사용해 Analysis Review Report JSON MVP 구현으로 시작한다.
- 향후 `docs/ARCHITECTURE.md`를 채울 경우 `MODULE_MAP.md`와 `DATA_FLOW.md`의 내용을 중복하지 않고 architecture decision 중심으로 정리한다.

## 2026-07-09 - Define review report and safe interaction strategy

### 작업 목적

- product direction과 cross-site validation 문서화 이후 다음 개발 단계인 Level 2.5 Analysis Review Report와 Level 3 Safe Interaction Strategy를 구체화한다.
- CLI/JSON 중심 결과를 사용자가 검수 가능한 review artifact로 전환하기 위한 문서 기준을 만든다.
- 데이터 변경 action을 자동 실행하지 않는 안전한 interaction 확장 원칙을 정리한다.

### 변경 내용

- `docs/ANALYSIS_REVIEW_REPORT.md`를 추가했다.
  - Summary, Generated Navigation Tests, Page Identity Assertions, Excluded Utility Controls, Non-primary Navigation Candidates, Safe/Unsafe Interaction Candidates, Unresolved Candidates, Recommended Next Actions 섹션을 정의했다.
  - 단순 pass/fail이 아니라 evidence-based review artifact로 설계해야 한다는 원칙을 기록했다.
  - 초기 MVP는 Markdown/JSON report이며 웹 UI와 review memory는 future work로 분리했다.
- `docs/SAFE_INTERACTION_STRATEGY.md`를 추가했다.
  - Level 3 목표를 business scenario 자동화가 아니라 page-level safe interaction smoke test로 정의했다.
  - safe 후보, unsafe 기본 제외 action, classification signal, structured interaction plan 방향, proposed template을 정리했다.
  - unknown/risky action은 자동 실행하지 않고 report에서 검수 대상으로 남긴다는 human-in-the-loop 원칙을 기록했다.
- `README.md`에는 다음 로드맵 링크만 짧게 추가했다.
- `docs/PRODUCT_DIRECTION.md`에는 단기 방향 링크만 추가했다.

### 확인 결과

- 문서 변경만 수행했다.
- source code, package scripts, generated artifact, test files는 수정하지 않았다.

### 다음 작업

- Analysis Review Report MVP를 구현할 때는 먼저 JSON/Markdown 산출물 생성부터 시작한다.
- Safe Interaction은 후보 분류와 report 표시를 먼저 구현하고, 실제 Playwright 실행은 별도 단계로 분리한다.

## 2026-07-08 - Clarify product direction and cross-site validation

### 작업 목적

- 프로젝트를 단순 LLM Playwright 코드 생성 도구가 아니라 URL-first WEB test generation AX pipeline으로 문서화한다.
- structured plan, validator, deterministic renderer, human-in-the-loop 검수 흐름을 현재 구현 상태에 맞게 정리한다.
- cross-site 검증 결과를 특정 회사/서비스명이 아니라 site type 기준으로 기록한다.

### 변경 내용

- `README.md`에 프로젝트 포지셔닝 섹션을 추가했다.
  - AI-assisted but deterministic-controlled 구조를 설명했다.
  - LLM은 structured test plan 판단을 담당하고, Playwright code shape는 renderer가 소유한다는 점을 명시했다.
  - 현재 지원 범위와 비지원 범위를 분리했다.
- `docs/PRODUCT_DIRECTION.md`를 추가했다.
  - AX 관점, 목표 사용자, 제품 철학, 현재 지원 범위, 기술적 제품 방향을 정리했다.
- `docs/CROSS_SITE_VALIDATION.md`를 추가했다.
  - Business/complex GNB, Corporate PC/MO overlay GNB, Docs/Docusaurus direct nav site 유형별 검증 결과를 기록했다.
  - utility/mobile exclusion, direct top-level nav, generic navigation open, duplicate title uniqueness를 일반화 규칙으로 정리했다.
- `docs/DATA_FLOW.md`의 현재 흐름을 structured plan 중심으로 보강했다.
- `docs/STRUCTURED_PLAN_MIGRATION.md`에 AI-assisted but deterministic-controlled 방향과 LLM structured plan opt-in 경로를 보강했다.

### 확인 결과

- 문서 변경만 수행했다.
- 코드, generated artifact, package scripts, test files는 수정하지 않았다.

### 다음 작업

- cross-site validation matrix에 새로운 site type을 추가할 때는 특정 서비스명 대신 구조 유형과 일반화 규칙 중심으로 기록한다.
- 제품 방향 문서는 구현 상태가 바뀔 때마다 current scope와 future work를 함께 갱신한다.

## 2026-07-08 - Ensure unique rendered Playwright test titles

### 작업 목적

- 서로 다른 parent 아래 동일한 child text가 있을 때 renderer 산출물이 중복 Playwright test title을 만들어 실행 전 중단되는 문제를 방지한다.
- `test_case.title`이 중복되더라도 최종 실행 title은 `menuPath` 전체를 기준으로 유니크하게 만들도록 한다.

### 변경 내용

- `render_test_plan.py`에서 최종 test title을 `Navigation: parent > child` 형태의 full `menuPath` 기반으로 생성하도록 변경했다.
- 렌더링 중 동일 title이 다시 발생하면 `#2`, `#3` suffix를 붙이는 uniqueness guard를 추가했다.
- `validate_test_plan.py`는 `tests[].title` 중복을 error가 아닌 warning으로 표시하도록 했다. 실제 실행 안정성은 renderer가 보장한다.
- `docs/TEST_TEMPLATE_CATALOG.md`와 `docs/STRUCTURED_PLAN_MIGRATION.md`에 renderer가 LLM title을 그대로 신뢰하지 않고 최종 Playwright title uniqueness를 보장한다는 원칙을 기록했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/render_test_plan.py` 통과.
- `python -m py_compile tools/ai-generator/validate_test_plan.py` 통과.
- KT IoT 대상 `npm run ai:plan:llm -- --url https://iotbiz.kt.co.kr` 실행 후 `npm run ai:validate-llm-plan` 통과.
- KT IoT 대상 `npm run test:generated` 결과 41 passed 확인.
  - 동일 child text가 `Navigation: 모듈/모뎀 > NB-IoT`, `Navigation: 단말 > NB-IoT`처럼 full menuPath 기반 title로 구분되어 duplicate title 중단이 사라졌다.
- Playwright 공식 사이트 대상 `npm run ai:plan:llm -- --url https://playwright.dev` 실행 후 `npm run test:generated` 결과 8 passed 확인.
- Kakao 대상 `npm run ai:plan:llm -- --url https://www.kakaocorp.com` 실행 후 `npm run test:generated` 결과 17 passed 확인.

### 다음 작업

- LLM이 생성하는 `tests[].title`은 사람이 읽기 좋은 보조 정보로 두고, 실행 안정성은 renderer의 full menuPath 기반 title 생성 규칙으로 유지한다.

## 2026-07-08 - Include direct top-level nav links in primary projection

### 작업 목적

- Docusaurus/문서형 사이트처럼 top-level nav link가 dropdown 없이 바로 이동 대상인 경우 `depth1Index`가 null이라는 이유만으로 `primaryMenuTree`가 비는 문제를 보완한다.
- Playwright 공식 사이트에서 Docs, MCP, CLI, API 같은 direct nav link를 Level 1/2 primary navigation 대상으로 projection할 수 있게 한다.

### 변경 내용

- `agent_orchestrator.py`에 `primaryNavigationDirect` 분류를 추가했다.
  - header/nav 영역, high confidence, visible, href/text가 있는 direct nav link는 `depth1Index`가 null이어도 primary parent 후보로 승격할 수 있다.
  - brand/logo home, skip link, search, theme toggle, GitHub/Discord/social utility, external utility, hero CTA/card link는 primary 대상에서 제외한다.
- Docusaurus 계열 `navbar__item`, `navbar__link` 같은 top-level nav signal을 generic direct nav 후보로 처리했다.
- dropdown parent와 child의 cssPath DOM 관계를 이용해 child를 parent 아래로 연결하고, child open trigger로 parent dropdown cssPath를 보존하도록 했다.
- menu 후보가 수집되었지만 `primaryMenuTree`가 비는 경우 `projectionDiagnostics`에 warning을 남기도록 했다.
- LLM structured plan normalization에서 exact `menuPath`에 해당하는 `openTriggerCssPath`/`hoverTargetCssPath`를 menu_map에서 보강하고, `href: "#"` URL assertion은 `/`로 보수 보정하도록 했다.
- `docs/DATA_FLOW.md`에 direct top-level nav link와 dropdown projection 원칙을 기록했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 통과.
- Playwright 공식 사이트 대상 `npm run ai:plan:llm -- --url https://playwright.dev` 실행 결과 `primaryMenuTree`가 parent 5개, child 3개로 구성되었다.
  - primary parent: Docs, MCP, CLI, API, Node.js
  - dropdown child: Python, Java, .NET
  - Search/GitHub/Discord/theme toggle/brand/hero CTA는 primary 대상에서 제외되었다.
- Playwright 공식 사이트 대상 `npm run ai:validate-llm-plan` 통과.
- Playwright 공식 사이트 대상 `npm run test:generated` 결과 8 passed 확인.
- Kakao 대상 회귀 확인에서 `primaryMenuTree` parent 5개, child 12개를 유지했고 `npm run test:generated` 결과 17 passed 확인.
- KT 대상 `npm run ai:plan:llm -- --url https://iotbiz.kt.co.kr` 실행 결과 parent 9개, child 32개, validation/render 완료를 확인했다.
- KT 대상 `npm run test:generated`는 브라우저 실행 전 renderer 산출물의 중복 test title에서 중단되었다.
  - 예: 서로 다른 parent 아래의 `NB-IoT`, `eMTC`, `LTE-M`, `LTE`, `5G`가 동일 test title로 생성됨.
  - 이번 projection 보강과 별개인 renderer title 고유성 이슈로 분리한다.

### 다음 작업

- `render_test_plan.py`가 동일 child text를 가진 depth3 테스트에 parent path를 포함한 고유 title을 만들도록 별도 개선한다.
- 추가 문서형 사이트에서 `primaryNavigationDirect`가 utility/social/header CTA를 과하게 포함하지 않는지 샘플을 늘려 확인한다.

## 2026-07-08 - Ignore generated test artifacts

### 작업 목적

- `ai:plan:llm`, `test:generated` 실행 후 생성되는 테스트 산출물이 Git 작업 diff에 계속 섞이는 문제를 줄인다.
- source/docs와 generated artifact를 명확히 구분해 review와 commit 범위를 판단하기 쉽게 한다.

### 변경 내용

- `.gitignore`에 `tests/generated/`를 추가해 renderer/generated spec 산출물을 ignore하도록 했다.
- 기존 ignore 대상인 `test-results/`, `playwright-report/`, `tools/ai-generator/generated/*` 정책을 유지하면서 `*.json`, `*.txt`, `primary_menu_tree_for_profiles.json` 산출물 ignore 의도를 명시했다.
- `tools/ai-generator/generated/test_plan.example.json`은 schema/renderer/validator fixture이므로 ignore 예외로 유지했다.
- `README.md`에 generated artifact 관리 원칙과 fixture 예외를 기록했다.

### 확인 결과

- 현재 Git에 추적 중인 `tools/ai-generator/generated` 산출물은 `test_plan.example.json`뿐임을 확인했다.
- `tests/generated/generated_from_plan.spec.js`, `tools/ai-generator/generated/test_plan.llm.json`, `test-results/`, `playwright-report/`가 ignore 대상임을 확인했다.

### 다음 작업

- 이미 추적된 generated artifact가 추가로 발견되면 삭제하지 말고 별도 판단 후 `git rm --cached` 여부를 결정한다.

## 2026-07-08 - Use planned open trigger for generic navigation

### 작업 목적

- structured plan renderer 산출물이 특정 사이트 전용 `.menuContainer .depth1 > li` selector에만 의존하지 않도록 개선한다.
- `test_plan`에 포함된 `openTriggerCssPath`, `hoverTargetCssPath`, `cssPath`를 navigation open 단계에서 우선 활용해 URL-first cross-site 실행 안정성을 높인다.

### 변경 내용

- `utils/gnb.js`에 plan 기반 navigation open helper를 추가했다.
  - `openTriggerCssPath`, `hoverTargetCssPath`, Kakao PC `mainMenu-N` 기반 추론 selector, `cssPath` 순서로 open 후보를 시도한다.
  - 후보 selector가 DOM에는 있지만 hidden인 경우 실패로 끝내지 않고 다음 후보 또는 기존 `depth1Index` fallback으로 내려가도록 했다.
  - 기존 `.menuContainer .depth1 > li` fallback은 유지해 기존 KT IoT 계열 generated test 동작을 보존했다.
- `clickVisibleMenuByText`, `clickVisibleSubMenuByText`가 plan options를 받아 generic open 후 cssPath/id/text 기반 클릭을 수행하도록 보강했다.
- `render_test_plan.py`가 `click.openTriggerCssPath`와 `click.hoverTargetCssPath`를 generated spec 호출 options에 포함하도록 수정했다.
- `validate_test_plan.py`에서 `click.openTriggerCssPath`, `click.hoverTargetCssPath`를 optional string field로 허용했다.
- `docs/TEST_TEMPLATE_CATALOG.md`에 renderer가 plan 기반 open trigger를 우선 사용한다는 규칙을 추가했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/render_test_plan.py tools/ai-generator/validate_test_plan.py` 통과.
- `node -c utils/gnb.js` 통과.
- `npm run ai:plan:llm -- --url https://www.kakaocorp.com` 실행 후 `npm run ai:validate-llm-plan` 통과.
- Kakao 대상 `npm run test:generated` 결과 17 passed 확인.
- `npm run ai:plan:llm -- --url https://iotbiz.kt.co.kr` 실행 후 `npm run ai:validate-llm-plan` 통과.
- KT IoT 대상 `npx playwright test tests/generated --reporter=dot` 결과 41 passed 확인.

### 다음 작업

- 여러 사이트에서 `openTriggerCssPath`와 `hoverTargetCssPath`가 충분히 수집되는지 추가 샘플로 확인한다.
- generated artifact와 cache 파일은 검증 산출물이므로 커밋 대상에서 제외한다.

## 2026-07-08 - Exclude utility and mobile navigation from primary projection

### 작업 목적

- broad scout discovery 결과에서 overlay close/open control, header utility link, mobile-only duplicate navigation이 `primaryMenuTree`에 섞이는 문제를 줄인다.
- Level 1/2 structured plan 대상은 primary desktop/header navigation 중심으로 projection하고, utility/mobile 후보는 non-primary 후보로 보존한다.

### 변경 내용

- `agent_orchestrator.py`에 utility/overlay control 분류 규칙을 추가했다.
  - `닫기`, `열기`, search/language/dark-mode 성격의 button/control
  - `btn_close`, `btn_search`, `btn_language`, `btn_mode`, `wrap_util`, `area_util`, `group_relation`, `list_relation` selector signal
- PC/desktop navigation 후보가 존재하면 `gnbContentMO` 등 mobile navigation 후보를 `mobileNavigationFallback`으로 분류해 `primaryMenuTree`에서 제외하도록 했다.
- PC top-level menu button과 expanded panel child를 `nav ... li:nth-of-type(N)` / `mainMenu-N` DOM 관계로 연결하도록 보강했다.
- child가 expanded panel에 속할 때는 child 자체 index가 아니라 parent의 `depth1Index`를 open index로 사용하도록 했다.
- top-level direct nav link가 마지막 parent의 child로 잘못 붙지 않도록 `topLevelDirectLink` 후보로 분리했다.
- LLM structured plan normalization에서 `navigation.todoIdentity`의 `todo.reason`이 누락된 경우 기본 reason을 채우도록 했다. Validator 자체는 strict하게 유지했다.
- `docs/DATA_FLOW.md`에 utility/mobile navigation projection 제외 원칙을 기록했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인을 통과했다.
- `npm run ai:plan:llm -- --url https://www.kakaocorp.com` 실행 결과 LLM plan 생성, validation, render가 정상 완료되었다.
- 카카오 대상 `menu_map.primaryMenuTree`는 parent 5개, child 12개로 구성되었다.
- `메인 메뉴 닫기`는 `utilityLink`로 분류되어 primary parent에서 제외되었다.
- `gnbContentMO` mobile navigation 후보는 `mobileNavigationFallback`으로 분류되어 primary tree에서 제외되었다.
- `인재영입 새창열림`과 top-level direct link가 primary child로 붙지 않는 것을 확인했다.
- `npm run ai:validate-llm-plan` 결과 errors 0, warnings 0을 확인했다.
- `npm run test:generated`는 17개 테스트 모두 실패했다. 실패 원인은 `utils/gnb.js`의 기존 `openDepth1ByIndex`가 `.menuContainer .depth1 > li` 전용 selector를 사용하기 때문이며, 카카오 DOM에는 해당 selector가 없어 timeout이 발생했다.

### 다음 작업

- URL-first 범용 실행을 위해 `openDepth1ByIndex` 또는 renderer가 target별 `openTriggerCssPath`/generic nav selector를 사용할 수 있도록 별도 개선한다.
- 이번 작업 범위에서는 scout.js, renderer, generated spec 구조를 수정하지 않았으므로 primary projection 개선과 generic GNB open helper 개선을 분리해 진행한다.

## 2026-07-08 - Tighten LLM content identity selector prompt

### 작업 목적

- `ai:compare-plans:gate`에서 LLM plan이 deterministic plan보다 넓은 parent content selector를 선택해 meaningful assertion/page identity mismatch 8건이 발생하는 문제를 줄인다.
- LLM structured test plan prompt가 exact pageProfile 안에서 가장 구체적인 current-page content selector를 선택하도록 보강한다.

### 변경 내용

- `agent_orchestrator.py`의 LLM structured test plan prompt에 `navigation.contentIdentity` selector specificity 규칙을 추가했다.
- 같은 exact pageProfile 안에서 broad parent shell보다 `div.subContent`, `div.content` 등 더 깊은 current content selector를 우선하도록 명시했다.
- `main`, `main.subContainer`, `section` 같은 넓은 parent selector는 더 구체적인 child content selector가 없을 때만 마지막 후보로 사용하도록 했다.
- `docs/PROMPT_STRATEGY.md`에 동일한 content selector 선택 규칙을 기록했다.
- `docs/STRUCTURED_PLAN_MIGRATION.md`에 llm-plan Phase 2의 content selector specificity 원칙을 보완했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인을 통과했다.
- `npm run ai:plan:llm -- --url https://iotbiz.kt.co.kr` 실행 결과 LLM plan 생성, validation, render가 정상 완료되었다.
- pageProfile cache는 targets 41, hits 41, misses 0으로 동작했다.
- `npm run ai:validate-llm-plan` 결과 errors 0, warnings 0을 확인했다.
- `npm run ai:compare-plans` 결과 deterministic/LLM 모두 41 tests, matched menuPaths 41, meaningful template/selector/assertion mismatch 0을 확인했다.
- `npm run ai:compare-plans:gate` 결과 quality gate passed를 확인했다.

### 다음 작업

- LLM plan prompt가 다른 target URL에서도 broad parent selector 대신 구체적인 current content selector를 안정적으로 선택하는지 추가 샘플로 확인한다.
- raw assertion mismatch 41건은 hash-only URL과 absolute URL 표현 차이 등 의미 없는 차이로 분류되고 있으므로, 필요 시 report 가독성만 별도로 다듬는다.

## 2026-07-07 - Add structured plan comparison quality gate

### 작업 목적

- `ai:compare-plans`를 단순 리포트 도구로 유지하면서, 필요 시 품질 게이트로 사용할 수 있는 opt-in 모드를 추가한다.
- deterministic plan과 llm-plan 사이에 coverage 누락 또는 meaningful quality mismatch가 있으면 CI/검증 단계에서 실패시킬 수 있게 한다.

### 변경 내용

- `compare_test_plans.py`에 `--fail-on-meaningful-mismatch` 옵션을 추가했다.
- 기본 실행은 기존처럼 리포트를 생성하고 exit code 0을 유지한다.
- gate 옵션이 켜진 경우 다음 조건에서 exit code 1로 종료하도록 했다.
  - deterministic plan에만 있는 menuPath
  - LLM plan에만 있는 menuPath
  - meaningful template mismatch
  - meaningful selector mismatch
  - meaningful assertion/page identity mismatch
- `package.json`에 `ai:compare-plans:gate` script를 추가했다.
- `README.md`에 리포트용 compare 명령과 품질 게이트용 compare 명령의 차이를 기록했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/compare_test_plans.py` 문법 확인을 통과했다.
- `npm run ai:compare-plans` 실행 결과 기존처럼 리포트 생성용으로 동작하고 exit code 0으로 종료되는 것을 확인했다.
- 현재 artifact 기준 compare 결과는 deterministic plan 41건, llm-plan 41건, matched menuPaths 41건이다.
- coverage 누락, meaningful template mismatch, meaningful selector mismatch는 0건이었다.
- meaningful assertion/page identity mismatch 8건이 확인되었다.
- `npm run ai:compare-plans:gate` 실행 결과 meaningful assertion/page identity mismatch 8건 때문에 exit code 1로 실패하는 것을 확인했다.
- gate 실패 항목은 LLM plan이 exact content selector보다 한 단계 넓은 parent selector를 선택한 케이스였다.

### 다음 작업

- CI 또는 사전 검수 흐름에 `npm run ai:compare-plans:gate`를 연결할지 검토한다.
- 현재 gate 실패 항목은 `plan_compare_report.md`를 기준으로 LLM prompt의 content selector 선택 규칙을 보강한다.

## 2026-07-06 - Document structured plan command usage in README

### 작업 목적

- `package.json` scripts만 보고는 deterministic plan 경로와 LLM structured plan 경로의 사용법을 이해하기 어려운 문제를 줄인다.
- 사람이 실행 목적에 따라 어떤 명령을 써야 하는지 README에서 바로 확인할 수 있게 한다.

### 변경 내용

- `README.md`에 structured plan 실행 흐름 섹션을 추가했다.
- 기존 안정 경로, deterministic structured plan 경로, LLM structured plan 경로, plan 비교 경로를 구분해 설명했다.
- `ai:plan`, `ai:plan:deterministic`, `ai:plan:llm`, `ai:plan:compare`, `ai:compare-plans`의 역할과 주의사항을 정리했다.
- deterministic/LLM render가 `tests/generated/generated_from_plan.spec.js`를 공유한다는 점을 명시했다.
- composite script에서는 `TARGET_URL` 사용을 권장한다는 내용을 추가했다.
- README 명령어 요약 표에 structured plan 관련 명령을 추가했다.

### 확인 결과

- 문서 작업만 수행했으며 테스트 실행은 하지 않았다.
- README에서 기존 generated spec 실행 흐름과 structured plan 실행 흐름이 구분되도록 정리했다.

### 다음 작업

- plan mode가 기본 경로로 전환될 때 README의 기본 실행 흐름을 다시 갱신한다.
- 필요 시 README의 명령어 요약을 운영자용 quick start와 개발자용 advanced flow로 더 분리한다.

## 2026-07-06 - Clarify structured plan npm scripts

### 작업 목적

- deterministic plan 경로와 llm-plan 경로가 섞여 보이는 `package.json` scripts를 사용 시나리오별로 정리한다.
- 같은 shadow output file인 `tests/generated/generated_from_plan.spec.js`를 어떤 경로가 마지막으로 렌더링했는지 혼동하지 않도록 한다.
- `ai:plan`은 deterministic 기본 경로로 유지하고, LLM 경로는 `ai:plan:llm`으로 명시하도록 한다.

### 변경 내용

- `package.json`에 `ai:render-llm-plan`을 추가했다.
- `ai:plan`을 `ai:plan:deterministic` alias로 변경했다.
- `ai:plan:deterministic`을 deterministic builder path 실행용 script로 추가했다.
- `ai:plan:llm`을 LLM structured plan path 실행용 script로 추가했다.
- `ai:plan:compare`를 deterministic/LLM plan artifact 생성, 검증, 비교용 script로 추가했다.
- `ai:test:deterministic`과 `ai:test:llm`을 plan 생성 후 generated test 실행용 script로 추가했다.
- `docs/STRUCTURED_PLAN_MIGRATION.md`에 script naming rule과 URL 전달 주의사항을 반영했다.

### 확인 결과

- `package.json` JSON parse 확인을 통과했다.
- `npm run ai:plan:deterministic -- --url https://iotbiz.kt.co.kr` 실행을 통과했다.
- `npm run ai:plan:llm -- --url https://iotbiz.kt.co.kr` 실행을 통과했다.
- `npm run ai:compare-plans` 실행을 통과했다.
- compare 결과는 deterministic plan 41건, llm-plan 41건, matched menuPaths 41건으로 coverage 차이가 없었다.
- `npm run test:generated` 실행 결과 41 passed로 통과했다.

### 다음 작업

- composite script에서 여러 generation step에 같은 URL을 넘길 때는 `TARGET_URL` 사용을 권장한다.
- `generated_from_plan.spec.js`는 deterministic/LLM render가 공유하는 shadow output이므로, 비교 목적 script와 실행 목적 script를 구분해서 사용한다.

## 2026-07-06 - Prefer content identity in LLM structured plan prompt

### 작업 목적

- LLM structured test plan이 exact heading이 없다는 이유만으로 `navigation.todoIdentity`를 선택하는 문제를 줄인다.
- exact matching pageProfile에 신뢰 가능한 content/mainContainer cssPath가 있으면 `navigation.contentIdentity`를 선택하도록 prompt를 보강한다.
- deterministic plan과 llm-plan의 meaningful quality difference를 줄인다.

### 변경 내용

- `agent_orchestrator.py`의 structured test plan prompt에 template 선택 우선순위를 보강했다.
- exact heading match가 있으면 `navigation.headingIdentity`를 우선 선택하도록 유지했다.
- tab-like/ngClick/no-url-change 메뉴에만 `navigation.tabIdentity`를 선택하도록 기준을 좁혔다.
- 일반 href navigation에서 exact heading이 없고 exact pageProfile에 reliable content/mainContainer cssPath가 있으면 `navigation.contentIdentity`를 선택하도록 명시했다.
- `navigation.todoIdentity`는 heading, tab, content identity 근거를 모두 확인한 뒤 사용하는 최후 fallback으로 정의했다.
- `docs/PROMPT_STRATEGY.md`에 동일한 template 선택 규칙을 반영했다.
- `docs/STRUCTURED_PLAN_MIGRATION.md`에 llm-plan prompt가 contentIdentity를 todoIdentity보다 우선하도록 보강한 내용을 반영했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인을 통과했다.
- warm cache 상태에서 `npm run ai:generate-llm-plan -- --url https://iotbiz.kt.co.kr` 실행을 통과했다.
- `npm run ai:validate-llm-plan` 실행 결과 errors 0, warnings 0으로 통과했다.
- `npm run ai:compare-plans` 실행 결과 deterministic plan 41건, llm-plan 41건, matched menuPaths 41건으로 coverage 차이가 없었다.
- LLM plan template 분포는 `navigation.headingIdentity` 20건, `navigation.contentIdentity` 11건, `navigation.tabIdentity` 10건으로 deterministic plan과 일치했다.
- meaningful template mismatch, meaningful selector mismatch, meaningful assertion/page identity mismatch, todo mismatch가 모두 0건으로 정리되었다.
- LLM plan의 `todoIdentity`는 11건에서 0건으로 줄었다.

### 다음 작업

- renderer 기반 `generated_from_plan.spec.js` 실행을 통해 llm-plan 산출물이 실제 Playwright 실행에서도 안정적인지 확인한다.
- raw difference 41건은 URL/hash 표현 차이 등 비교 normalization 대상이므로, 실행 영향이 있는지 필요 시 별도로 검토한다.

## 2026-07-06 - Refine structured plan comparison quality signals

### 작업 목적

- deterministic plan과 llm-plan 비교에서 단순 표현 차이가 품질 차이처럼 과장되는 문제를 줄인다.
- raw difference와 meaningful quality difference를 분리해 실제 후속 작업 판단에 필요한 값이 먼저 보이도록 한다.
- `todoIdentity`로 내려간 케이스와 실제 template/selector 품질 차이를 더 선명하게 드러낸다.

### 변경 내용

- `compare_test_plans.py`에 URL 비교 normalization을 추가했다.
- absolute URL과 hash-only URL이 같은 hash route를 가리키면 meaningful mismatch로 보지 않도록 했다.
- 양쪽 모두 `navigation.tabIdentity`이고 selector kind와 selector 또는 id가 같으면 identity text 차이만으로 meaningful mismatch로 보지 않도록 했다.
- summary를 raw/meaningful 기준으로 분리했다.
  - `rawAssertionMismatchCount`
  - `meaningfulAssertionMismatchCount`
  - `meaningfulTemplateMismatchCount`
  - `meaningfulSelectorMismatchCount`
  - `todoMismatchCount`
- Markdown report는 meaningful mismatch 중심으로 요약하고, raw-only difference는 별도 섹션에 남기도록 했다.
- `docs/STRUCTURED_PLAN_MIGRATION.md`에 raw difference와 meaningful quality difference 분리 원칙을 반영했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/compare_test_plans.py` 문법 확인을 통과했다.
- `npm run ai:compare-plans` 실행을 통과했다.
- 현재 비교 결과는 deterministic plan 41건, llm-plan 41건, matched menuPaths 41건이다.
- coverage 차이는 없으며, meaningful template mismatch 11건과 meaningful selector mismatch 11건을 확인했다.
- raw assertion/page identity mismatch는 41건이지만, URL/hash 정규화와 tabIdentity 비교 완화 후 meaningful assertion/page identity mismatch는 11건으로 정리되었다.
- deterministic plan의 `todoIdentity`는 0건이고, llm-plan의 `todoIdentity`는 11건이다.
- `tools/ai-generator/generated/plan_compare_report.json`과 `tools/ai-generator/generated/plan_compare_report.md`가 갱신되는 것을 확인했다.

### 다음 작업

- meaningful mismatch와 `todoIdentity` 케이스를 기준으로 LLM prompt 또는 template 선택 기준을 보강한다.
- raw-only difference는 실행 안정성에 영향을 주는지 별도 필요 시에만 검토한다.

## 2026-07-06 - Add structured plan comparison tool

### 작업 목적

- deterministic plan과 llm-plan을 `menuPath` 기준으로 비교해 structured test plan 품질 차이를 확인할 수 있게 한다.
- 테스트 실행 성공 여부와 별개로 template 선택, Page Identity assertion, TODO identity 분포를 검수하는 기반을 만든다.
- TODO를 자동으로 제거하지 않고, 약한 케이스를 후속 template/prompt 개선 후보로 분류할 수 있게 한다.

### 변경 내용

- `tools/ai-generator/compare_test_plans.py`를 추가했다.
- 기본 비교 대상은 `tools/ai-generator/generated/test_plan.generated.json`과 `tools/ai-generator/generated/test_plan.llm.json`이다.
- 비교 항목은 coverage 차이, template 차이, `navigationChange` 차이, selector kind 차이, assertion/Page Identity 차이, `todoIdentity` 발생 여부다.
- 비교 결과를 콘솔 요약으로 출력하고, 다음 리포트 파일로 저장하도록 했다.
  - `tools/ai-generator/generated/plan_compare_report.json`
  - `tools/ai-generator/generated/plan_compare_report.md`
- `package.json`에 `ai:compare-plans` script를 추가했다.
- `docs/STRUCTURED_PLAN_MIGRATION.md`에 structured plan comparison 도구의 역할을 추가했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/compare_test_plans.py` 문법 확인을 통과했다.
- `npm run ai:compare-plans` 실행을 통과했다.
- 현재 비교 결과는 deterministic plan 41건, llm-plan 41건, matched menuPaths 41건이다.
- coverage 차이는 없으며, template mismatch 11건과 selector kind mismatch 11건을 확인했다.
- deterministic plan의 `todoIdentity`는 0건이고, llm-plan의 `todoIdentity`는 11건이다.
- 비교 리포트가 `tools/ai-generator/generated/plan_compare_report.json`과 `tools/ai-generator/generated/plan_compare_report.md`로 생성되는 것을 확인했다.

### 다음 작업

- compare report에서 반복적으로 나타나는 `todoIdentity` 또는 template mismatch 케이스를 기준으로 LLM prompt와 template 선택 기준을 보강한다.
- compare 결과를 plan mode 전환 전 품질 검수 기준으로 사용할지 검토한다.

## 2026-07-06 - Enforce LLM structured plan coverage prompt

### 작업 목적

- LLM structured test plan이 `primaryMenuTree`의 일부 메뉴만 선택적으로 생성하지 않도록 coverage prompt를 강화한다.
- `primaryMenuTree`의 parent/depth3 child 전체 `menuPath`가 `tests[]`에 정확히 1회씩 포함되도록 LLM 입력 payload에 명시적인 checklist를 추가한다.
- coverage 누락은 자동 보완하지 않고 기존 `validate_test_plan.py --menu-map` gate에서 차단되도록 유지한다.

### 변경 내용

- `agent_orchestrator.py`에 `expectedCoverage` payload 생성을 추가했다.
- `expectedCoverage`에는 `parentCount`, `childCount`, `total`, `menuPaths`를 포함하며, 값은 `menu_map.primaryMenuTree` traversal 순서로 계산한다.
- `llm-plan` generation input에만 `expectedCoverage`를 포함하도록 하여 기존 `spec` mode prompt는 변경하지 않았다.
- structured test plan prompt에 다음 규칙을 강화했다.
  - `tests.length`는 `expectedCoverage.total`과 정확히 같아야 한다.
  - 모든 `tests[].menuPath`는 `expectedCoverage.menuPaths` 중 하나와 exact match해야 한다.
  - expected checklist에 없는 menuPath를 만들지 않는다.
  - 누락, 중복, 임의 요약, 중요 메뉴만 선택하는 생성을 금지한다.
  - 안정적인 page identity 근거가 없어도 menuPath를 생략하지 않고 `navigation.todoIdentity`로 생성한다.
- `docs/PROMPT_STRATEGY.md`에 llm-plan coverage checklist prompt 전략을 반영했다.
- `docs/STRUCTURED_PLAN_MIGRATION.md`에 Phase 2 llm-plan이 `expectedCoverage` payload를 사용한다는 내용을 보강했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인을 통과했다.
- 현재 `menu_map.primaryMenuTree` 기준 expected coverage는 parent 9건, child 32건, total 41건으로 확인했다.
- warm cache 상태에서 `npm run ai:generate-llm-plan -- --url https://iotbiz.kt.co.kr` 실행 후 `test_plan.llm.json`이 41개 test를 생성하는 것을 확인했다.
- `npm run ai:validate-llm-plan` 실행 결과 errors 0, warnings 0으로 통과했다.

### 다음 작업

- 필요 시 `generated_from_plan.spec.js`를 렌더링한 뒤 Playwright 실행까지 확인한다.
- LLM plan coverage는 통과했으므로 다음 단계에서는 template 선택 품질과 실행 안정성을 별도로 점검한다.

## 2026-07-06 - Validate structured plan menu coverage

### 작업 목적

- LLM이 생성한 structured test plan이 `primaryMenuTree`의 parent/depth3 child 메뉴를 누락하지 않았는지 검증한다.
- LLM plan이 일부 메뉴만 생성해도 renderer/playwright 단계로 조용히 넘어가지 않도록 validator gate를 강화한다.
- 이번 작업에서는 LLM prompt 품질 개선이나 누락 test 자동 보완은 수행하지 않는다.

### 변경 내용

- `validate_test_plan.py`에 optional `--menu-map` 인자를 추가했다.
- `--menu-map`이 전달되면 `menu_map.primaryMenuTree` 기준 기대 `menuPath` 목록을 만들고 `tests[].menuPath`와 비교하도록 했다.
- 누락된 menuPath는 `[E401] missing test case for menuPath` error로 처리한다.
- `primaryMenuTree`에 없는 menuPath는 `[E402] unknown test case menuPath` error로 처리한다.
- 중복 menuPath는 `[E403] duplicate test case menuPath` error로 처리한다.
- `package.json`에 `ai:validate-llm-plan` script를 추가했다.
- `agent_orchestrator.py`의 `llm-plan` validation 단계에서 `--menu-map tools/ai-generator/generated/menu_map.json`을 함께 넘기도록 했다.
- `docs/TEST_PLAN_SCHEMA.md`와 `docs/STRUCTURED_PLAN_MIGRATION.md`에 coverage validation gate를 반영했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/validate_test_plan.py` 문법 확인이 통과했다.
- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인이 통과했다.
- `npm run ai:validate-plan` 실행 결과 example fixture 검증은 errors 0, warnings 0으로 통과했다.
- `npm run ai:validate-generated-plan` 실행 결과 deterministic generated plan 검증은 errors 0, warnings 0으로 통과했다.
- `npm run ai:validate-llm-plan` 실행 결과 현재 26 tests LLM plan은 coverage error 15건으로 실패했다.
- 실패 항목은 `모듈/모뎀`, `단말`, `개발 지원`, `검증 지원`, `KT IoT 사업협력센터`, `공유` 하위 일부 depth3 menuPath 누락이었다.
- LLM plan coverage 실패는 이번 작업의 기대 결과이며, renderer로 넘어가기 전 누락을 차단하는 품질 게이트가 동작함을 확인했다.

### 다음 작업

- LLM structured plan prompt를 보강해 `primaryMenuTree` 전체 parent/depth3 coverage를 생성하도록 한다.
- 필요하면 LLM raw output과 `E401` 누락 목록을 비교해 어떤 메뉴 그룹에서 누락이 반복되는지 분석한다.

## 2026-07-06 - Cache collected pageProfiles

### 작업 목적

- primary navigation pageProfiles 수집이 매번 전체 메뉴를 클릭하면서 10분 이상 걸리는 병목을 줄인다.
- 반복 실행 시 동일 target URL과 동일 메뉴 식별 정보의 pageProfile을 cache에서 재사용한다.
- scout.js의 DOM 수집/클릭 로직과 structured plan builder/validator/renderer는 변경하지 않는다.

### 변경 내용

- `agent_orchestrator.py`에 `tools/ai-generator/generated/page_profile_cache.json` 기반 pageProfile cache를 추가했다.
- cache key는 `targetUrl`, `menuPath`, `href`, `ngClick`, `cssPath`를 기준으로 생성하도록 했다.
- cache hit profile과 이번 실행에서 새로 수집한 profile을 primaryMenuTree 순서로 병합해 `menu_map.pageProfiles`에 저장하도록 했다.
- cache miss인 menuPath만 scout.js pageProfile 수집 대상으로 넘기도록 했다.
- `--no-profile-cache` 옵션을 추가해 기존처럼 전체 pageProfile 수집을 강제할 수 있게 했다.
- `--clear-profile-cache` 옵션을 추가해 실행 전 cache 삭제 후 재수집할 수 있게 했다.
- cache 파일 파싱 실패나 shape 오류는 경고 후 empty cache로 계속 진행하도록 했다.
- `docs/JSON_SCHEMA.md`에 `page_profile_cache.json` 구조를 추가했고, `docs/DATA_FLOW.md`에 pageProfile cache 흐름을 반영했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인이 통과했다.
- cold cache 실행: `npm run ai:generate-plan -- --url https://iotbiz.kt.co.kr --clear-profile-cache`
  - pageProfile targets: 41
  - cache hits: 0
  - cache misses: 41
  - collected: 41
  - elapsed seconds: 459.8
- warm cache 실행: `npm run ai:generate-plan -- --url https://iotbiz.kt.co.kr`
  - pageProfile targets: 41
  - cache hits: 41
  - cache misses: 0
  - collected: 0
  - elapsed seconds: 0.0
  - 전체 명령 wall time은 약 12.7초였다.
- warm cache 실행 후 `menu_map.pageProfiles` 개수는 41건으로 유지되는 것을 확인했다.
- `npm run ai:validate-generated-plan` 실행 결과 errors 0, warnings 0으로 통과했다.
- `npm run ai:render-generated-plan` 실행 결과 `tests/generated/generated_from_plan.spec.js` 생성이 통과했다.

### 다음 작업

- cache hit 상태에서 `llm-plan` 실행 시간을 확인한다.
- target URL 또는 메뉴 식별 정보가 바뀌었을 때 cache miss가 의도대로 발생하는지 추가 확인한다.
- 필요하면 cache stale 정책이나 cache inspect 명령을 별도 작업으로 검토한다.

## 2026-07-03 - Normalize LLM plan navigationChange values

### 작업 목적

- `llm-plan` mode에서 LLM이 생성한 `navigation.tabIdentity` 테스트의 `navigationChange` 값이 schema enum을 벗어나 validate 단계에서 실패하는 문제를 보정한다.
- `validate_test_plan.py`의 strict enum 검사는 유지하고, LLM parsed plan을 validation 전에 normalization/repair한다.
- scout와 pageProfile 재수집 없이 기존 `test_plan.llm.json` artifact 기준으로 원인을 확인하고 수정한다.

### 변경 내용

- `test_plan.llm.json`의 `tests[13]`~`tests[22]`에서 `navigationChange`가 `null`로 생성된 것을 확인했다.
- `build_structured_test_plan_prompt`의 `navigation.tabIdentity` 규칙에 허용 enum `"expected"`, `"none"`, `"unknown"`만 사용할 것을 명확히 추가했다.
- `agent_orchestrator.py`에 `normalize_llm_test_plan(plan)`을 추가했다.
- `navigation.tabIdentity`의 `navigationChange`가 누락되었거나 invalid이면 `click.ngClick` 존재 시 `"none"`, URL href가 있고 `ngClick`이 없으면 `"expected"`, 판단 불가 시 `"unknown"`으로 보정하도록 했다.
- LLM parsed 원본은 `tools/ai-generator/generated/test_plan.llm.original.json`에 저장하고, normalized plan은 `tools/ai-generator/generated/test_plan.llm.json`에 저장하도록 했다.
- `docs/PROMPT_STRATEGY.md`에 `navigationChange` enum 및 normalization 정책을 반영했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인이 통과했다.
- 기존 `test_plan.llm.json`을 기준으로 normalization을 수행해 `tests[13]`~`tests[22]`의 `navigationChange`를 `null`에서 `"none"`으로 보정했다.
- `python tools/ai-generator/validate_test_plan.py --input tools/ai-generator/generated/test_plan.llm.json` 실행 결과 errors 0, warnings 0으로 통과했다.
- `python tools/ai-generator/render_test_plan.py --input tools/ai-generator/generated/test_plan.llm.json --output tests/generated/generated_from_plan.spec.js` 실행 결과 renderer output 생성이 통과했다.

### 다음 작업

- 다음 `llm-plan` 실행에서 동일 유형의 `navigationChange` 누락이 자동 보정되는지 확인한다.
- LLM plan output에서 다른 schema 흔들림이 발견되면 prompt 강화와 normalization 범위를 최소 단위로 추가한다.

## 2026-07-03 - Add LLM structured plan generation mode

### 작업 목적

- `agent_orchestrator.py`에 `--generation-mode llm-plan` opt-in shadow mode를 추가한다.
- LLM이 Playwright JS 전체가 아니라 structured test plan JSON만 생성하도록 실험 경로를 만든다.
- 기존 `spec` mode와 deterministic `plan` mode는 유지한다.

### 변경 내용

- `agent_orchestrator.py`의 `--generation-mode` 선택지에 `llm-plan`을 추가했다.
- `llm-plan` mode에서 scout, menu_map 생성 후 LLM structured test plan prompt를 호출하도록 했다.
- LLM raw response를 `tools/ai-generator/generated/test_plan.llm.raw.txt`에 저장하도록 했다.
- JSON code block strip 및 JSON parse 후 `tools/ai-generator/generated/test_plan.llm.json`에 저장하도록 했다.
- parsed plan을 `validate_test_plan.py`로 검증하고 `render_test_plan.py`로 `tests/generated/generated_from_plan.spec.js`를 생성하도록 연결했다.
- `package.json`에 `ai:generate-llm-plan` script를 추가했다.
- `docs/STRUCTURED_PLAN_MIGRATION.md`와 `docs/PROMPT_STRATEGY.md`에 LLM plan shadow mode와 prompt 규칙을 반영했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인이 통과했다.
- venv 활성화와 fnm 초기화 후 `npm run ai:generate-plan -- --url https://iotbiz.kt.co.kr`를 실행해 deterministic plan mode 회귀를 확인했다.
- deterministic plan mode는 scout, pageProfile 수집, `test_plan.generated.json` build, plan validation, `generated_from_plan.spec.js` render가 통과했다.
- venv 활성화와 fnm 초기화 후 `npm run ai:generate-llm-plan -- --url https://iotbiz.kt.co.kr`를 실행했다.
- `llm-plan` mode는 scout, pageProfile 수집, `menu_map.json`/`scout_result.json` 저장까지 완료했으나 LLM API 호출 단계에서 `403 Lightning dunning decision is deny`로 실패했다.
- LLM 응답을 받기 전에 실패했으므로 `test_plan.llm.raw.txt`와 `test_plan.llm.json`은 생성되지 않았다.
- 실패 단계가 명확히 드러나도록 LLM structured plan generation 예외를 `RuntimeError`로 감싸는 처리를 추가했다.

### 다음 작업

- LLM API 권한/결제 상태가 정상화되면 `npm run ai:generate-llm-plan -- --url <target>`를 다시 실행해 raw/parsed plan artifact 생성을 확인한다.
- LLM plan output이 validate 단계에서 실패하는 경우 raw response와 parsed plan을 기준으로 prompt를 보수화한다.
- llm-plan 경로가 안정화되면 renderer output 실행 결과와 기존 spec mode 결과를 비교한다.

## 2026-07-03 - Add opt-in plan generation mode

### 작업 목적

- `agent_orchestrator.py`에 `--generation-mode spec|plan` 옵션을 추가해 structured test plan renderer 경로를 opt-in으로 실행할 수 있게 한다.
- 기본값은 `spec`으로 유지해 기존 direct JS generation 기반 `ai:generate` 흐름을 깨지 않는다.
- 이번 단계에서는 LLM plan generation을 붙이지 않고 deterministic builder path만 orchestrator에서 연결한다.

### 변경 내용

- `agent_orchestrator.py`에 `--generation-mode` CLI 옵션을 추가했다.
- `spec` mode는 기존 scout, menu_map 생성, LLM direct JS spec 생성, `generated_menu_access.spec.js` 저장 흐름을 유지한다.
- `plan` mode는 scout와 menu_map 생성 후 `build_test_plan.py`, `validate_test_plan.py`, `render_test_plan.py`를 순서대로 실행하도록 연결했다.
- plan mode output은 `tests/generated/generated_from_plan.spec.js`로 유지하고 `generated_menu_access.spec.js`는 덮어쓰지 않도록 했다.
- `package.json`에 `ai:generate-plan` script를 추가했다.
- `docs/STRUCTURED_PLAN_MIGRATION.md`에 Phase 1 deterministic builder path가 orchestrator opt-in mode로 연결되었음을 보완했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인이 통과했다.
- `npm run ai:generate -- --url https://iotbiz.kt.co.kr`는 현재 Python 환경에 `python-dotenv`와 `google-generativeai` 의존성이 없어 `ModuleNotFoundError`로 실패했다. 기존 spec mode 로직 진입 전 의존성 문제이며 이번 mode 분기 변경으로 인한 실패는 아니다.
- `npm run ai:generate-plan -- --url https://iotbiz.kt.co.kr` 실행 결과 scout, menu_map 생성, `test_plan.generated.json` build, plan validation, `generated_from_plan.spec.js` render가 통과했다.
- `npx playwright test tests/generated/generated_from_plan.spec.js` 실행 결과 41 passed를 확인했다.

### 다음 작업

- `--generation-mode plan` 경로가 안정화되면 LLM structured plan generation shadow mode를 별도 단계로 설계한다.
- 이후 `test_plan.llm.json` 저장, plan validation, renderer 연결을 검토한다.

## 2026-07-03 - Plan structured test plan orchestration migration

### 작업 목적

- `agent_orchestrator.py`를 direct JS generation에서 structured test plan JSON + deterministic renderer 방식으로 전환하기 위한 단계별 설계를 문서화한다.
- 기존 `ai:generate`, `generated_menu_access.spec.js`, `agent_orchestrator.py`, `scout.js` 동작은 변경하지 않는다.

### 변경 내용

- `docs/STRUCTURED_PLAN_MIGRATION.md`를 신규 작성했다.
- 현재 direct JS generation 구조와 목표 structured plan 구조를 비교했다.
- Phase 0 현재 상태, Phase 1 deterministic builder shadow mode, Phase 2 LLM plan shadow mode, Phase 3 opt-in plan mode, Phase 4 plan mode default 전환 단계를 정의했다.
- plan JSON parse, plan validation, renderer, generated spec validation, Playwright 실행 실패에 대한 fallback/보존 정책을 정리했다.
- 향후 `agent_orchestrator.py`에 `--generation-mode spec|plan` 옵션을 추가하는 구현 후보를 기록했다.

### 확인 결과

- 문서 작업만 수행했다.
- 코드 실행이나 테스트 실행은 수행하지 않았다.

### 다음 작업

- `agent_orchestrator.py`에 `--generation-mode spec|plan` 옵션을 추가하되 기본값은 `spec`으로 유지하는 opt-in 전환 작업을 검토한다.
- LLM plan output을 `test_plan.llm.json`으로 저장하고 `validate_test_plan.py`, `render_test_plan.py`와 연결하는 shadow mode 구현을 설계한다.

## 2026-07-03 - Conservative template selection for renderer path

### 작업 목적

- renderer 기반 산출물 `tests/generated/generated_from_plan.spec.js`를 실제 Playwright 실행 기준으로 검증한다.
- 실행 결과를 바탕으로 `build_test_plan.py`의 template 선택 기준을 보수적으로 조정한다.
- 기존 `ai:generate`, `generated_menu_access.spec.js`, `agent_orchestrator.py`, `scout.js` 흐름은 변경하지 않는다.

### 변경 내용

- `build_test_plan.py`에서 heading이 존재한다는 이유만으로 `navigation.headingIdentity`를 선택하지 않도록 조정했다.
- headingIdentity는 heading text가 `menuPath` leaf text와 exact match되는 경우에만 선택하도록 변경했다.
- depth3 child가 `ngClick`을 가지고 있거나 href가 비어 있는 tab-like 메뉴이면 heading보다 `navigation.tabIdentity`를 우선하도록 변경했다.
- tabIdentity는 exact menuPath pageProfile의 tabs cssPath를 우선 사용하고, tabs 근거가 없지만 click cssPath가 있으면 `navigationChange: "unknown"`으로 보수 처리하도록 했다.
- contentIdentity는 `MAIN` 또는 너무 넓은 subContainer 대신 더 구체적인 main/content container cssPath를 선택하도록 조정했다.
- sibling pageProfile selector fallback 금지 원칙은 유지했다.

### 확인 결과

- 보수화 전 renderer 기반 spec 실행 결과 `npx playwright test tests/generated/generated_from_plan.spec.js`에서 41 passed를 확인했다.
- 보수화 후 `npm run ai:plan` 실행 결과 build, validate, render가 모두 통과했다.
- 보수화 후 `test_plan.generated.json` template 분포는 `navigation.headingIdentity` 20건, `navigation.contentIdentity` 11건, `navigation.tabIdentity` 10건으로 조정되었다.
- 보수화 후 `npx playwright test tests/generated/generated_from_plan.spec.js` 실행 결과 41 passed를 확인했다.

### 다음 작업

- renderer 기반 spec의 visual/debug 확인을 별도로 수행할지 검토한다.
- 이후 `agent_orchestrator.py`를 LLM JS 생성에서 structured test plan JSON 생성으로 전환하는 범위를 설계한다.

## 2026-07-03 - Clarify structured test plan npm scripts

### 작업 목적

- example fixture 검증과 실제 `test_plan.generated.json` 검증/렌더링 명령을 분리해 혼동을 줄인다.
- `ai:build-plan` 이후 generated plan을 검증하고 렌더링하는 표준 명령을 명확히 한다.

### 변경 내용

- `package.json`에 `ai:validate-generated-plan` script를 추가했다.
- `package.json`에 `ai:render-generated-plan` script를 추가했다.
- `package.json`에 build, validate, render를 순서대로 실행하는 `ai:plan` script를 추가했다.
- 기존 `ai:validate-plan`은 `test_plan.example.json` fixture 검증용으로 유지했다.
- 기존 `ai:generate`, `ai:validate`, `test:generated` 흐름은 변경하지 않았다.

### 확인 결과

- 현재 셸에서 `npm`이 PATH에 없어 `npm run ai:build-plan`, `npm run ai:validate-generated-plan`, `npm run ai:render-generated-plan`, `npm run ai:plan`은 실행하지 못했다.
- Python 직접 실행 경로는 이전 작업에서 `build -> validate --input test_plan.generated.json -> render --input test_plan.generated.json` 순서로 통과 확인했다.

### 다음 작업

- npm이 사용 가능한 로컬 셸에서 `npm run ai:plan`으로 generated plan 전체 흐름을 확인한다.
- README 또는 운영 문서 갱신 시 example fixture용 명령과 generated plan용 명령을 분리해서 안내한다.

## 2026-07-03 - Build structured test plan from menu_map

### 작업 목적

- 실제 `menu_map.json`의 `primaryMenuTree`와 `pageProfiles`를 기반으로 structured test plan JSON을 deterministic하게 생성하는 실험용 builder를 추가한다.
- LLM 호출 없이 `test_plan.generated.json`을 만들고, 기존 validator/renderer 흐름으로 이어질 수 있게 한다.
- 기존 `ai:generate`, `generated_menu_access.spec.js`, `scout.js` 흐름은 변경하지 않는다.

### 변경 내용

- `tools/ai-generator/build_test_plan.py`를 신규 추가했다.
- 기본 입력은 `tools/ai-generator/generated/menu_map.json`, 기본 출력은 `tools/ai-generator/generated/test_plan.generated.json`로 설정했다.
- `primaryMenuTree`의 depth2 parent와 depth3 child를 모두 test case로 변환한다.
- 각 test case는 `menuPath` 기준으로 `pageProfiles`와 exact match를 수행한다.
- heading, mainContainer, tabs, TODO 순서로 template을 결정하고, sibling pageProfile selector fallback은 사용하지 않도록 했다.
- `validate_test_plan.py`에 `--input` 옵션을 추가해 generated plan을 검증할 수 있게 했다.
- `package.json`에 `ai:build-plan` script를 추가했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/build_test_plan.py` 문법 확인을 통과했다.
- `python -m py_compile tools/ai-generator/validate_test_plan.py` 문법 확인을 통과했다.
- `python tools/ai-generator/build_test_plan.py` 실행 결과 `test_plan.generated.json`이 생성되었고 test case 41건을 확인했다.
- `python tools/ai-generator/validate_test_plan.py --input tools/ai-generator/generated/test_plan.generated.json` 실행 결과 errors 0, warnings 0으로 통과했다.
- `python tools/ai-generator/render_test_plan.py --input tools/ai-generator/generated/test_plan.generated.json --output tests/generated/generated_from_plan.spec.js` 실행 결과 renderer 출력 생성을 확인했다.
- 현재 셸에서 `npm`이 PATH에 없어 `npm run ai:build-plan`, `npm run ai:validate-plan`, `npm run ai:render-plan`은 실행하지 못했다.

### 다음 작업

- 실제 `test_plan.generated.json` 기반 renderer 출력 spec을 리뷰하고, template 선택 기준을 보수적으로 조정할지 검토한다.
- 이후 단계에서 LLM이 JS가 아니라 structured test plan JSON을 생성하도록 `agent_orchestrator.py` 전환 범위를 설계한다.

## 2026-07-03 - Add deterministic test plan renderer draft

### 작업 목적

- structured test plan JSON을 입력으로 받아 Playwright spec을 생성하는 deterministic renderer 초안을 추가한다.
- 기존 `ai:generate`, generated spec 생성, `ai:validate`, `test:generated` 흐름은 변경하지 않는다.

### 변경 내용

- `tools/ai-generator/render_test_plan.py`를 신규 추가했다.
- 기본 입력은 `tools/ai-generator/generated/test_plan.example.json`, 기본 출력은 `tests/generated/generated_from_plan.spec.js`로 설정했다.
- `navigation.urlOnly`, `navigation.headingIdentity`, `navigation.contentIdentity`, `navigation.tabIdentity`, `navigation.todoIdentity` 렌더링을 지원한다.
- renderer가 CommonJS import, `BASE_URL`, `test.beforeEach`, URL assertion helper, click helper 호출, Page Identity assertion, TODO comment 형식을 고정하도록 했다.
- `package.json`에 `ai:render-plan` script를 추가했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/render_test_plan.py` 문법 확인을 통과했다.
- `python tools/ai-generator/validate_test_plan.py` 실행 결과 errors 0, warnings 0으로 통과했다.
- `python tools/ai-generator/render_test_plan.py` 실행 후 `tests/generated/generated_from_plan.spec.js`가 생성되는 것을 확인했다.
- 생성된 spec에서 `BASE_URL`, URL assertion helper, click helper 호출, heading/content/tab/TODO 렌더링 형식을 확인했다.
- 현재 셸에서 `npm`이 PATH에 없어 `npm run ai:render-plan`은 실행하지 못했다.

### 다음 작업

- 실제 target URL 기반 test plan JSON 생성 단계와 연결하기 전에 renderer 출력 형식을 리뷰한다.
- future 단계에서 `agent_orchestrator.py`가 LLM에게 JS가 아니라 test plan JSON을 요청하도록 점진 전환한다.

## 2026-07-03 - Add structured test plan validator draft

### 작업 목적

- future renderer 구현 전에 structured test plan JSON이 schema 계약을 지키는지 확인할 수 있는 초안 validator를 추가한다.
- 기존 `ai:generate`, generated spec 생성, `ai:validate`, `test:generated` 흐름은 변경하지 않는다.

### 변경 내용

- `tools/ai-generator/validate_test_plan.py`를 신규 추가했다.
- 기본 검증 대상은 `tools/ai-generator/generated/test_plan.example.json`으로 설정했다.
- top-level 필드, test case 공통 필드, click 구조, template별 필수 필드를 검사한다.
- `navigation.tabIdentity`에서 `navigationChange`가 `"expected"`인데 `assertions.url.href`가 없으면 warning으로 출력하도록 했다.
- `package.json`에 `ai:validate-plan` script를 추가했다.
- `docs/TEST_PLAN_SCHEMA.md`에 validator 실행 명령과 tabIdentity URL warning 정책을 추가했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/validate_test_plan.py` 문법 확인을 통과했다.
- `python tools/ai-generator/validate_test_plan.py` 실행 결과 errors 0, warnings 0으로 통과했다.
- 현재 셸에서 `npm`이 PATH에 없어 `npm run ai:validate-plan`은 실행하지 못했다.

### 다음 작업

- renderer 구현 전 test plan validator 규칙을 실제 LLM 출력 후보에 맞춰 보강한다.
- future renderer가 test plan을 입력으로 받기 시작하면 validator를 renderer 앞단 quality gate로 연결한다.

## 2026-07-03 - Sanitize structured test plan examples

### 작업 목적

- structured test plan 문서와 example JSON에서 실제 사이트, 서비스, 메뉴, selector를 유추할 수 있는 값을 제거한다.
- `test_plan.example.json`을 renderer/validator 개발용 안전 fixture로 유지한다.

### 변경 내용

- `docs/TEST_PLAN_SCHEMA.md` 예시를 `https://example.test`, `Products`, `Support`, `Resources` 등 가상 데이터로 정리했다.
- `docs/TEST_TEMPLATE_CATALOG.md` 템플릿 예시를 실제 서비스 성격이 드러나지 않는 중립 값으로 교체했다.
- `tools/ai-generator/generated/test_plan.example.json`의 route, selector, id, `ngClick`, menuPath를 모두 가상 fixture 값으로 변경했다.
- example JSON은 실제 scout 결과가 아니라 schema 설명, LLM 출력 예시, future renderer/validator fixture라는 원칙을 문서화했다.

### 확인 결과

- `test_plan.example.json` JSON 파싱 확인이 필요하다.
- 실제 사이트 유추 문자열이 structured test plan 문서와 example JSON에 남아 있지 않은지 검색 확인이 필요하다.

### 다음 작업

- future renderer 구현 시 이 fixture를 초기 입력 샘플로 사용한다.
- renderer/validator 구현이 시작되면 schema 필수 필드와 fixture를 함께 갱신한다.

## 2026-07-03 - Define structured test plan schema

### 작업 목적
- LLM이 Playwright spec 전체를 자유 생성하는 구조를 줄이기 위한 중간 산출물 계약을 정의한다.
- 향후 deterministic renderer가 test plan JSON을 기반으로 generated spec을 만들 수 있도록 schema와 template catalog를 먼저 고정한다.

### 변경 내용
- `docs/TEST_PLAN_SCHEMA.md`를 추가해 structured test plan JSON의 목적, top-level 구조, test case 구조, click/assertion 규칙을 정의했다.
- `docs/TEST_TEMPLATE_CATALOG.md`를 추가해 초기 navigation template 목록을 정의했다.
- `tools/ai-generator/generated/test_plan.example.json`을 추가해 schema 예시 fixture를 제공했다.
- `.gitignore`에서 generated 산출물은 제외하되 `test_plan.example.json`은 추적하도록 예외 처리했다.

### Template Scope
- `navigation.urlOnly`
- `navigation.headingIdentity`
- `navigation.contentIdentity`
- `navigation.tabIdentity`
- `navigation.todoIdentity`

### Design Decision
- 현재 `ai:generate` 동작은 변경하지 않는다.
- 이번 작업은 renderer 구현 전 계약 문서화 단계다.
- LLM은 향후 JS 코드가 아니라 template 선택과 structured field 작성을 담당한다.
- URL 처리, heading exact, selector fallback 방지, Playwright helper 생성은 future renderer 책임으로 분리한다.

### 확인 결과
- `python -m json.tool tools/ai-generator/generated/test_plan.example.json`
- Existing runtime flow unchanged.

## 2026-07-01 - Require target URL input for generation

### 작업 목적

- 도구 코드 내부의 특정 서비스 도메인 기본값을 제거하고, target URL을 명시 입력으로 받도록 정리한다.
- generated spec은 생성 당시 target URL을 포함할 수 있는 target-specific 산출물로 유지한다.

### 변경 내용

- `agent_orchestrator.py`에 `--url` CLI 인자 처리를 추가했다.
- target URL 입력 우선순위를 CLI `--url`, 환경변수 `TARGET_URL` 순서로 정리하고, 둘 다 없으면 명확한 에러 메시지와 사용 예시를 출력하도록 했다.
- scout 실행과 primary pageProfile scout 실행에는 입력받은 target URL을 그대로 전달하도록 유지했다.
- generated spec prompt는 `BASE_URL` override 또는 생성 당시 target URL fallback을 사용하도록 정리했다.
- `docs/PROMPT_STRATEGY.md`에 도구 코드는 URL을 입력으로 받고, generated spec은 생성 당시 target URL을 포함할 수 있다는 원칙을 추가했다.

### 확인 결과

- 문법 확인을 수행했다.
- `package.json`의 `ai:generate` script는 `npm run ai:generate -- --url https://target.example.com` 형태의 추가 인자를 Python으로 전달할 수 있는 기존 형태라 수정하지 않았다.
- 실제 `npm run ai:generate`, `npm run ai:validate`, `npm run test:generated`는 사용자 환경에서 확인이 필요하다.

### 다음 작업

- `npm run ai:generate`를 URL 없이 실행했을 때 명확히 실패하는지 확인한다.
- `npm run ai:generate -- --url https://target.example.com` 또는 `$env:TARGET_URL="https://target.example.com"; npm run ai:generate`로 생성 흐름을 확인한다.
- 생성 후 `npm run ai:validate`와 `npm run test:generated`를 실행해 기존 Level 1/2 동작을 확인한다.

## 2026-06-30 - Prevent sibling pageProfile selector fallback

### 작업 목적

- generated spec이 같은 parent 아래 depth3 child들의 Page Identity selector를 공통 fallback으로 섞어 쓰면서, 특정 child 페이지에 존재하지 않는 selector를 검증하는 문제를 방지한다.
- child별 Page Identity assertion은 해당 child `menuPath`에 매칭되는 pageProfile만 근거로 생성하도록 prompt 규칙을 강화한다.

### 변경 내용

- `agent_orchestrator.py` prompt에 sibling child의 pageProfile selector를 fallback으로 사용하지 말라는 규칙을 추가했다.
- loop 내부에서 child별 Page Identity selector가 다르면 `if (child.text === '...')` 또는 `else if` 분기 안에서 해당 child selector만 사용하도록 명시했다.
- 모든 child pageProfile에서 같은 cssPath가 확인되는 경우에만 공통 assertion을 허용하고, 불확실하면 TODO를 남기도록 했다.
- `if contentArea visible else noticeArea` 같은 cross-sibling fallback chain 생성을 금지했다.
- `docs/PROMPT_STRATEGY.md`에 동일한 규칙을 반영했다.

### 확인 결과

- 문법 확인만 수행했다.
- 테스트 실행, `npm run ai:generate`, `npm run ai:validate`는 수행하지 않았다.

### 다음 작업

- `npm run ai:generate` 후 공유 메뉴 child loop에서 sibling selector fallback이 생성되지 않는지 확인한다.
- `npm run ai:validate`와 `npm run test:generated`로 validator 통과와 9 passed 여부를 확인한다.

## 2026-06-30 - PrimaryMenuTree based pageProfile collection

### 작업 목적

- broad scout discovery와 primaryNavigation projection 분리 이후 `pageProfiles`가 generated spec 대상 메뉴와 연결되지 않아 Level 2 Page Identity assertion과 visual highlight가 거의 생성되지 않는 문제를 보완했다.
- Level 2 Page Identity 후보를 generated spec 대상인 `primaryMenuTree` 기준으로 다시 수집하도록 했다.

### 변경 내용

- `scout.js`에 `--profile-tree` 모드를 추가해 primary menu tree를 입력받아 parent/child menuPath 기준으로 pageProfiles를 수집하도록 했다.
- pageProfile 수집 시 각 target마다 시작 URL로 돌아간 뒤, `hoverTargetCssPath` 또는 `depth1Index`를 사용해 메뉴를 open하고 대상 메뉴를 클릭하도록 했다.
- broad discovery 단계에서는 `elements` 수집에 집중하고, pageProfiles는 primary tree 생성 이후 별도 profile scout 호출 결과로 채우도록 분리했다.
- `agent_orchestrator.py`는 `primaryMenuTree` 생성 후 profile scout를 다시 호출하고, 그 결과를 `scout_result.json`과 `menu_map.json`에 반영한다.
- `docs/DATA_FLOW.md`, `docs/JSON_SCHEMA.md`, `docs/PROMPT_STRATEGY.md`에 pageProfiles가 `primaryMenuTree` 기준으로 수집/매칭된다는 규칙을 보강했다.

### 확인 결과

- 문법 확인만 수행했다.
- 테스트 실행, `npm run ai:generate`, `npm run ai:validate`는 수행하지 않았다.

### 다음 작업

- `npm run ai:generate` 후 `menu_map.json`의 `pageProfiles`가 primary parent/child menuPath 기준으로 여러 건 생성되는지 확인한다.
- `npm run ai:validate`, `npm run test:generated`, `npm run test:generated:visual`로 Page Identity assertion과 `highlightPageIdentity` 복원을 확인한다.

## 2026-06-30 - depth1Index hover target inference fix

### 작업 목적

- generated spec이 모든 primary navigation parent에 동일한 `depth1Index`를 사용해 일부 GNB submenu가 hidden 상태로 남는 문제를 보완했다.
- `depth1Index`를 `navigationGroupIndex`가 아니라 실제 hover/open 해야 하는 top-level navigation item index로 추론하도록 정리했다.

### 변경 내용

- `scout.js`에서 DOM ancestor를 따라 가장 바깥쪽 navigation `li`를 찾고, 해당 sibling index를 `depth1Index`로 저장하도록 변경했다.
- `hoverTargetCssPath`와 `openTriggerCssPath`를 함께 수집해 hover target 추론 결과를 사람이 확인할 수 있게 했다.
- `navigationGroupIndex`는 projection/grouping 식별자로만 유지하고, hover index로 사용하지 않도록 분리했다.
- `agent_orchestrator.py`가 `hoverTargetCssPath`와 `openTriggerCssPath`를 `menu_map.json`까지 보존하도록 했다.
- prompt에 `navigationGroupIndex`를 `openDepth1ByIndex` 인자로 사용하지 말고, `depth1Index`가 number일 때만 open helper를 호출하도록 명시했다.
- `docs/JSON_SCHEMA.md`와 `docs/DATA_FLOW.md`에 `depth1Index`, `navigationGroupIndex`, `hoverTargetCssPath`, `openTriggerCssPath`의 의미를 보강했다.

### 확인 결과

- 문법 확인만 수행했다.
- 테스트 실행, `npm run ai:generate`, `npm run ai:validate`는 수행하지 않았다.

### 다음 작업

- `npm run ai:generate` 후 `menu_map.json`에서 primary parent들의 `depth1Index`가 실제 top-level hover 대상별로 분리되는지 확인한다.
- 이후 `npm run ai:validate`, `npm run test:generated`, `npm run test:generated:visual` 순서로 재생성 결과를 확인한다.

## 2026-06-29 - Primary navigation candidate classification fix

### 작업 목적

- framework-agnostic scout가 header/main/footer 후보를 넓게 수집한 뒤, Level 1/2 generated spec 대상이 아닌 trigger/logo/footer/CTA 후보까지 `primaryMenuTree`에 섞이는 문제를 보완했다.
- `메뉴` 같은 hamburger/trigger button이 primary navigation parent가 되고 모든 child가 그 아래로 몰리는 상황을 방지했다.

### 변경 내용

- `agent_orchestrator.py`에서 각 menu 후보에 `candidateKind`와 `navigationRole`을 채우도록 했다.
- 후보를 `primaryNavigation`, `primaryNavigationItem`, `navigationTrigger`, `logoHome`, `quickLink`, `contentCta`, `footerLink`, `utilityLink`, `unknown`으로 분류한다.
- `navigationTrigger`와 `logoHome`은 `primaryMenuTree` parent가 될 수 없도록 제외했다.
- parent-child 관계는 navigation group, DOM index 순서, parentText에 포함된 child text를 기준으로 best-effort 재구성한다.
- 확실히 묶을 수 없는 primary 후보는 generic parent 아래에 붙이지 않고 `unresolvedPrimaryNavigationCandidates`로 보존한다.
- `docs/JSON_SCHEMA.md`와 `docs/DATA_FLOW.md`에 candidate classification과 unresolved 후보 보존 방식을 보강했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인을 통과했다.
- 기존 `scout_result.json` 기준 dry-run projection에서 전체 menus 62개, primary parent 9개, primary child 32개로 계산되는 것을 확인했다.
- `메뉴` trigger는 `primaryMenuTree` parent에서 제외되는 것을 확인했다.
- 테스트 실행, `npm run ai:generate`, `npm run ai:validate`는 수행하지 않았다.

### 다음 작업

- 사용자가 `npm run ai:generate` 후 `menu_map.json`에서 `candidateKind` 분포와 `primaryMenuTree` 구조를 확인한다.
- 이후 `npm run ai:validate`로 footer/main CTA/quick link가 generated GNB coverage 대상으로 잡히지 않는지 확인한다.

## 2026-06-29 - Primary navigation projection for generated specs

### 작업 목적

- framework-agnostic scout가 header/main/footer 후보를 넓게 수집한 뒤, 모든 후보가 Level 1/2 generated GNB spec 대상으로 들어가는 문제를 수정한다.
- scout 수집 범위는 유지하면서 `agent_orchestrator.py`에서 생성 목적별 projection을 만들어 primary navigation만 generated spec 입력으로 사용한다.

### 변경 내용

- `menu_map.json` 구조에 `primaryMenuTree`, `primaryMenus`, `linkCandidates`, `ctaCandidates`, `footerLinks`, `nonPrimaryNavigationCandidates`, `excludedNavigationCandidates`를 추가했다.
- validator 호환을 위해 `menuTree`는 `primaryMenuTree`와 동일하게 저장하도록 했다.
- `menus`에는 scout가 수집한 전체 navigation/action 후보를 보존한다.
- Level 1/2 generated spec 입력은 `primaryMenuTree`만 사용하도록 `build_menu_generation_input`을 변경했다.
- primary navigation 후보는 header/nav region, menuDepth 2/3, navigation group 존재, 짧고 안정적인 text 기준으로 필터링한다.
- main/footer/unknown region 후보, footer/policy 성격 text, brand/home/quick/utility 성격 후보, 긴 설명형 text는 primary 생성 대상에서 제외하고 별도 후보 목록에 보존한다.
- depth3 child는 parent와 navigation group 또는 depth1Index가 일치할 때만 붙여, logo/home link 아래 모든 child가 몰리는 상황을 줄였다.
- `docs/DATA_FLOW.md`, `docs/JSON_SCHEMA.md`, `docs/TEST_GENERATION_RULES.md`, `docs/MODULE_MAP.md`에 생성 목적별 projection 원칙을 반영했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인을 수행했다.
- 기존 `scout_result.json` 기준 projection count를 저장 없이 계산해 전체 후보와 primary/non-primary 분리가 되는 것을 확인했다.
- 테스트 실행, `npm run ai:generate`, `npm run ai:validate`는 수행하지 않았다.

### 다음 작업

- 사용자가 `npm run ai:generate` 후 `menu_map.json`에서 `menus` 전체 후보와 `primaryMenuTree` 생성 대상이 분리되었는지 확인한다.
- `npm run ai:validate`에서 footer/main CTA/quick link가 E103 coverage 대상으로 잡히지 않는지 확인한다.

## 2026-06-29 - Framework-agnostic scout discovery

### 작업 목적

- `scout.js`의 core discovery 로직을 특정 사이트 class 구조나 특정 프레임워크 selector에 의존하지 않도록 개선한다.
- 임의의 target URL에서 렌더링된 DOM을 구조화된 후보 데이터로 수집하는 범용 WEB 자동 테스트 AX 패키지 방향에 맞춘다.

### 변경 내용

- Angular 전용 wait selector와 로그를 제거하고, networkidle best-effort, visible interactive element count, DOM mutation 안정화 대기를 조합한 framework-agnostic wait로 변경했다.
- navigation 후보 수집을 특정 class selector 직접 의존에서 `nav`, `header`, navigation/menu role, `a[href]`, navigation 가능성이 있는 button 중심으로 변경했다.
- class명에 nav/menu/dropdown/sidebar/header 계열 단어가 있는 경우는 core dependency가 아니라 discovery signal로만 사용하도록 했다.
- menuDepth와 depth1Index는 특정 class가 아니라 navigation region/group, DOM hierarchy, list nesting, role, href/onClick/aria-haspopup 정보를 기반으로 best-effort 추론하도록 했다.
- `elements`에 `semanticRegion`, `navigationGroupIndex`, `inferredMenuDepth`, `confidence`, `discoveryReason`을 추가했다.
- pageProfile의 common layout 제외 기준을 header/footer/nav/aside/role navigation 중심으로 범용화했다.
- `docs/DATA_FLOW.md`와 `docs/MODULE_MAP.md`에서 특정 selector 기반 depth1Index 설명을 제거하고 navigation region/group 기반 추론으로 갱신했다.

### 확인 결과

- 테스트 실행과 `npm run ai:generate`는 수행하지 않았다.
- `node -c tools/ai-generator/scout.js` 문법 확인을 시도했으나 현재 셸에서 `node`가 PATH에 없어 실행하지 못했다.
- 지정 문자열 검색 결과 `scout.js`에는 `menuContainer`, `depth1`, `depth2`, `depth3`, `ng-controller`, `ng-app`, `ng-scope` core dependency가 남아 있지 않다.

### 다음 작업

- 실제 target URL에서 `scout_result.json`의 `semanticRegion`, `navigationGroupIndex`, `inferredMenuDepth`, `confidence`, `discoveryReason`이 기대대로 생성되는지 확인한다.
- hover exploration은 아직 best-effort 후보 판정 단계이므로, 필요한 경우 별도 작업으로 확장한다.

## 2026-06-29 - Generic depth1Index inference

### 작업 목적

- 특정 사이트 메뉴명에 의존하던 `DEPTH1_INDEX_MAP`을 제거하고, 대상 URL의 DOM 구조에서 depth1Index를 자동 추론하도록 개선한다.

### 변경 내용

- `agent_orchestrator.py`에서 특정 메뉴명 기반 `DEPTH1_INDEX_MAP`을 제거했다.
- `scout.js`가 navigation region/group과 DOM hierarchy를 기준으로 `depth1Index`를 추론해 element/menu/pageProfile 후보에 보존하도록 했다.
- `build_menu_tree`는 hard-coded map 대신 scout가 수집한 `depth1Index`를 사용하도록 변경했다.
- depth3 child는 자체 `depth1Index`가 없으면 직전 depth2 parent의 `depth1Index`를 상속하도록 했다.
- `depth1Index` 추론이 실패한 경우 generated prompt가 `openDepth1ByIndex(page, null)`을 만들지 않고 TODO를 남기도록 안내했다.
- `docs/MODULE_MAP.md`와 `docs/DATA_FLOW.md`에 depth1Index 자동 추론 흐름을 반영했다.

### 확인 결과

- 문법 확인만 수행했다.
- 테스트 실행과 generated spec 재생성은 수행하지 않았다.

### 다음 작업

- `npm run ai:generate` 후 `menu_map.json`의 depth2/depth3 항목에 `depth1Index`가 기대대로 채워지는지 확인한다.
- 추론이 불가능한 사이트에서는 generated spec이 null index 호출 대신 TODO를 남기는지 확인한다.

## 2026-06-25 - Documentation refresh for Level 2 and validation gate

### 작업 목적

- Level 2 Page Identity MVP와 Generated Spec Validator 구현 이후 README와 주요 docs를 현재 구현 상태에 맞게 현행화한다.
- 프로젝트 방향을 특정 사이트 산출물이 아니라 임의의 대상 URL을 입력받는 범용 WEB 자동 테스트 AX 패키지로 정리한다.

### 변경 내용

- `README.md`에 현재 구현 상태를 Level 1 Navigation Smoke Test, Level 2 Page Identity Test MVP, Generated Spec Validation Gate로 정리했다.
- 실행 흐름을 `npm run ai:generate` -> `npm run ai:validate` -> `npm run test:generated` -> `npm run test:generated:visual` 기준으로 최신화했다.
- validator 실패 시 generated spec을 직접 수정하지 않고 prompt, scout/pageProfile 수집, validator 규칙을 보완한 뒤 재생성하는 흐름을 명시했다.
- `docs/TEST_LEVELS.md`에 Level 2 MVP와 validator 품질 게이트 상태를 반영하고, smoke/regression 승격 기준에 `ai:validate` 통과를 포함했다.
- `docs/DATA_FLOW.md`, `docs/MODULE_MAP.md`, `docs/TEST_GENERATION_RULES.md`, `docs/PLAYWRIGHT_CONVENTION.md`, `docs/GENERATED_SPEC_VALIDATION.md`를 현재 파이프라인과 범용 대상 URL 관점으로 정리했다.

### 확인 결과

- 문서 작업만 수행했으며 테스트 실행은 하지 않았다.
- 코드 파일, generated spec, sample/example 디렉터리는 수정하지 않았다.

### 다음 작업

- 실제 사용 흐름에서 README의 명령 순서가 충분히 자연스러운지 확인한다.
- Level 3 Safe Interaction Test 설계가 시작되면 TEST_LEVELS와 관련 schema 문서를 별도로 확장한다.

## 2026-06-24 - Page Identity selector shortening prompt guard

### 작업 목적

- generated spec에서 공유 메뉴 Page Identity assertion에 `pageProfiles`에 없는 축약 selector가 생성되어 W201 warning이 남는 문제를 prompt 규칙으로 보완한다.

### 변경 내용

- `agent_orchestrator.py` prompt에 Page Identity용 `page.locator(...)` selector는 반드시 `pageProfiles`에 수집된 `cssPath` 하나와 완전히 동일해야 한다고 명시했다.
- 수집된 `cssPath`의 뒤쪽 segment를 제거해 상위 parent/content selector로 축약하지 않도록 했다.
- 여러 메뉴에 공통으로 쓸 selector를 임의 생성하지 않도록 했다.
- 공유 > 자료실/공지사항/FAQ처럼 안정적인 content `cssPath`를 하나 고르기 어렵다면 assertion과 highlight를 만들지 말고 TODO만 남기도록 했다.
- `docs/PROMPT_STRATEGY.md`에 같은 selector 보존 규칙을 반영했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/agent_orchestrator.py` 문법 확인을 수행했다.
- 테스트 실행과 `npm run ai:validate`는 수행하지 않았다.

### 다음 작업

- 사용자가 `npm run ai:generate` 후 `npm run ai:validate`를 실행해 공유 메뉴의 축약 selector W201 warning이 사라지는지 확인한다.
- generated spec에 `page.locator('selector1, selector2')` 또는 pageProfiles에 없는 공통 content selector가 생성되지 않는지 확인한다.

## 2026-06-24 - Validator standard children loop format support

### 작업 목적

- generated spec이 parent test 내부의 `const children = [...]`와 `for (const child of children)` 표준 loop 형식으로 depth3 메뉴를 생성할 때 E101/E103 false positive가 발생하지 않도록 보완한다.

### 변경 내용

- `validate_generated_spec.py`가 같은 이름의 `children` 배열을 전역으로 덮어쓰지 않고, 각 loop 바로 앞의 정적 배열 인스턴스를 찾아 사용하도록 했다.
- `const children = [...]` 배열의 `text/cssPath`와 `for (const child of children)` loop 내부 `clickVisibleSubMenuByText(page, parentText, child.text, { ... cssPath: child.cssPath ... })` 패턴을 정상 coverage로 인정하도록 했다.
- `test.step(\`Depth 3: ${child.text}\`)` 형식을 depth3 step coverage로 인정하도록 했다.
- `agent_orchestrator.py` prompt에 depth3 반복 생성 표준 포맷을 고정했다.
- pageProfile selector를 `page.locator('selector1, selector2')`처럼 합성하지 말고 하나의 수집 `cssPath`만 사용하거나 TODO를 남기도록 명시했다.
- `docs/GENERATED_SPEC_VALIDATION.md`와 `docs/PROMPT_STRATEGY.md`에 표준 loop 포맷과 selector 합성 금지 규칙을 반영했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/validate_generated_spec.py` 문법 확인을 수행했다.
- 테스트 실행과 `npm run ai:validate` 실행은 수행하지 않았다.

### 다음 작업

- 사용자가 `npm run ai:generate` 후 `npm run ai:validate`를 실행해 표준 loop 포맷에서 E101/E103 false positive가 사라졌는지 확인한다.
- 복합 selector warning이 의도한 W201로 남는지 확인한다.

## 2026-06-24 - Validator computed loop cssPath rule

### 작업 목적

- loop 기반 generated spec은 coverage로 인정하되, depth3 menu `cssPath`를 `id` 기반 template/string 연산으로 계산하는 패턴은 금지하도록 validator와 prompt를 보완한다.

### 변경 내용

- `agent_orchestrator.py` prompt에 loop 기반 depth3 배열을 만들 때 `menu_map`의 `child.cssPath`를 literal field로 포함하도록 명시했다.
- `cssPath: `a#\\3${tab.id.replace('_', ' _')}`` 같은 id 기반 계산식을 금지 예시로 추가했다.
- `validate_generated_spec.py`에서 loop step coverage는 정적 배열의 `text`와 `${item.text}` step으로 인정하도록 분리했다.
- loop click options가 `cssPath: item.cssPath`가 아니라 계산식이면 E101 대신 E104 `Computed cssPath is not allowed`로 리포트하도록 했다.
- `docs/GENERATED_SPEC_VALIDATION.md`와 `docs/PROMPT_STRATEGY.md`에 loop 허용 조건과 cssPath 계산 금지 규칙을 추가했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/validate_generated_spec.py` 문법 확인을 수행했다.
- 테스트 실행과 `npm run ai:validate` 실행은 수행하지 않았다.

### 다음 작업

- generated spec 재생성 후 정적 배열에 `cssPath` literal이 포함되고 click options에서 `tab.cssPath`를 사용하는지 확인한다.
- 사용자가 `npm run ai:validate`를 실행해 E104가 사라지고 실제 누락만 error로 남는지 확인한다.

## 2026-06-24 - Validator static array loop coverage support

### 작업 목적

- generated spec이 일부 depth3 메뉴를 literal call이 아니라 정적 배열 + `for...of` loop로 생성할 때 E101/E103 false positive가 발생하는 문제를 보완한다.

### 변경 내용

- `validate_generated_spec.py`가 `const modemChildren = [...]` 같은 정적 배열의 `text`와 `cssPath`를 읽도록 했다.
- loop 내부 `clickVisibleSubMenuByText(page, parentText, child.text, { ... cssPath: child.cssPath ... })` 패턴을 depth3 cssPath coverage로 인정하도록 했다.
- loop 내부 `test.step(\`depth3: ${child.text} ...\`)` 패턴을 menuTree step coverage로 인정하도록 했다.
- literal `clickVisibleSubMenuByText(...)` parser를 regex 기반에서 괄호 균형 기반 parser로 바꿔 줄바꿈, 공백, options object가 있어도 안정적으로 인식하도록 했다.
- 기존 금지 selector 검사, depth3 단독 click 금지 검사, pageProfile selector warning 검사는 유지했다.
- `docs/GENERATED_SPEC_VALIDATION.md`에 정적 배열 + loop generated spec 허용 규칙을 추가했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/validate_generated_spec.py` 문법 확인을 수행했다.
- `python tools/ai-generator/validate_generated_spec.py` 직접 실행 결과 errors 0, warnings 0으로 `validation passed`를 확인했다.
- 현재 셸에서는 `npm`이 PATH에 없어 `npm run ai:validate`는 실행하지 못했다.

### 다음 작업

- npm이 PATH에 잡힌 환경에서 `npm run ai:validate`를 실행해 같은 결과가 나오는지 확인한다.
- 더 복잡한 동적 loop generated spec이 생기면 warning 처리 기준을 추가한다.

## 2026-06-24 - Validator W201 menu cssPath false positive fix

### 작업 목적

- `a#\\35 G`처럼 `menuTree`의 depth3 메뉴 클릭용 `cssPath`가 pageProfiles 목록에 없다는 이유로 W201 warning이 발생하는 false positive를 보완한다.

### 변경 내용

- `validate_generated_spec.py`의 W201 검사에서 `pageProfiles` cssPath뿐 아니라 `menuTree` depth2/depth3 메뉴 `cssPath`도 허용 selector 목록에 포함하도록 했다.
- 메뉴 클릭용 selector와 Page Identity selector를 구분해, `clickVisibleSubMenuByText` options에 쓰이는 메뉴 `cssPath`가 W201로 보고되지 않도록 했다.
- JavaScript 문자열 escaping 때문에 `a#\\35 G`가 spec 소스에서 `a#\\\\35 G`처럼 보이는 경우를 정규화해 같은 CSS selector로 비교하도록 했다.
- 기존 금지 selector error, depth3 cssPath 누락 error, step coverage 검사는 유지했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/validate_generated_spec.py` 문법 확인을 수행했다.
- `python tools/ai-generator/validate_generated_spec.py` 직접 실행 결과 errors 0, warnings 0으로 `validation passed`를 확인했다.
- 현재 셸에서는 `npm`이 PATH에 없어 `npm run ai:validate`는 실행하지 못했다.

### 다음 작업

- validator warning 기준이 실제 generated spec 변화에 맞게 과하거나 느슨하지 않은지 계속 조정한다.

## 2026-06-24 - Generated Spec Validator quality gate

### 작업 목적

- AI generated spec을 사람이 검토하기 전에 prompt 규칙 위반, 위험 selector, menuTree 누락 가능성을 정적으로 점검하는 Generated Spec Validator를 추가한다.

### 변경 내용

- `tools/ai-generator/validate_generated_spec.py`를 새로 추가했다.
- validator는 `tests/generated/generated_menu_access.spec.js`, `tools/ai-generator/generated/menu_map.json`, `tools/ai-generator/generated/scout_result.json`을 읽어 정적 검사를 수행한다.
- 금지 selector, pageProfile `cssPath` 보존 위반, depth3 `cssPath` option 누락, depth3 단독 클릭, menuTree step coverage 누락을 error로 리포트하도록 했다.
- 공지/FAQ/제품명/모델명/버튼 text 기반 assertion 의심 패턴은 warning으로 리포트하도록 했다.
- `package.json`에 `ai:validate` script를 추가했다.
- `docs/GENERATED_SPEC_VALIDATION.md`를 새로 작성해 목적, 실행 명령, error/warning 기준, 검토 흐름을 정리했다.
- README에는 generated spec 정적 검증 명령을 간단히 추가했다.

### 확인 결과

- `python -m py_compile tools/ai-generator/validate_generated_spec.py`로 문법 확인을 수행했다.
- 테스트 실행과 generated spec 수정은 수행하지 않았다.

### 다음 작업

- `npm run ai:generate` 후 `npm run ai:validate`를 실행해 실제 generated spec의 error/warning 리포트를 확인한다.
- validator 결과를 바탕으로 prompt 규칙 또는 generated spec 품질 기준을 추가 보완한다.

## 2026-06-24 - Preserve pageProfile cssPath in generated assertions

### 작업 목적

- 개발 지원, 검증 지원 generated 테스트 실패 원인이 scout_result에 없는 selector를 generated spec이 임의 축약해 사용한 것이라서, Page Identity assertion selector 사용 규칙을 보완한다.

### 변경 내용

- `agent_orchestrator.py` prompt에 selector 사용 규칙을 추가했다.
- heading assertion은 `getByRole('heading')` 사용을 허용하되, mainContainer/table/tab/content assertion과 highlight locator는 `pageProfiles`에 수집된 `cssPath`를 그대로 사용하도록 명시했다.
- `div#developGuide01-01 > div.listContent > div.content:nth-of-type(2)` 같은 수집 selector를 `div#developGuide01-01`처럼 parent selector로 임의 축약하지 않도록 했다.
- 수집된 `cssPath`가 너무 길거나 불안정해 보이면 assertion 대신 TODO를 남기도록 했다.
- 개발 가이드/검증 가이드처럼 heading이 부모 메뉴명만 있는 경우에는 수집된 `mainContainers[1]` 또는 content `cssPath`를 그대로 사용해 visible assertion과 `highlightPageIdentity`를 생성하도록 했다.
- depth3 메뉴 클릭 시 `menu_map`의 `cssPath`가 있으면 `clickVisibleSubMenuByText` options에 반드시 포함하도록 규칙을 강화했다.
- `docs/PROMPT_STRATEGY.md`에 cssPath 보존과 depth3 click options 규칙을 반영했다.

### 확인 결과

- 이번 작업에서는 실행 검증을 수행하지 않았다.

### 다음 작업

- `npm run ai:generate` 후 개발 지원/검증 지원 generated selector가 scout_result의 `cssPath` 그대로 생성되는지 확인한다.
- depth3 클릭 helper options에 `cssPath`가 빠지지 않는지 확인한다.

## 2026-06-24 - Page identity highlight closes GNB hover overlay

### 작업 목적

- visual debug에서 GNB hover overlay가 페이지 본문을 가려 Page Identity highlight를 보기 어려운 문제를 개선한다.

### 변경 내용

- `highlightPageIdentity` 내부에서 highlight 전에 마우스를 viewport 하단 본문 영역으로 이동하도록 했다.
- 이 동작은 `HIGHLIGHT=true`일 때만 실행되므로 일반 테스트 실행에는 영향이 없다.
- 다음 메뉴 이동은 각 step의 `openDepth1ByIndex`가 다시 처리하므로 hover 상태를 유지하지 않는다.

### 확인 결과

- 이번 작업에서는 실행 검증을 수행하지 않았다.

### 다음 작업

- `npm run test:generated:visual` 실행 시 GNB hover overlay가 닫힌 뒤 PAGE IDENTITY highlight가 본문에서 보이는지 확인한다.

## 2026-06-24 - Level 2 showcase tab identity highlight tuning

### 작업 목적

- showcase 계열 depth3 `ngClick` tab 메뉴에서 mainContainer visible assertion은 생성되지만 `highlightPageIdentity`가 호출되지 않아 visual debug에서 PAGE IDENTITY가 보이지 않는 문제를 보완한다.

### 변경 내용

- `agent_orchestrator.py` prompt에 heading이 없거나 heading이 부모 depth2 메뉴명과 동일한 경우 mainContainer 또는 안정적인 tab locator를 Page Identity highlight 대상으로 사용하도록 명시했다.
- showcase 모듈/모뎀, 단말 depth3 메뉴처럼 URL/hash가 동일한 `ngClick` tab 메뉴에서도 PAGE IDENTITY highlight를 반드시 생성하도록 했다.
- mainContainer visible assertion을 생성한 경우 같은 locator로 `highlightPageIdentity`를 반드시 호출하도록 규칙을 강화했다.
- label에는 `단말 > NB-IoT: content area`처럼 menuPath 전체를 포함하도록 예시를 추가했다.
- 제품명/모델명/상세보기 버튼/공지/FAQ/list 콘텐츠는 assertion과 highlight 대상으로 쓰지 않는 규칙을 유지했다.
- `docs/PROMPT_STRATEGY.md`에 showcase tab identity highlight fallback 규칙을 반영했다.

### 확인 결과

- 이번 작업에서는 실행 검증을 수행하지 않았다.

### 다음 작업

- `npm run ai:generate` 후 showcase depth3 반복 구간에서 mainContainer assertion 직후 `highlightPageIdentity`가 생성되는지 확인한다.
- `npm run test:generated:visual`로 `모듈/모뎀`, `단말` 하위 depth3 메뉴에서 PAGE IDENTITY 라벨이 보이는지 확인한다.

## 2026-06-24 - Level 2 visual debug identity highlight

### 작업 목적

- generated 테스트가 GNB navigation과 Page Identity assertion까지 통과한 뒤, visual debug 실행 시 사람이 실제로 어떤 Page Identity 신호를 검증했는지 화면에서 확인할 수 있도록 한다.

### 변경 내용

- `utils/highlight.js`에 `highlightPageIdentity(page, locator, label)` helper를 추가했다.
- helper는 `HIGHLIGHT=true`일 때만 동작하며 일반 테스트 실행에는 영향을 주지 않는다.
- Page Identity 대상은 메뉴 클릭 하이라이트와 구분되도록 파란 outline, box shadow, `PAGE IDENTITY` 라벨로 강조한다.
- helper 실패가 테스트 실패로 이어지지 않도록 하이라이트 실패 시 경고만 남기게 했다.
- `agent_orchestrator.py` prompt에 heading assertion 직후 `highlightPageIdentity`를 호출하도록 규칙을 추가했다.
- heading이 없고 안정적인 mainContainer assertion을 생성한 경우에만 main container를 보조 highlight 대상으로 사용하도록 했다.
- `docs/PROMPT_STRATEGY.md`에 Level 2 visual debug highlight 규칙을 추가했다.

### 확인 결과

- 이번 작업에서는 요청에 따라 실행 검증을 수행하지 않았다.

### 다음 작업

- `npm run ai:generate` 후 generated spec이 `highlightPageIdentity`를 import하고 heading/mainContainer assertion 직후 호출하는지 확인한다.
- `npm run test:generated:visual` 실행 시 메뉴 클릭 highlight와 Page Identity highlight가 구분되어 보이는지 확인한다.

## 2026-06-23 - menuTree step coverage prompt tuning

### 작업 목적

- generated 테스트는 9 passed로 안정화되었지만, Level 2 prompt가 너무 보수적으로 동작해 일부 depth3 menu step이 누락되는 문제를 보완한다.

### 변경 내용

- `agent_orchestrator.py` prompt에 menuTree 커버리지 규칙을 추가했다.
- menuTree에 포함된 모든 depth2 메뉴와 모든 depth3 child 메뉴에 대해 반드시 `test.step`을 생성하도록 명시했다.
- Page Identity 후보가 약하거나 불안정해도 메뉴 클릭 step 자체는 생략하지 않도록 했다.
- 각 메뉴 step은 최소한 depth1 open, 메뉴 click, URL/hash assertion 또는 TODO 주석을 포함하도록 했다.
- 안정적인 heading 후보가 있으면 heading assertion을 추가하고, 없거나 ngClick tab처럼 URL/hash가 동일하면 TODO 주석을 남기도록 했다.
- `docs/PROMPT_STRATEGY.md`에 step coverage와 conservative assertion의 분리 원칙을 기록했다.

### 확인 결과

- 이번 작업의 검증을 모두 확인 했고, 누락된 메뉴들이 모두 들어온 것을 확인 하였다.
- 테스트 수행시 실패를 유발할 수 있는 위험한 패턴들을 정리하는데 성공 하였다.

### 다음 작업

- `npm run ai:generate` 실행 후 모든 depth2/depth3 메뉴가 generated spec에 `test.step`으로 포함되는지 확인한다.
- 불안정한 buttons/table/공지/FAQ/제품명/모델명 assertion이 계속 생성되지 않는지 확인한다.

## 2026-06-23 - Conservative Level 2 assertion prompt tuning

### 작업 목적

- generated 테스트 9개 중 4개가 실패한 원인이 Level 2 Page Identity assertion 과생성에 있으므로, 기존 GNB navigation 흐름은 유지하면서 Page Identity assertion 생성 규칙을 더 보수적으로 조정한다.

### 변경 내용

- `agent_orchestrator.py`의 Level 2 assertion 우선순위를 `URL/hash > heading > mainContainer > representativeTexts`로 변경했다.
- LLM 입력용 `pageProfiles` 축약 데이터에서 `buttons` 후보를 제거해 버튼 text assertion 생성을 억제했다.
- 버튼, 상세보기, 확대, 이전/다음, Previous/Next, 조회/검색 등은 page identity assertion으로 사용하지 않도록 prompt에 명시했다.
- `table/form/tab`은 일반 selector assertion을 만들지 않고, 안정적인 selector가 명확할 때만 제한적으로 사용하도록 했다.
- 운영 데이터, 목록 데이터, 공지 제목, FAQ 질문, 제품명, 모델명, 제조사 홈, 요금제 숫자, 긴 텍스트, 대괄호 포함 공지 제목은 `representativeTexts` assertion에서 제외하도록 했다.
- 후보가 불안정하면 테스트 실패를 유발하는 assertion 대신 TODO 주석을 남기도록 했다.
- `docs/PROMPT_STRATEGY.md`에 보수적인 Level 2 assertion 생성 기준을 반영했다.

### 확인 결과

- 이번 작업에서는 요청에 따라 실행 검증을 수행하지 않았다.

### 다음 작업

- `npm run ai:generate` 실행 후 generated spec이 기존 GNB hover/click과 URL/hash assertion 흐름을 유지하는지 확인한다.
- 생성된 Level 2 assertion이 heading 또는 mainContainer 중심으로 줄었는지 확인한다.
- 버튼/목록/공지/FAQ/제품명/모델명 기반 assertion이 생성되지 않는지 확인한다.

## 2026-06-23 - Level 2 pageProfile prompt extension

### 작업 목적

- `scout_result.json`에 정상 생성된 `pageProfiles`를 generated spec 생성 prompt에 연결해 Level 2 Page Identity assertion 후보를 만들 수 있도록 한다.

### 변경 내용

- `agent_orchestrator.py`에서 `scout_result.json`의 `pageProfiles`를 추출해 `menu_map.json`에 보존하도록 했다.
- LLM prompt 입력에 `menuTree`와 `pageProfiles`를 함께 전달하도록 확장했다.
- prompt 입력 크기를 줄이기 위해 heading, representativeTexts, mainContainer, table/form/tab/buttons/errorIndicators 후보를 필요한 필드 중심으로 축약했다.
- generated spec 생성 규칙에 Page Identity assertion 우선순위 `heading > representativeTexts > mainContainer > table/form/tab presence`를 추가했다.
- 너무 일반적인 `representativeTexts`와 버튼 후보를 단독 assertion으로 쓰지 않도록 prompt 규칙을 추가했다.
- 저장/삭제/등록/수정/승인/발송/업로드 등 위험 액션 금지 규칙을 유지했다.
- `docs/PROMPT_STRATEGY.md`에 Level 2 Page Identity prompt 규칙을 추가했다.

### 확인 결과

- 이번 작업에서는 요청에 따라 실행 검증을 수행하지 않았다.

### 다음 작업

- `npm run ai:generate` 실행 후 generated spec에 기존 GNB navigation 흐름이 유지되는지 확인한다.
- 생성된 spec에 heading 또는 mainContainer 중심의 Page Identity assertion이 추가되는지 확인한다.
- 버튼 클릭, input 입력, select 변경, 위험 액션이 생성되지 않는지 확인한다.

## 2026-06-23 - scout.js pageProfile initial collection

### 작업 목적

- Level 2 Page Identity Test 구현 준비를 위해 `docs/LEVEL2_PAGE_IDENTITY_DESIGN.md` 기준으로 `scout.js`의 `scout_result.json` 출력에 `pageProfiles` 후보 수집을 추가한다.
- 초기 메인 페이지 1건만 생성되던 `pageProfiles`를 GNB 메뉴 후보 기준 수집으로 보완한다.

### 변경 내용

- `scout_result.json` 출력 구조를 `{ url, count, elements, pageProfiles }` 객체 형태로 확장했다.
- 기존 Level 1 menu_map 생성 흐름을 유지할 수 있도록 기존 DOM 후보 목록은 `elements` 필드에 보존했다.
- `pageProfiles`가 초기 페이지 snapshot 1건이 아니라 GNB 메뉴 후보 클릭 후 수집되도록 보완했다.
- 각 `pageProfile`에 `menuPath`와 `menu` 최소 식별 정보가 연결되도록 했다.
- 초기 `pageProfiles` 구현 범위로 메뉴 클릭 후 `navigation.url`, `navigation.hash`, `navigation.documentTitle`을 수집한다.
- `pageProfile`에 `headings`, `representativeTexts`, `mainContainers`, `errorIndicators`를 우선 수집하고, `buttons`, `forms`, `tables`, `tabs`는 클릭/입력 없이 후보 정보만 수집하도록 했다.
- `representativeTexts`는 header/footer/GNB/common layout 후보를 제외하도록 보완했다.
- `errorIndicators`는 단순 `인증` 단어만으로 unauthorized로 판단하지 않도록 패턴을 좁혔다.
- `errorIndicators`에서 단순 `500` 또는 `404` 숫자만으로 오류로 판단하지 않고 오류 문맥이 있는 표현만 감지하도록 보완했다.
- carousel 성격의 Previous/Next, slick-prev/slick-next 버튼은 page identity button 후보에서 제외했다.
- 이번 구현에서는 generated spec의 Page Identity assertion 생성은 추가하지 않았다.

### 확인 결과

- 이번 보완 작업에서는 요청에 따라 실행 검증을 수행하지 않았다.

### 다음 작업

- `node -c tools/ai-generator/scout.js`와 `npm run ai:generate`를 실행해 실제 `scout_result.json`의 `pageProfiles` 건수와 menuPath 연결을 확인한다.
- 이후 `agent_orchestrator.py` prompt 확장 단계에서 `pageProfiles`를 generated spec의 Page Identity assertion 후보로 연결한다.

## 2026-06-23 - Level 2 Page Identity design documentation

### 작업 목적

- Level 2 Page Identity Test 구현 전에 `scout.js` pageProfile 수집 확장, `agent_orchestrator.py` prompt 확장, generated spec page identity assertion 추가 작업의 기준이 되는 설계 문서를 작성한다.

### 변경 내용

- `docs/LEVEL2_PAGE_IDENTITY_DESIGN.md`를 새로 생성했다.
- 현재 Level 1 Navigation Smoke Test MVP pipeline과 향후 Level 2 pipeline을 구현 관점에서 정리했다.
- `scout_result.json`의 `pageProfiles` 확장 후보와 `pageProfile` 수집 대상을 정의했다.
- `representativeTexts` 선정/제외 기준과 generated spec에서 생성할 page identity assertion 후보를 정리했다.
- Level 2 safety rule, 구현 순서, 구현 후 확인 명령을 문서화했다.

### 다음 작업

- 설계 문서 기준으로 `scout.js` pageProfile 수집 확장 범위를 검토한다.
- JSON 구조 변경 시 `docs/JSON_SCHEMA.md`, `agent_orchestrator.py`, prompt 전략을 함께 검토한다.

## 2026-06-19 - JSON schema documentation for Level 2 preparation

### 작업 목적

- Level 2 Page Identity Test 구현 전 필요한 JSON schema 후보를 문서화한다.

### 변경 내용

- 현재 Level 1에서 사용하는 `scout_result.json`, `menu_map.json`, `menuTree`의 역할을 정리했다.
- 메뉴 후보의 `id`, `text`, `href`, `ngClick`, `cssPath`, `menuDepth` 등 주요 필드 의미를 정리했다.
- Level 2 `pageProfile` 후보 구조와 필드 설명을 추가했다.
- `pageProfile`은 전수 테스트용 데이터가 아니라 Level 2 Page Identity 검증용 후보 데이터임을 명확히 기록했다.
- `representativeTexts` 선정 기준과 단독 신호보다 heading, URL/hash, main container, table/form 존재 여부와 조합해 판단하는 것을 권장한다고 정리했다.
- Level 3 `interactionProfile` 후보 구조와 safe/risky/ambiguous action 기준을 간단히 추가했다.
- 기존 `docs/JSON_SCHEMA.md`의 샘플 JSON과 필드 설명은 삭제하지 않고 Legacy/Sample Structure 섹션으로 보존했다.

### 다음 작업

- Level 2 구현 시 실제 `scout.js` 수집 구조와 `docs/JSON_SCHEMA.md`의 `pageProfile` 후보 구조를 맞춰 검토한다.
- JSON 구조가 실제로 변경될 때 `agent_orchestrator.py`, prompt 전략, 관련 문서를 함께 검토한다.

## 2026-06-19 - README execution procedure and Korean structure cleanup

### 작업 목적

- 기존 README 내용과 AI generated 테스트 실행 절차가 자연스럽게 이어지도록 README를 한국어로 재구성한다.
- 현재 `Level 1 Navigation Smoke Test MVP` 기준의 AI generated 테스트 실행 절차를 README에 정리한다.

### 변경 내용

- README의 기존 목적, 사용 시점, 실행 환경, codegen, test, report 내용을 유지하면서 한국어로 정리했다.
- README의 Node.js/npm 버전 표기가 현재 검증한 개발 환경 기준임을 알 수 있도록 보완했다.
- AI generated 테스트 생성, generated 실행, visual debug, smoke/regression 실행 절차를 같은 문서 흐름 안에 통합했다.
- 사전 준비, `.env`의 `GEMINI_API_KEY`, Playwright browser 설치 확인, 테스트 생성, generated 테스트 실행, visual debug 실행, report 확인 명령을 정리했다.
- 현재 테스트 수준이 `Level 1 Navigation Smoke Test MVP`임을 명시하고 Level 2/3/4는 향후 확장 단계로 구분했다.
- generated 테스트는 사람이 검증한 뒤 `docs/TEST_LEVELS.md` 기준에 따라 smoke/regression으로 승격한다고 정리했다.
- README에 적힌 npm script 명령이 `package.json` scripts와 일치하는지 확인했다.

### 다음 작업

- README 기준 실행 절차가 실제 개발 환경에서 그대로 동작하는지 주기적으로 확인한다.
- Level 2 Page Identity Test 구현 시 README 또는 별도 운영 문서에 Level 2 실행 절차를 추가할지 검토한다.

## 2026-06-18 - TEST_LEVELS detail refinement

### 작업 목적

- push 전에 `docs/TEST_LEVELS.md`의 Level 1 오류 기준과 Level 2 page identity 데이터 후보를 더 명확히 한다.

### 변경 내용

- Level 1의 obvious navigation errors 기준에 404, 500, blank page, unauthorized/forbidden, expected URL/hash not reached, visible error indicator text를 추가했다.
- Level 2 `pageProfile` 후보 구조에 `buttons` 필드를 추가했다.
- Level 2에서는 버튼을 클릭하지 않지만 조회/검색 같은 안정적인 버튼 존재 여부가 페이지 식별 신호가 될 수 있음을 명시했다.
- `representativeTexts` 선정 기준과 제외/포함 후보를 추가했다.

### 다음 작업

- Level 2 구현 시 `pageProfile.buttons`와 `representativeTexts` 후보 수집 규칙을 `scout.js` 설계에 반영할지 검토한다.

## 2026-06-18 - Test level documentation

### 작업 목적

- 현재 generated 테스트의 위치를 전수 테스트 자동화가 아니라 `Level 1 Navigation Smoke Test MVP`로 명확히 정의한다.
- 향후 `Level 2 Page Identity Test`, `Level 3 Safe Interaction Test`, `Level 4 Business Scenario Test`로 발전시키기 위한 기준을 문서화한다.

### 변경 내용

- `docs/TEST_LEVELS.md`를 새로 생성했다.
- Level 1은 GNB hover/click, URL/hash 이동, 오류 없는 페이지 접근 확인 중심의 Navigation Smoke Test MVP로 정의했다.
- Level 2는 전수 테스트가 아니라 의도한 페이지에 도달했는지 확인하는 페이지 식별 검증 단계로 정의했다.
- Level 3은 input 테스트 전체가 아니라 데이터 변경 없는 안전 상호작용만 대상으로 정의했다.
- Level 4는 사람이 정의한 TC와 테스트 데이터, 업무 규칙, 승인된 시나리오가 필요한 Business Scenario Test로 정의했다.
- 향후 `pageProfile`, `interactionProfile` 후보 구조를 정리했다.
- 안전 액션과 위험 액션을 구분했다.
- generated 테스트의 smoke 승격 기준과 regression 승격 기준을 분리해 정리했다.
- `docs/TEST_GENERATION_RULES.md`와 `docs/PLAYWRIGHT_CONVENTION.md`에 `docs/TEST_LEVELS.md` 참조 문구를 추가했다.

### 다음 작업

- Level 2 Page Identity Test 구현 전에 `scout.js`의 `pageProfile` 수집 후보를 구체화한다.
- `docs/JSON_SCHEMA.md`에 `pageProfile` 구조를 추가할지 검토한다.
- Level 2 prompt와 생성 로직을 별도 작업으로 설계한다.

## 2026-06-17 - GNB depth3 duplicate menu click fix

### 작업 목적

- GNB 메뉴 접근 테스트에서 같은 depth3 메뉴명이 여러 depth2 부모 아래에 있을 때 항상 먼저 발견된 메뉴가 클릭되는 문제를 수정한다.
- 예: `모듈/모뎀 > NB-IoT`와 `단말 > NB-IoT`처럼 같은 child text가 반복될 때 의도한 parent 아래의 child 메뉴를 클릭하도록 한다.

### 변경 내용

- `utils/gnb.js`에 `clickVisibleSubMenuByText(page, parentText, childText, options)` helper를 추가했다.
- 새 helper는 `id`를 우선 사용하고, `cssPath`를 보조로 사용하며, 둘 다 없을 때 `parentText + childText` scoped locator로 fallback한다.
- 기존 `openDepth1ByIndex(page, depth1Index)` 동작은 유지했다.
- 기존 `clickVisibleMenuByText(page, text)`는 유지하되 내부 클릭 동작을 공통 helper로 정리했다.
- `tools/ai-generator/agent_orchestrator.py`의 GNB 테스트 생성 prompt를 수정해 depth3 child 메뉴는 `clickVisibleSubMenuByText`를 사용하도록 했다.
- prompt 변경에 맞춰 `docs/PROMPT_STRATEGY.md`에 depth3 중복 메뉴 처리 규칙을 기록했다.
- generated 테스트 파일은 직접 수정하지 않고 `npm run ai:generate`로 재생성했다.

### 확인 명령

```powershell
python -m py_compile tools/ai-generator/agent_orchestrator.py
npm run ai:generate
npm run test:generated
npm run test:generated:visual
```

### 확인 결과

- `npm run ai:generate` 실행 후 generated 테스트가 재생성되었다.
- 재생성된 generated 테스트에서 depth3 child 메뉴가 `clickVisibleSubMenuByText`를 사용하도록 생성되는 것을 확인했다.
- `npm run test:generated` 또는 `npm run test:generated:visual` 실행을 통해 `모듈/모뎀`과 `단말` 하위의 중복 메뉴가 각각 의도한 parent 아래에서 클릭되는 것을 확인했다.
- 특이사항은 없었다.

### 완료 처리

- 이번 GNB depth3 duplicate menu click fix 이슈는 완료 처리한다.

### 다음 작업

- 안정화된 generated 테스트는 필요 시 `tests/smoke` 또는 `tests/regression` 승격을 검토한다.

## 2026-06-17 - package.json scripts 표준화

### 작업 목적

- Playwright AI 테스트 생성 프로젝트의 주요 실행 명령을 `package.json` scripts로 표준화했다.
- 외부망에서 LLM API를 사용하는 현재 생성 흐름을 기준으로 `agent_orchestrator.py` 실행, generated/smoke/regression 테스트 실행, visual debug 실행, report 확인 명령을 npm script로 모았다.

### 변경 내용

- `ai:generate` script를 추가해 `python tools/ai-generator/agent_orchestrator.py`를 실행하도록 했다.
- `test:generated` script를 추가해 `tests/generated` 대상 Playwright 테스트를 실행하도록 했다.
- `test:generated:visual` script를 추가해 `HIGHLIGHT=true` 상태에서 `tests/generated`를 headed 모드와 `workers=1`로 실행하도록 했다.
- Windows 환경에서도 `HIGHLIGHT=true` 환경변수를 안정적으로 전달하기 위해 `cross-env` 사용을 반영했다.
- `test:smoke`, `test:regression` script를 추가해 검증된 테스트 영역을 각각 실행할 수 있게 했다.
- 기존 `codegen`, `test`, `report` script는 유지했다.

### 확인 명령

```powershell
npm install
npm run ai:generate
npm run test:generated
npm run test:generated:visual
npm run test:smoke
npm run test:regression
npm run report
```

### 확인 결과

- `package.json`에 생성, generated 테스트, visual debug, smoke, regression, report 실행 명령이 표준화되어 정리됐다.
- `test:generated:visual`은 `cross-env HIGHLIGHT=true`와 `--headed --workers=1`을 함께 사용하도록 정리되어 GNB 하이라이트 표시 조건을 명령에 포함했다.
- `cross-env`는 `devDependencies`에 추가되어 Windows 환경에서도 동일한 npm script 형식으로 실행할 수 있게 했다.

### 다음 작업

- `npm install` 실행 후 갱신되는 `package-lock.json` 변경을 함께 검토한다.
- 표준화한 script 기준으로 README 또는 운영 문서에 실행 절차를 정리한다.
- generated 테스트가 충분히 검증되면 필요한 항목을 `tests/smoke` 또는 `tests/regression`으로 승격하는 기준을 문서화한다.

## 2026-06-15 - Codex 기반 agent_orchestrator 리팩토링 및 테스트 확인

### 작업 기준

- 외부망에서 LLM API를 사용하는 현재 `tools/ai-generator/agent_orchestrator.py` 기준으로 기록한다.
- 이번 로그는 `scout.js` 실행, `menu_map` 생성, LLM 호출, Playwright spec 저장으로 이어지는 현재 테스트 생성 흐름을 대상으로 한다.

### 실제 코드 변경 사항

- Codex를 사용해 `tools/ai-generator/agent_orchestrator.py`를 함수 단위로 리팩토링했다.
- LLM 설정, scout 결과 파싱, menu generation input 구성, prompt 생성, LLM 호출, 코드블록 정리, Playwright header 보강, menu map 구성, 전체 실행 파이프라인을 역할별 함수로 분리했다.
- `scout.js` 실행, `menu_map.json` 생성, LLM 호출, `tests/generated/generated_menu_access.spec.js` 저장 흐름은 유지했다.
- 생성 테스트 저장 위치는 기존과 동일하게 `tests/generated/generated_menu_access.spec.js`로 유지했다.

### 실행 확인 결과

- 생성된 Playwright 테스트 파일이 정상 생성되는 것을 확인했다.
- `tests/generated` 대상 Playwright 테스트 실행이 정상 처리되는 것을 확인했다.
- `HIGHLIGHT=true`와 `--headed --workers=1` 옵션을 함께 사용해 visual debug 실행 시 GNB 하이라이트 표시가 정상 동작하는 것을 확인했다.

### 발견된 이슈

- GNB 하이라이트가 처음에는 화면에 보이지 않았다.
- 원인은 테스트 실행 시 `HIGHLIGHT=true` 환경변수가 누락된 것이었다.

### 해결 결과

- `HIGHLIGHT=true` 환경변수를 추가하고 `--headed --workers=1` 옵션으로 실행해 하이라이트 표시가 정상 동작함을 확인했다.
- 테스트 생성 결과와 생성 테스트 실행 결과 모두 정상 처리되는 것을 확인했다.

### 다음 작업

- `package.json`에 실행 script를 정리한다.
- 생성 테스트 실행 명령과 visual debug 실행 명령을 표준화한다.
