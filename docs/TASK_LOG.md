# Task Log

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

- 이번 작업에서는 요청에 따라 실행 검증을 수행하지 않았다.

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
