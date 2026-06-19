# WEB 프론트엔드 테스트 자동화 Vendor 프로젝트

Playwright 기반 WEB 프론트엔드 테스트 자동화 프로젝트입니다.

이 프로젝트는 수동으로 작성하거나 녹화한 Playwright 테스트를 실행하는 기본 테스트 프로젝트이면서, `tools/ai-generator`를 통해 AI-assisted 테스트 코드 초안을 생성하는 보조 도구를 함께 포함합니다.

현재 AI generated 테스트의 수준은 **Level 1 Navigation Smoke Test MVP**입니다. 전수 테스트 자동화가 아니라 GNB 메뉴 접근과 기본 페이지 접근 가능 여부를 빠르게 확인하는 단계입니다.

## 1. 목적

이 프로젝트의 목적은 배포 전 WEB 주요 기능의 회귀 위험을 Playwright 테스트로 빠르게 확인하는 것입니다.

주요 목적:

- 배포 전 기본 화면 접근 확인
- GNB 메뉴 이동 흐름 확인
- 주요 페이지 접근 중 명백한 오류 여부 확인
- 사람이 검증한 테스트를 `tests/smoke` 또는 `tests/regression` 영역으로 관리
- AI를 활용해 `tests/generated` 영역의 테스트 초안을 생성

## 2. 사용 시점

다음 상황에서 사용합니다.

- 보안 패치 배포 전 기본 동작 확인
- 고도화 개발 반영 후 주요 화면 접근 확인
- 코드 리팩토링 또는 개선 후 회귀 확인
- 운영 반영 전 사전 검증
- 일간 또는 수시 배포 전 기본 기능 확인

## 3. 실행 환경

아래 버전은 현재 검증한 개발 환경 기준입니다. 다른 버전에서도 동작할 수 있지만, 문제가 발생하면 먼저 아래 기준과 차이를 확인합니다.

- **Node.js**: `24.15.0`
- **npm**: `11.12.1`
- **Playwright**: `package.json` 기준 버전 사용
- **Python**: `tools/ai-generator/agent_orchestrator.py` 실행 가능해야 함

## 4. 사전 준비

의존성을 설치합니다.

```powershell
npm install
```

Playwright browser 설치 여부를 확인합니다.

```powershell
npx playwright install
```

AI generated 테스트를 생성하려면 프로젝트 루트에 `.env`를 준비하고 Gemini API key를 설정합니다.

```env
GEMINI_API_KEY=your_api_key_here
```

`GEMINI_API_KEY`는 `npm run ai:generate` 실행 시 필요합니다.

## 5. 수동 테스트 녹화

Playwright codegen으로 테스트를 녹화할 수 있습니다.

```powershell
npm run codegen -- -o tests/my_new_test.spec.js
```

설명:

- `-- -o ...` 옵션은 녹화한 테스트를 지정한 파일로 저장하기 위한 옵션입니다.
- 자동 파일 생성을 원하지 않으면 `-o` 옵션 없이 codegen을 실행할 수 있습니다.
- 사람이 검증한 테스트만 `tests/smoke` 또는 `tests/regression`으로 이동합니다.

## 6. 전체 테스트 실행

프로젝트의 Playwright 테스트를 실행합니다.

```powershell
npm run test
```

Playwright는 일반적으로 다음 형식의 테스트 파일을 실행합니다.

- `*.test.js`
- `*.spec.js`

## 7. AI generated 테스트 생성

현재 AI generated 테스트는 **Level 1 Navigation Smoke Test MVP**입니다.

현재 범위:

- GNB hover/click
- URL 또는 hash 이동 확인
- 명백한 navigation 오류 없이 페이지 접근 가능한지 확인

현재 범위가 아닌 것:

- 페이지 heading 검증
- 대표 텍스트 검증
- 테이블, 폼, 입력 필드 검증
- 조회 결과 검증
- 데이터 변경 업무 흐름 검증

테스트를 생성합니다.

```powershell
npm run ai:generate
```

이 명령은 `tools/ai-generator/agent_orchestrator.py`를 실행하고, 생성된 Playwright spec을 `tests/generated` 아래에 저장합니다.

Level 2 Page Identity Test, Level 3 Safe Interaction Test, Level 4 Business Scenario Test는 향후 확장 단계이며 현재 실행 절차에는 포함하지 않습니다.

## 8. generated 테스트 실행

AI generator가 생성한 테스트만 실행합니다.

```powershell
npm run test:generated
```

`tests/generated`의 테스트는 자동 생성 산출물입니다. 바로 smoke 또는 regression 테스트로 간주하지 않습니다.

## 9. visual debug 실행

GNB hover/click 대상을 화면에서 확인하면서 generated 테스트를 실행합니다.

```powershell
npm run test:generated:visual
```

이 명령은 다음 조건으로 실행됩니다.

- `HIGHLIGHT=true`
- headed mode
- `--workers=1`

`HIGHLIGHT=true`가 적용되면 GNB hover/click 대상이 화면에 강조 표시됩니다. 메뉴 이동 경로와 중복 메뉴 클릭 위치를 사람이 눈으로 확인할 때 사용합니다.

## 10. smoke 테스트 실행

사람이 검증해 승격한 smoke 테스트를 실행합니다.

```powershell
npm run test:smoke
```

smoke 테스트는 빠르게 실행 가능하고, 데이터 변경이 없으며, visual/debug 확인이 끝난 기본 안정성 확인 테스트만 포함해야 합니다.

## 11. regression 테스트 실행

사람이 검증해 승격한 regression 테스트를 실행합니다.

```powershell
npm run test:regression
```

regression 테스트는 테스트 데이터, 전제조건, 기대 결과, 반복 검증 가치가 명확한 경우에만 포함합니다.

## 12. 테스트 리포트 확인

Playwright 리포트를 브라우저에서 확인합니다.

```powershell
npm run report
```

테스트 실패 원인, 실행 결과, trace 또는 screenshot 등 Playwright report에 기록된 정보를 확인할 수 있습니다.

## 13. generated 테스트 주의사항

- generated 테스트는 자동 생성 초안입니다.
- generated 테스트는 바로 `tests/smoke` 또는 `tests/regression`으로 보지 않습니다.
- 사람이 실행 결과와 visual debug 결과를 검증한 뒤 승격 여부를 결정합니다.
- 승격 기준은 `docs/TEST_LEVELS.md`를 따릅니다.
- 현재 generated 테스트는 Level 1 Navigation Smoke Test MVP입니다.
- 페이지 내부 내용 검증은 향후 Level 2 Page Identity Test 대상입니다.
- 데이터 변경 없는 안전 상호작용 검증은 향후 Level 3 Safe Interaction Test 대상입니다.

## 14. 명령어 요약

| 항목 | 명령어 |
|---|---|
| 의존성 설치 | `npm install` |
| Playwright browser 설치 | `npx playwright install` |
| 수동 테스트 녹화 | `npm run codegen -- -o tests/my_new_test.spec.js` |
| 전체 테스트 실행 | `npm run test` |
| AI generated 테스트 생성 | `npm run ai:generate` |
| generated 테스트 실행 | `npm run test:generated` |
| generated visual debug 실행 | `npm run test:generated:visual` |
| smoke 테스트 실행 | `npm run test:smoke` |
| regression 테스트 실행 | `npm run test:regression` |
| 리포트 확인 | `npm run report` |

## 15. 참고 문서

- 테스트 레벨과 승격 기준: `docs/TEST_LEVELS.md`
- 테스트 생성 규칙: `docs/TEST_GENERATION_RULES.md`
- Playwright 작성 규칙: `docs/PLAYWRIGHT_CONVENTION.md`
- 데이터 흐름: `docs/DATA_FLOW.md`
- 모듈 역할: `docs/MODULE_MAP.md`
