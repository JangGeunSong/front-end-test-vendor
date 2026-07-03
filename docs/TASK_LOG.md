# Task Log

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
