# Minimal Local Web UI

## Purpose

이 문서는 기존 Page Navigation/Page Identity와 Level 3 `interaction.tabSelection` pipeline을 하나의 local product flow로 실행하는 방법을 설명한다. MVP는 신규 test engine이 아니라 기존 deterministic command를 호출하는 thin controller다.

## Start

`docs/DEVELOPMENT_ENVIRONMENT.md`에 따라 project venv와 fnm Node version을 활성화한 뒤 repository root에서 실행한다.

```powershell
npm run product:mvp
```

브라우저에서 `http://127.0.0.1:4173`을 연다. Port는 `MVP_PORT` 환경변수로 변경할 수 있다.

## User Flow

1. credential이 없는 absolute HTTP(S) URL을 입력하고 Analyze를 누른다.
2. Page Navigation/Page Identity 요약과 safe/unsafe/unknown interaction 분류를 확인한다.
3. Exact previous-selection evidence가 있는 `tabSelection` candidate를 선택한다.
4. Explicit approval checkbox와 reviewer를 확인하고 승인한다.
5. Generate and run tests를 누른다.
6. navigation, identity, interaction, restoration 결과와 Playwright HTML Report를 확인한다.

Approval 전에는 downstream 실행을 시작할 수 없다. UI는 current Analysis Review Report `2.1`의 exact candidate snapshot으로 Approval Artifact `3.0`을 만들고 기존 validator를 실행한다. Reconciliation, Structured Interaction Plan `3.0` builder/validator와 deterministic renderer도 기존 CLI를 그대로 사용한다.

## API Boundary

- `POST /api/analyze`
- `GET /api/runs/:runId/status`
- `GET /api/runs/:runId/analysis`
- `POST /api/runs/:runId/approve`
- `POST /api/runs/:runId/execute`
- `GET /api/runs/:runId/result`
- `GET /api/runs/:runId/report`

Analyze와 approval/execute는 분리되어 있다. Controller는 동시에 요청된 artifact-producing 작업을 serialize하고 각 run의 evidence, approval, plan, JSON result와 HTML report를 `tools/ai-generator/generated/mvp-runs/<runId>/`에 분리한다. Generated specs는 renderer relative import contract를 유지하기 위해 run ID가 포함된 파일명으로 `tests/generated/`에 생성되며 commit 대상이 아니다.

## Execution Contract

- deterministic navigation `plan` mode 사용
- pageProfile cache를 사용하지 않는 fresh analysis
- Approval `3.0` strict validation
- exact evidence reconciliation
- Structured Interaction Plan `3.0` validation
- deterministic navigation/interaction renderer 사용
- Playwright `workers=1`, `retries=0`
- HTML + JSON reporter 사용
- `interaction.tabSelection`만 UI execution eligible로 표시

`interaction.expandedToggle` renderer contract는 기존대로 남지만 이 MVP UI에서는 actual runtime 대상으로 승인하지 않는다.

## Validation

```powershell
npm run product:mvp:test
```

이 명령은 Node controller의 URL/normalization/result summary test와 deterministic approval writer fixture test를 실행한다. 전체 interaction fixture regression은 기존 fixture command를 별도로 사용한다.

## Current Limitations

- local single-process, in-memory active run registry
- database, project/history storage, login, team collaboration 없음
- server restart 후 과거 run을 UI에서 다시 불러오는 기능 없음
- broad cross-site interaction runtime regression 없음
- `expandedToggle` actual runtime 없음
- production deployment 또는 SaaS 기능 없음
