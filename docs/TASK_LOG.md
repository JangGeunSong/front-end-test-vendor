# Task Log

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
