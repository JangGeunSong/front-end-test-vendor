# Module Map

## Purpose

이 문서는 WEB 자동 테스트 AX 패키지의 주요 파일과 디렉터리 역할을 정리한다.

새 기능을 추가하거나 기존 동작을 수정하기 전에 이 문서를 기준으로 영향 범위를 확인한다.

## tools/ai-generator/agent_orchestrator.py

AI generated spec 생성 파이프라인을 조율한다.

주요 책임:

- `.env` 로딩과 LLM 설정
- `scout.js` 실행
- `scout_result.json` 저장
- menu 후보 추출
- `menuTree` 구성
- scout가 수집한 `depth1Index`를 `menuTree`에 보존
- 전체 후보를 `primaryMenuTree`, `linkCandidates`, `ctaCandidates`, `footerLinks`, `nonPrimaryNavigationCandidates`로 projection
- `pageProfiles` 연결
- LLM generation input 구성
- prompt 작성
- `spec`, deterministic `plan`, `llm-plan` mode orchestration
- pageProfile cache 관리
- structured plan validation과 deterministic renderer 호출

이 파일은 projection, generation input, prompt와 mode orchestration에 직접 영향을 준다. prompt를 수정하면 `docs/PROMPT_STRATEGY.md`도 함께 검토한다.

## Structured Plan Modules

- `tools/ai-generator/build_test_plan.py`: `primaryMenuTree`와 exact menuPath pageProfile에서 deterministic test plan을 생성한다.
- `tools/ai-generator/validate_test_plan.py`: structured plan schema, ID/menuPath 중복, template field, primary menu coverage를 검증한다.
- `tools/ai-generator/render_test_plan.py`: validated plan을 고정된 helper/assertion/title 형태의 Playwright spec으로 렌더링한다.
- `tools/ai-generator/compare_test_plans.py`: deterministic plan과 LLM plan의 coverage 및 meaningful quality difference를 비교하고 opt-in gate를 제공한다.

LLM은 structured plan 판단을 담당하고 executable Playwright code shape는 renderer가 소유한다.

## Analysis And Interaction Modules

- `tools/ai-generator/classify_interaction_candidates.py`: 기존 artifact의 action 후보를 safe/unsafe/unknown으로 분류하고 canonical dedup identity 기반 `candidateKey`를 부여한다.
- `tools/ai-generator/build_analysis_review_report.py`: navigation, Page Identity, interaction evidence를 deterministic JSON review artifact로 구성한다.
- `tools/ai-generator/render_analysis_review_report.py`: report JSON을 사람이 읽을 수 있는 deterministic Markdown으로 렌더링한다.

classifier와 report 경로는 기존 artifact만 사용하며 browser interaction을 실행하지 않는다. `safe` classification과 `candidateKey`는 실행 승인이 아니다.

Human approval artifact의 schema와 classifier/report/future plan 사이 책임 경계는 `docs/INTERACTION_APPROVAL_CONTRACT.md`가 소유한다. 기본 local state 경로는 `tools/ai-generator/review/interaction_approvals.json`이지만 writer, validator, reconciliation module은 아직 구현되지 않았다.

## tools/ai-generator/scout.js

대상 URL의 UI 구조를 수집한다.

주요 책임:

- navigation/GNB 후보 수집
- menu depth, depth1Index, text, href, ngClick, id, cssPath 수집
- navigation region/group과 DOM hierarchy를 기준으로 depth1Index 자동 추론
- `semanticRegion`, `navigationGroupIndex`, `inferredMenuDepth`, `confidence`, `discoveryReason` 수집
- Level 1 menu_map 생성을 위한 `elements` 수집
- Level 2 Page Identity MVP를 위한 `pageProfiles` 수집
- heading, main container, table, form, tab, button, error indicator 후보 수집

`scout.js`는 테스트 코드를 생성하지 않는다. 데이터 변경 액션도 수행하지 않는다.

## tools/ai-generator/validate_generated_spec.py

AI generated spec 정적 validator이다.

주요 책임:

- generated spec, menu_map.json, scout_result.json 읽기
- 금지 selector 검사
- pageProfiles/menuTree cssPath 근거 검사
- depth3 child 클릭 helper 사용 규칙 검사
- menuTree step coverage 검사
- 불안정한 assertion 후보 warning 리포트

validator는 테스트를 실행하지 않는다. generated spec을 사람이 검토하기 전 품질 게이트로 사용한다.

## tools/ai-generator/generated/scout_result.json

`scout.js`의 원본 수집 결과이다.

포함 데이터:

- `elements`
- `pageProfiles`
- navigation/page identity 후보

이 파일은 대상 사이트에서 생성되는 산출물이다. 특정 사이트 샘플이나 제품 고정 데이터로 취급하지 않는다.

## tools/ai-generator/generated/menu_map.json

generated spec 생성을 위한 정제 데이터이다.

포함 데이터:

- `menus`
- `menuTree`
- `primaryMenuTree`
- `pageProfiles`
- non-primary/utility/CTA/footer/unresolved projection 후보

`menuTree`는 Level 1 navigation coverage 기준이고, `pageProfiles`는 Level 2 Page Identity MVP의 후보 근거이다.

`menuTree`는 validator 호환을 위해 Level 1/2 generated spec 대상인 `primaryMenuTree`와 동일하게 유지한다. main CTA, footer link, quick link 등은 `menus`에는 보존하되 primary navigation tree에서는 제외한다.

## tests/generated/

AI 또는 generator가 생성한 Playwright spec 저장 위치이다.

원칙:

- 재생성 가능한 산출물로 본다.
- 직접 손으로 고쳐서 문제를 덮지 않는다.
- validator와 사람이 검토하기 전에는 안정 테스트로 간주하지 않는다.
- 승격 후보는 `tests/smoke` 또는 `tests/regression`으로 별도 이동한다.

## tests/smoke/

사람이 검증한 빠른 smoke 테스트 영역이다.

조건:

- 데이터 변경 없음
- 빠른 실행 가능
- visual/debug 확인 완료
- validator 통과 이력 확인
- 핵심 navigation 또는 availability 확인 가치가 있음

## tests/regression/

사람이 검증한 회귀 테스트 영역이다.

조건:

- 테스트 데이터와 전제조건 명확
- 기대 결과 명확
- 반복 검증 가치 명확
- side effect 통제 가능

## utils/gnb.js

navigation/GNB 조작 helper이다.

주요 책임:

- depth1 open 또는 hover
- visible menu click
- parent-aware depth3 submenu click
- 중복 child text를 parent context와 cssPath/id/ngClick로 분리

## utils/highlight.js

visual debug highlight helper이다.

주요 책임:

- 메뉴 hover/click 대상 강조
- Page Identity assertion 대상 강조
- `HIGHLIGHT=true`일 때만 동작

일반 test 실행의 assertion 의미를 바꾸지 않는다.

## docs/

운영 기준과 설계 문서를 저장한다.

주요 문서:

- `TEST_LEVELS.md`: 테스트 수준과 승격 기준
- `DATA_FLOW.md`: 생성/검증/실행 흐름
- `TEST_GENERATION_RULES.md`: generated spec 생성 규칙
- `PLAYWRIGHT_CONVENTION.md`: Playwright 작성 규칙
- `GENERATED_SPEC_VALIDATION.md`: validator 기준
- `PROMPT_STRATEGY.md`: LLM prompt 전략
- `INTERACTION_APPROVAL_CONTRACT.md`: interaction human decision, evidence snapshot, stale reconciliation 계약
