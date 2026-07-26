# Development Environment

## Purpose

이 문서는 fresh clone, 새 PowerShell, 새 agent session이 특정 PC 경로나 사용자명에 의존하지 않고 repository의 local execution environment를 복원하기 위한 계약이다.

환경 확인과 활성화가 필요한 command task에서는 구현 실패를 판단하기 전에 이 문서의 Python과 Node bootstrap을 수행한다. Dependency는 먼저 현재 상태를 확인하고 누락되었을 때만 설치한다.

현재 repository의 검증된 local development shell은 Windows PowerShell이다. Linux/macOS bootstrap은 아직 repository에서 검증된 requirement가 아니므로 추측한 command를 별도 contract로 제공하지 않는다.

## Environment Sources Of Truth

- Python environment directory: `venv`
- Python dependency source: `tools/ai-generator/requirements.txt`
- Node version manager: `fnm`
- Node version declaration: `.node-version`
- Node dependency lock: `package-lock.json`
- Offline Node dependency baseline: repository-tracked minimal `node_modules`
- Local secret file: `.env`

현재 외부 alpha 재현 기준은 Node `24.15.0` (`.node-version`), npm `11.12.1`, Python `3.12`다. Python `3.10`과 `3.12`에서 repository command를 검증했으며 fresh install은 `3.12`를 권장한다. Python `3.13` 이상은 아직 검증된 contract가 아니다. Existing `venv`의 local interpreter metadata를 portable version declaration으로 취급하지 않는다.

## Python Bootstrap

Python command는 system/global package가 아니라 project-local `venv`를 사용한다.

### Existing venv

Repository root에서 다음을 실행한다.

```powershell
Test-Path .\venv\Scripts\Activate.ps1
.\venv\Scripts\Activate.ps1
python -c "import sys; print(sys.executable)"
python --version
python -m pip --version
```

`sys.executable`이 현재 repository의 `venv` interpreter를 가리키는지 확인한다. 특정 drive나 사용자별 absolute path와 비교하지 않는다.

### Missing venv or dependencies

`venv`가 없는 fresh clone에서는 Windows Python launcher로 명시적인 supported version을 선택해 생성한 뒤 활성화한다.

```powershell
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r tools/ai-generator/requirements.txt
```

`py -0p`로 설치된 interpreter를 확인할 수 있다. `py`가 없다면 `python --version`이 3.10 또는 3.12인지 확인한 뒤 `python -m venv venv`를 사용한다.

Existing `venv`가 있으면 먼저 필요한 import 또는 command를 실행해 dependency availability를 확인한다. Import가 누락되었거나 requirements가 변경된 경우에만 다음을 실행한다.

```powershell
python -m pip install -r tools/ai-generator/requirements.txt
```

Global Python에 package가 설치되어 있다는 이유로 project dependency가 준비되었다고 판단하지 않는다.

## Node And fnm Bootstrap

새 shell에서 `fnm`은 보이지만 `node`와 `npm`이 PATH에 없을 수 있다. Node 미설치나 implementation failure로 판단하기 전에 fnm shell environment를 활성화한다.

현재 repository에서 검증한 PowerShell flow:

```powershell
fnm --version
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm use
node --version
npm --version
```

`fnm use`는 repository root의 `.node-version`을 읽는다. 현재 fnm CLI에서 `fnm use --lts`는 지원되는 syntax가 아니므로 사용하지 않는다.

Sandbox가 fnm multishell symlink 생성을 차단해 `fnm env`가 실패하면 repository 안에 임시 multishell directory나 Node binary를 만들지 않는다. Installed repository version을 다음처럼 직접 실행한다.

```powershell
fnm exec --using=24.15.0 node --version
fnm exec --using=24.15.0 npm.cmd --version
fnm exec --using=24.15.0 npx.cmd playwright test <spec-path> --list
```

이 fallback은 `.node-version`과 일치하는 installed version이 있을 때만 사용한다.

선언된 version이 local fnm installation에 없을 때만 설치한다.

```powershell
fnm install
fnm use
```

Dependency 상태는 먼저 확인한다.

```powershell
Test-Path package-lock.json
Test-Path node_modules
npm ls --depth=0
```

이 repository는 두 Node dependency 경로를 의도적으로 구분한다.

- 폐쇄망/offline 실행: repository에 commit된 최소 `node_modules` vendor baseline을 삭제하지 않고 사용한다. 외부 registry가 없는 환경에서 `npm ci`를 실행하지 않는다.
- 외부망 connected install 검증: `package-lock.json` 기준으로 dependency를 다시 설치하고 재현성을 확인할 때만 `npm ci`를 사용한다.

폐쇄망에서는 먼저 다음을 확인한다.

```powershell
npm ls --depth=0
```

외부망의 disposable clean clone에서 lock 기반 reinstall을 검증할 때는 다음을 사용한다.

```powershell
npm ci
```

`npm ci`는 기존 `node_modules`를 교체하므로 tracked vendor 파일이 있는 개발 worktree에서 routine command로 실행하지 않는다. Connected reinstall 검증은 별도 clean clone에서 수행하고, 검증 후 source 변경과 dependency 재설치에 따른 worktree 변경을 구분한다.

Local MVP browser task에는 bundled Chromium만 설치한다.

```powershell
npx playwright install chromium
```

Local MVP config는 system Chrome channel을 요구하지 않는다. Root `playwright.config.js`를 직접 사용하는 legacy/headed command와 `codegen`은 별도로 system Chrome channel을 사용한다. Deterministic JSON validator/reconciler에는 browser install이 필요하지 않다.

PowerShell에서 대화형으로는 `npm`/`npx`를 사용한다. Node child process나 command resolution 문제를 조사할 때는 Windows shim을 명시한 `npm.cmd`/`npx.cmd`가 같은 command의 직접 실행 형태다. Global npm package는 요구하지 않는다.

## Local `.env` And Secret Policy

`.env`는 local-only secret/configuration state이며 Git commit 대상이 아니다.

```powershell
Test-Path .env
git check-ignore -v .env
```

원칙:

- `.env` 내용이나 API key 값을 console, documentation, fixture, TASK_LOG에 출력하지 않는다.
- External LLM generation command를 실행할 때만 필요한 key의 local 존재를 확인한다.
- `validate_interaction_approvals.py`, `reconcile_interaction_approvals.py` 같은 deterministic local command는 `.env`나 external LLM API key를 요구하지 않는다.
- `.env`가 없다는 이유만으로 deterministic validation을 중단하지 않는다.

필요한 경우에만 안전한 template을 복사하고 값은 사용자가 직접 입력한다.

```powershell
Copy-Item .env.example .env
```

| 변수 | 구분 | 용도 |
| --- | --- | --- |
| `GEMINI_API_KEY` | 선택 | `ai:generate`, `ai:plan:llm` 등 external LLM mode |
| `MVP_PORT` | 선택 | Local MVP listen port, 기본 `4173` |
| `MVP_PYTHON` | 선택 | controller Python executable override; 기본은 `venv\Scripts\python.exe` |
| `TARGET_URL` | 선택 | CLI plan command의 `--url` fallback |
| `BASE_URL` | 선택 | rendered Playwright spec의 execution URL override |

Local MVP의 deterministic `plan` analysis, approval validator/reconciler와 renderer에는 `GEMINI_API_KEY`가 필요하지 않다.

## Fresh Alpha Install

새 clone에는 폐쇄망 실행용 최소 tracked `node_modules`가 포함되는 것이 정상이다. 반면 `venv`, `.env`, generated run, report와 test result는 포함되지 않아야 한다.

외부망에서 package-lock 재현성까지 확인하는 connected alpha install은 다음 순서로 수행한다.

```powershell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm install
fnm use
node --version
npm --version
npm ci

py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r tools/ai-generator/requirements.txt
npx playwright install chromium
npm run product:mvp
```

Expected version은 Node `v24.15.0`, npm `11.12.1`, Python `3.12.x`다.

폐쇄망 설치에서는 위 순서의 `npm ci`를 생략하고 repository vendor dependency를 `npm ls --depth=0`로 확인한다. Vendor `node_modules`는 기존 개발 PC에서 복사한 local artifact가 아니라 repository source policy의 일부다.

## Common Bootstrap Errors

- `node`/`npm` command 없음: 먼저 `fnm env ... | Invoke-Expression`, `fnm install`, `fnm use`를 실행한다.
- `venv\Scripts\python.exe` 또는 Python executable 없음: supported Python을 설치하고 `py -3.12 -m venv venv`를 실행한다.
- `ModuleNotFoundError`: venv를 활성화하고 requirements 설치 명령을 다시 실행한다.
- `Executable doesn't exist` 또는 browser launch 실패: `npx playwright install chromium`을 실행한다.
- port `4173` 사용 중: `$env:MVP_PORT=4174; npm run product:mvp`처럼 다른 port를 지정한다.
- `ERR_NAME_NOT_RESOLVED`, `ERR_CONNECTION_*`, `ERR_NETWORK_ACCESS_DENIED`: 제품 assertion 문제가 아니라 target DNS/proxy/firewall/outbound network를 먼저 확인한다.
- PowerShell activation policy가 `Activate.ps1`을 막는 경우 current process에만 허용하거나 activation 없이 `.\venv\Scripts\python.exe -m pip ...`를 사용한다. 조직 보안 정책을 영구 변경하지 않는다.

## Validation Bootstrap

Python venv와 fnm environment를 같은 PowerShell session에서 활성화한 뒤 repository command를 실행한다.

```powershell
.\venv\Scripts\Activate.ps1
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm use
python -c "import sys; print(sys.executable)"
node --version
npm --version
npm run ai:validate-interaction-approvals
npm run ai:reconcile-interaction-approvals
```

Default approval artifact가 없으면 마지막 두 command는 Python entry point까지 정상 호출된 뒤 explicit missing-input error와 non-zero exit code를 반환하는 것이 계약상 정상이다. Success path는 neutral fixture로 검증한다.

```powershell
npm run ai:validate-interaction-approvals -- --fixture tools/ai-generator/fixtures/interaction_approvals.fixture.json
npm run ai:reconcile-interaction-approvals -- --fixture tools/ai-generator/fixtures/interaction_approval_reconciliation.fixture.json
```

## Agent Checklist

Command validation이 필요한 새 session은 다음 순서를 따른다.

1. `venv`, requirements, `.node-version`, package lock과 `.env` ignore policy를 확인한다.
2. Project venv를 활성화하고 `sys.executable`을 확인한다.
3. `node`/`npm`이 없으면 먼저 fnm 존재와 shell environment activation을 확인한다.
4. `.node-version`에 선언된 version을 `fnm use`로 선택하고 Node/npm version을 확인한다.
5. Dependency는 availability를 먼저 확인하고 필요한 경우에만 requirements 또는 lock file 기준으로 설치한다.
6. External LLM command에서만 local `.env` 존재를 확인하며 secret 값은 읽거나 출력하지 않는다.
7. Runtime local state missing과 implementation failure를 구분해 보고한다.
