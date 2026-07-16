# WEB 자동 테스트 AX 패키지

임의의 WEB 사이트 URL을 대상으로 Playwright 기반 UI 탐색, AI generated spec 생성, 정적 validator 검수, 테스트 실행까지 이어지는 자동 테스트 보조 패키지입니다.

이 프로젝트는 특정 사이트 전용 테스트 코드 저장소가 아니라, 대상 URL의 UI 구조를 수집하고 그 결과를 바탕으로 사람이 검토할 수 있는 Playwright 테스트 초안을 생성하는 도구입니다.

## 프로젝트 포지셔닝

이 프로젝트는 단순히 LLM에게 Playwright 코드를 통째로 생성시키는 도구가 아닙니다. 목표는 URL-first WEB test generation AX pipeline입니다.

핵심 구조는 **AI-assisted but deterministic-controlled** 방식입니다.

- `scout.js`가 실제 브라우저로 대상 URL의 rendered DOM과 navigation/page identity 후보를 수집합니다.
- `agent_orchestrator.py`가 수집 결과를 `menu_map.json`과 `primaryMenuTree`로 projection합니다.
- LLM은 Playwright JavaScript를 직접 작성하지 않고 structured test plan JSON의 template과 근거를 판단합니다.
- `validate_test_plan.py`가 schema, coverage, 중복, optional field를 검증합니다.
- `render_test_plan.py`가 검증된 structured plan을 deterministic Playwright spec으로 렌더링합니다.
- 사람은 생성된 테스트와 근거를 검토한 뒤 smoke/regression 승격 여부를 판단합니다.

즉, LLM의 역할은 “코드 작성자”가 아니라 “테스트 계획 후보 제안자”에 가깝습니다. Playwright code shape, URL assertion, click helper, page identity assertion, title uniqueness는 renderer와 validator가 통제합니다.

자세한 제품 방향은 `docs/PRODUCT_DIRECTION.md`, 사이트 유형별 검증 결과는 `docs/CROSS_SITE_VALIDATION.md`를 참고합니다.

## 현재 구현 상태

현재 구현 범위는 다음과 같습니다.

- **Level 1 Navigation Smoke Test**
  - GNB 또는 navigation 메뉴 hover/click
  - URL/hash 이동 확인
  - 명백한 접근 오류 확인
- **Level 2 Page Identity Test MVP**
  - 메뉴 클릭 후 의도한 페이지에 도달했는지 확인
  - heading, main container, 안정적인 pageProfile 후보 기반 assertion 생성
  - visual debug에서 Page Identity 대상 highlight 지원
- **Generated Spec Validation Gate**
  - AI가 생성한 `tests/generated/generated_menu_access.spec.js`를 실행 전에 정적으로 검수
  - selector 임의 생성, menuTree coverage 누락, depth3 클릭 규칙 위반 등을 리포트
- **Structured Test Plan Pipeline**
  - LLM structured plan JSON 생성
  - schema/coverage validation
  - deterministic Playwright spec rendering
  - plan 비교 및 quality gate
- **Structured Interaction Plan Pipeline**
  - approved eligible candidate의 exact `startUrl`/selector와 bounded state/reset plan 생성·검증
  - `interaction.tabSelection`과 `interaction.expandedToggle` deterministic Playwright spec rendering
  - JavaScript syntax와 Playwright test discovery 검증

Level 3 generated interaction spec의 실제 browser transition 실행과 Level 4 Business Scenario Test는 향후 확장 단계입니다.

현재 지원하지 않는 범위도 명확히 구분합니다.

- 로그인/인증 세션 자동 처리
- 등록/수정/삭제/결제 같은 데이터 변경 action
- 완전한 business scenario 자동 생성
- 모든 사이트 100% 무보정 지원
- visual regression
- self-healing selector
- full test management dashboard

## 다음 로드맵

다음 개발 단계는 generated 결과를 사용자가 더 쉽게 검수할 수 있게 만드는 방향입니다.

- Analysis Review Report 설계: `docs/ANALYSIS_REVIEW_REPORT.md`
- Safe Interaction Test 전략: `docs/SAFE_INTERACTION_STRATEGY.md`

## 실행 환경

상세한 fresh clone/new shell bootstrap은 `docs/DEVELOPMENT_ENVIRONMENT.md`를 따릅니다.

- **Python**: project-local `venv`, `tools/ai-generator/requirements.txt` 기준
- **Node.js**: `fnm`, `.node-version` 기준
- **Node dependency**: `package-lock.json` 기준
- **Playwright**: `package.json` 기준 버전

## 사전 준비

PowerShell에서 project venv와 fnm environment를 활성화합니다.

```powershell
.\venv\Scripts\Activate.ps1
python -c "import sys; print(sys.executable)"
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm use
node --version
npm --version
```

Dependency는 먼저 현재 상태를 확인하고 누락되었을 때만 lock/requirements 기준으로 설치합니다.

```powershell
python -m pip install -r tools/ai-generator/requirements.txt
npm ci
```

Playwright browser가 필요한 browser task에서만 browser 설치를 확인합니다.

```powershell
npx playwright install
```

External LLM을 사용하는 AI generation command에 한해 프로젝트 루트의 local `.env`가 필요합니다.

```env
GEMINI_API_KEY=your_api_key_here
```

`GEMINI_API_KEY`는 `npm run ai:generate` 같은 external LLM command에서만 필요합니다. `.env`와 secret 값은 Git에 commit하지 않습니다. Deterministic validator/reconciler는 `.env`를 요구하지 않습니다.

## 기본 실행 흐름

권장 흐름은 다음 순서입니다.

```powershell
npm run ai:generate
npm run ai:validate
npm run test:generated
npm run test:generated:visual
```

### 1. AI generated spec 생성

```powershell
npm run ai:generate
```

이 명령은 `tools/ai-generator/agent_orchestrator.py`를 실행합니다.

주요 흐름:

- 대상 URL을 기준으로 `scout.js` 실행
- `scout_result.json` 생성
- `menu_map.json` 생성
- menuTree와 pageProfiles를 LLM prompt 입력으로 구성
- `tests/generated/generated_menu_access.spec.js` 저장

생성된 spec은 자동 생성 초안입니다. 바로 smoke/regression 테스트로 보지 않습니다.

### 2. generated spec 정적 검수

```powershell
npm run ai:validate
```

이 명령은 `tools/ai-generator/validate_generated_spec.py`를 실행합니다.

validator는 테스트를 실행하지 않고 다음 파일을 읽어 정적으로 검사합니다.

- `tests/generated/generated_menu_access.spec.js`
- `tools/ai-generator/generated/menu_map.json`
- `tools/ai-generator/generated/scout_result.json`

검사 예:

- 금지 selector 사용 여부
- pageProfiles에 없는 selector 사용 여부
- depth3 메뉴 클릭 시 parent context와 cssPath option 사용 여부
- menuTree depth2/depth3 step coverage 누락 여부
- 불안정한 text assertion 의심 패턴

validator error가 발생하면 generated spec을 직접 손으로 수정하지 않습니다. 원인은 prompt, scout 수집 규칙, pageProfile 구조, validator 규칙 중 어디에 있는지 확인하고 생성 로직을 보완한 뒤 다시 생성합니다.

### 3. generated 테스트 실행

```powershell
npm run test:generated
```

`tests/generated` 아래의 자동 생성 테스트를 실행합니다. validator를 통과한 뒤 실행하는 것을 기준으로 합니다.

### 4. visual debug 실행

```powershell
npm run test:generated:visual
```

이 명령은 `HIGHLIGHT=true`, headed mode, `--workers=1` 조건으로 generated 테스트를 실행합니다.

visual debug에서는 다음을 눈으로 확인합니다.

- 메뉴 hover/click 위치
- 중복 메뉴가 올바른 parent 아래에서 클릭되는지
- Page Identity assertion 또는 highlight 대상이 의도한 본문 영역인지

## structured plan 실행 흐름

현재 프로젝트에는 기존 AI generated spec 경로와 structured test plan 경로가 함께 있습니다.

- 기존 안정 경로: `ai:generate` → `ai:validate` → `test:generated`
- deterministic plan 경로: `ai:plan:deterministic`
- LLM structured plan 경로: `ai:plan:llm`
- deterministic plan과 LLM plan 품질 비교: `ai:compare-plans`

| 기존 plan 비교 | `npm run ai:compare-plans` |
| plan 재생성 후 비교 | `$env:TARGET_URL="https://target.example.com"; npm run ai:plan:compare` |

structured plan 경로는 `menu_map.json`과 `pageProfiles`를 바탕으로 test plan JSON을 만들고, validator와 deterministic renderer를 거쳐 `tests/generated/generated_from_plan.spec.js`를 생성합니다.

승인 reconciliation 결과에서 Structured Interaction Plan JSON을 생성·검증하고 deterministic Playwright source를 렌더링하려면 다음 명령을 사용합니다. Renderer command는 browser test body를 실행하지 않습니다.

현재 interaction plan schema `2.0`은 candidate가 실제 관찰된 same-origin `observedUrl`을 test별 `startUrl`로 exact 보존합니다. Target root나 page context에서 실행 URL을 추론하지 않습니다.

```powershell
npm run ai:build-interaction-plan
npm run ai:validate-interaction-plan
npm run ai:render-interaction-plan
```

기본 renderer output은 `tests/generated/generated_interaction_plan.spec.js`입니다. 실제 click/reset/restore를 실행하기 전 static 확인은 `node --check`와 `npx playwright test tests/generated/generated_interaction_plan.spec.js --list`로 수행할 수 있습니다.

### 어떤 명령을 쓰면 되는가

일반적인 안정 경로가 필요하면 기존 generated spec 경로를 사용합니다.

```powershell
npm run ai:generate -- --url https://target.example.com
npm run ai:validate
npm run test:generated
```

deterministic structured plan 산출물을 만들고 실행하려면 다음을 사용합니다.

```powershell
npm run ai:plan:deterministic -- --url https://target.example.com
npm run test:generated
```

LLM이 Playwright JS가 아니라 structured test plan JSON만 생성하도록 실험하려면 다음을 사용합니다.

```powershell
npm run ai:plan:llm -- --url https://target.example.com
npm run test:generated
```

deterministic plan과 LLM plan의 품질 차이를 비교하려면 다음을 사용합니다.

```powershell
npm run ai:compare-plans
```

품질 차이가 있으면 명령 자체를 실패시키고 싶을 때는 gate 명령을 사용합니다.

```powershell
npm run ai:compare-plans:gate
```

`ai:compare-plans:gate`는 coverage 누락 또는 meaningful template/selector/assertion mismatch가 있으면 exit code 1로 종료합니다. 단순 URL 표현 차이처럼 raw-only difference로 분류된 항목은 실패 조건이 아닙니다.

비교 리포트는 다음 위치에 생성됩니다.

- `tools/ai-generator/generated/plan_compare_report.json`
- `tools/ai-generator/generated/plan_compare_report.md`

### generated artifact 관리

다음 파일과 디렉터리는 실행 산출물이므로 기본적으로 커밋하지 않습니다.

- `tests/generated/`
- `test-results/`
- `playwright-report/`
- `tools/ai-generator/generated/*.json`
- `tools/ai-generator/generated/*.txt`

단, `tools/ai-generator/generated/test_plan.example.json`은 structured test plan schema 설명과 renderer/validator 개발용 fixture이므로 repository에 보존합니다.

다른 target URL을 테스트할 때는 기존 generated spec을 재사용하지 않고 다시 생성합니다.

```powershell
npm run ai:plan:llm -- --url https://target.example.com
npm run test:generated
```

### plan scripts 주의사항

- `ai:plan`은 `ai:plan:deterministic`의 alias입니다.
- LLM structured plan 경로는 반드시 `ai:plan:llm`으로 명시해서 실행합니다.
- `ai:plan:deterministic`과 `ai:plan:llm`은 둘 다 `tests/generated/generated_from_plan.spec.js`를 생성합니다. 마지막에 실행한 경로의 결과가 남습니다.
- `ai:plan:compare`는 deterministic plan과 LLM plan을 모두 생성한 뒤 비교합니다. 두 경로가 같은 shadow output file을 쓰므로, 이 명령은 rendered spec 보존용이 아니라 plan 품질 비교용으로 봅니다.
- 단일 명령에는 `-- --url https://target.example.com`을 사용할 수 있습니다.
- 여러 npm script를 이어서 실행하는 composite 흐름에서는 같은 URL을 모든 단계에 전달하기 위해 `TARGET_URL` 환경변수 사용을 권장합니다.

PowerShell 예시:

```powershell
$env:TARGET_URL="https://target.example.com"; npm run ai:plan:compare
```

## 수동 테스트 녹화

Playwright codegen으로 사람이 직접 테스트 초안을 녹화할 수 있습니다.

```powershell
npm run codegen -- -o tests/my_new_test.spec.js
```

사람이 검증한 테스트만 `tests/smoke` 또는 `tests/regression`으로 승격합니다.

## smoke/regression 실행

```powershell
npm run test:smoke
npm run test:regression
```

`tests/smoke`와 `tests/regression`은 사람이 검증한 테스트 영역입니다. generated 테스트는 validator 통과, 실행 확인, visual/debug 확인 후 승격 여부를 검토합니다.

승격 기준은 `docs/TEST_LEVELS.md`를 따릅니다.

## 리포트 확인

```powershell
npm run report
```

Playwright report에서 실행 결과, trace, screenshot 등 디버깅 정보를 확인합니다.

## generated 테스트 주의사항

- generated spec은 재생성 가능한 산출물입니다.
- generated spec은 사람이 검토하기 전까지 신뢰된 테스트로 취급하지 않습니다.
- validator 통과는 최소 품질 게이트이며, 최종 승격 판단은 사람이 합니다.
- generated spec을 직접 수정해 문제를 덮지 않습니다.
- 문제가 있으면 prompt, scout/pageProfile 수집, validator 규칙을 보완하고 다시 생성합니다.
- 데이터 변경 액션은 자동 생성 대상이 아닙니다.

## 명령어 요약

| 목적 | 명령 |
|---|---|
| 의존성 설치 | `npm install` |
| Playwright browser 설치 | `npx playwright install` |
| 수동 테스트 녹화 | `npm run codegen -- -o tests/my_new_test.spec.js` |
| AI generated spec 생성 | `npm run ai:generate` |
| generated spec 정적 검수 | `npm run ai:validate` |
| deterministic structured plan 생성/렌더 | `npm run ai:plan:deterministic -- --url https://target.example.com` |
| LLM structured plan 생성/렌더 | `npm run ai:plan:llm -- --url https://target.example.com` |
| deterministic/LLM plan 비교 | `npm run ai:compare-plans` |
| deterministic/LLM plan 품질 게이트 | `npm run ai:compare-plans:gate` |
| interaction plan JSON 생성 | `npm run ai:build-interaction-plan` |
| interaction plan JSON 검증 | `npm run ai:validate-interaction-plan` |
| interaction plan Playwright spec 렌더 | `npm run ai:render-interaction-plan` |
| generated 테스트 실행 | `npm run test:generated` |
| generated visual debug 실행 | `npm run test:generated:visual` |
| smoke 테스트 실행 | `npm run test:smoke` |
| regression 테스트 실행 | `npm run test:regression` |
| 전체 테스트 실행 | `npm run test` |
| Playwright report 확인 | `npm run report` |

## 참고 문서

- agent 작업 규칙: `AGENTS.md`
- local development environment: `docs/DEVELOPMENT_ENVIRONMENT.md`
- 압축 프로젝트 context: `docs/PROJECT_OVERVIEW.md`
- agent task 작성 template: `docs/AGENT_TASK_TEMPLATE.md`
- 테스트 수준과 승격 기준: `docs/TEST_LEVELS.md`
- 테스트 생성 규칙: `docs/TEST_GENERATION_RULES.md`
- Playwright 작성 규칙: `docs/PLAYWRIGHT_CONVENTION.md`
- 데이터 흐름: `docs/DATA_FLOW.md`
- 모듈 역할: `docs/MODULE_MAP.md`
- generated spec validator: `docs/GENERATED_SPEC_VALIDATION.md`
