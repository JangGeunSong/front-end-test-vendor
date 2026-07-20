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
- Local secret file: `.env`

Python exact version은 repository contract로 고정되어 있지 않다. Existing `venv`의 local interpreter metadata를 portable version declaration으로 취급하지 않는다. Node는 현재 repository에서 실제 검증한 LTS version을 `.node-version`에 명시하며, fnm이 이 파일을 사용한다.

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

`venv`가 없는 fresh clone에서는 사용 가능한 local Python으로 생성한 뒤 활성화한다.

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r tools/ai-generator/requirements.txt
```

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

`package-lock.json`이 있으므로 `node_modules`가 없거나 lock과 불일치할 때만 다음을 사용한다.

```powershell
npm ci
```

Playwright browser binary가 필요한 browser task에서만 `npx playwright install`을 검토한다. Deterministic JSON validator/reconciler에는 browser install이 필요하지 않다.

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
