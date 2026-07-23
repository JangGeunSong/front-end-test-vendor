# Minimal Local Web UI

## Purpose

이 문서는 기존 Page Navigation/Page Identity와 optional Level 3 `interaction.tabSelection` pipeline을 하나의 local product flow로 실행하는 방법을 설명한다. MVP는 신규 test engine이 아니라 기존 deterministic command를 호출하는 thin controller다.

## Start

`docs/DEVELOPMENT_ENVIRONMENT.md`에 따라 project venv와 fnm Node version을 활성화한 뒤 repository root에서 실행한다.

```powershell
npm run product:mvp
```

브라우저에서 `http://127.0.0.1:4173`을 연다. Port는 `MVP_PORT` 환경변수로 변경할 수 있다.

## User Flow

1. credential이 없는 absolute HTTP(S) URL을 입력하고 Analyze를 누른다.
2. 기본 접힌 Page Navigation/Page Identity 요약과 identity type별 개수를 확인한다. Navigation은 승인 대상이 아니라 기본 실행 대상이다.
3. Soft Interaction은 `Ready to test`, `Needs review`, `All`, `Selected` 필터로 검토한다. 기본 필터는 `Ready to test`다.
4. Interaction을 추가하려면 exact previous-selection evidence가 있는 `tabSelection` card를 선택하고 explicit approval checkbox와 reviewer를 확인한 뒤 승인한다.
5. Interaction을 실행하지 않으려면 아무 candidate도 선택하지 않고 Navigation 실행 버튼을 누른다.
6. navigation, identity, optional interaction/restoration 결과와 Playwright HTML Report를 확인한다.

Navigation 실행에는 interaction approval이 필요하지 않다. 선택된 interaction이 있을 때만 UI가 current Analysis Review Report `2.1`의 exact candidate snapshot으로 Approval Artifact `3.0`을 만들고 기존 validator를 실행한다. 이후 기존 Reconciliation, Structured Interaction Plan `3.0` builder/validator와 deterministic renderer를 그대로 사용한다.

선택된 interaction이 없으면 Approval, Reconciliation, Structured Interaction Plan, interaction spec을 만들지 않는다. Interaction approval validation, reconciliation, plan generation, spec rendering과 execution은 `no-approved-supported-interactions` reason과 함께 `skipped`로 기록한다.

Navigation-only 결과는 Navigation/Page Identity 결과로 Overall PASS/FAIL을 계산한다. Soft Interaction과 Restoration은 `0 / 0 PASS`가 아니라 `SKIPPED`로 표시하고 실패 수에 포함하지 않는다.

## API Boundary

- `POST /api/analyze`
- `GET /api/runs/:runId/status`
- `GET /api/runs/:runId/analysis`
- `POST /api/runs/:runId/approve`
- `POST /api/runs/:runId/execute`
- `GET /api/runs/:runId/result`
- `GET /api/runs/:runId/report`

Analyze, optional approval, execute는 분리되어 있다. `execute`는 analysis가 완료됐고 Navigation test가 하나 이상이면 approval 없이 호출할 수 있다. 승인된 eligible interaction이 하나 이상인 run은 기존 approval gate를 통과한 뒤 실행한다. Controller는 동시에 요청된 artifact-producing 작업을 serialize하고 각 run의 evidence, optional approval/interaction plan, JSON result와 HTML report를 `tools/ai-generator/generated/mvp-runs/<runId>/`에 분리한다. Generated specs는 renderer relative import contract를 유지하기 위해 run ID가 포함된 파일명으로 `tests/generated/`에 생성되며 commit 대상이 아니다.

## Execution Contract

- deterministic navigation `plan` mode 사용
- pageProfile cache를 사용하지 않는 fresh analysis
- 승인된 eligible interaction이 있을 때만 Approval `3.0` strict validation
- 승인된 eligible interaction이 있을 때만 exact evidence reconciliation
- 승인된 eligible interaction이 있을 때만 Structured Interaction Plan `3.0` validation과 interaction rendering
- deterministic navigation/interaction renderer 사용
- Playwright `workers=1`, `retries=0`
- HTML + JSON reporter 사용
- `interaction.tabSelection`만 UI execution eligible로 표시
- Navigation test 0개면 실행 거부
- interaction 0개 또는 선택 0개면 Navigation-only 실행과 explicit interaction `skipped` result

`interaction.expandedToggle` renderer contract는 기존대로 남지만 이 MVP UI에서는 actual runtime 대상으로 승인하지 않는다.

## Validation

```powershell
npm run product:mvp:test
```

이 명령은 Node controller의 URL/normalization/execution target/result summary test, dependency-free UI state/markup test와 deterministic approval writer fixture test를 실행한다. 전체 interaction fixture regression은 기존 fixture command를 별도로 사용한다.

실제 UI smoke는 target과 mode를 명시해 실행할 수 있다.

```powershell
npm run product:mvp:smoke -- --url https://target.example.com --mode navigation-only
npm run product:mvp:smoke -- --url https://target.example.com --mode interaction
```

Smoke harness는 Local MVP server와 headless browser를 실행해 fresh analysis, UI review/selection, execution, JSON result와 HTML report endpoint를 확인한다. 제품 controller와 마찬가지로 site별 selector나 fallback을 추가하지 않는다.

## Current Limitations

- local single-process, in-memory active run registry
- database, project/history storage, login, team collaboration 없음
- server restart 후 과거 run을 UI에서 다시 불러오는 기능 없음
- broad cross-site interaction runtime regression 없음
- `expandedToggle` actual runtime 없음
- 정교한 실시간 progress percentage 없음
- localization 없음
- production deployment 또는 SaaS 기능 없음
