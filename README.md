# WEB 자동 테스트 AX 패키지

임의의 WEB 사이트 URL을 대상으로 Playwright 기반 UI 탐색, AI generated spec 생성, 정적 validator 검수, 테스트 실행까지 이어지는 자동 테스트 보조 패키지입니다.

이 프로젝트는 특정 사이트 전용 테스트 코드 저장소가 아니라, 대상 URL의 UI 구조를 수집하고 그 결과를 바탕으로 사람이 검토할 수 있는 Playwright 테스트 초안을 생성하는 도구입니다.

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

Level 3 Safe Interaction Test와 Level 4 Business Scenario Test는 향후 확장 단계입니다.

## 실행 환경

아래 버전은 현재 검증한 개발 환경 기준입니다. 다른 버전에서도 동작할 수 있지만 문제가 발생하면 먼저 이 기준과 차이를 확인합니다.

- **Node.js**: `24.15.0`
- **npm**: `11.12.1`
- **Playwright**: `package.json` 기준 버전
- **Python**: `tools/ai-generator/agent_orchestrator.py` 실행 가능 버전

## 사전 준비

의존성을 설치합니다.

```powershell
npm install
```

Playwright browser 설치 여부를 확인합니다.

```powershell
npx playwright install
```

AI generated spec 생성을 위해 프로젝트 루트에 `.env`를 준비합니다.

```env
GEMINI_API_KEY=your_api_key_here
```

`GEMINI_API_KEY`는 `npm run ai:generate` 실행 시 필요합니다.

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

비교 리포트는 다음 위치에 생성됩니다.

- `tools/ai-generator/generated/plan_compare_report.json`
- `tools/ai-generator/generated/plan_compare_report.md`

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
| generated 테스트 실행 | `npm run test:generated` |
| generated visual debug 실행 | `npm run test:generated:visual` |
| smoke 테스트 실행 | `npm run test:smoke` |
| regression 테스트 실행 | `npm run test:regression` |
| 전체 테스트 실행 | `npm run test` |
| Playwright report 확인 | `npm run report` |

## 참고 문서

- 테스트 수준과 승격 기준: `docs/TEST_LEVELS.md`
- 테스트 생성 규칙: `docs/TEST_GENERATION_RULES.md`
- Playwright 작성 규칙: `docs/PLAYWRIGHT_CONVENTION.md`
- 데이터 흐름: `docs/DATA_FLOW.md`
- 모듈 역할: `docs/MODULE_MAP.md`
- generated spec validator: `docs/GENERATED_SPEC_VALIDATION.md`
