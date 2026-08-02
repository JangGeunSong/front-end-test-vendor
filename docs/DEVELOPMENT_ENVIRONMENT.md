# Development Environment

## Supported Baseline

Windows PowerShell is the verified development shell.

- Python support: `3.12` through `3.14`
- Default Python minor: `3.12` from `.python-version`
- Python manager and installer: uv
- Python environment: `.venv`
- Python dependency source of truth: fully pinned `tools/ai-generator/requirements.txt`
- Node: `24.15.0` from `.node-version`, selected with fnm
- Expected npm for the pinned Node distribution: `11.12.1`
- Node lock: `package-lock.json`
- Offline Node baseline: repository-tracked minimal `node_modules`

The Python decision and package-by-package evidence are in [Python Compatibility Audit](PYTHON_COMPATIBILITY.md). There is no `pyproject.toml`: this is not an installable Python package, and requirements plus `.python-version` are intentionally the only Python environment declarations.

## Fresh Clone

From the repository root in PowerShell:

```powershell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm install
fnm use
node --version
npm.cmd --version

uv --version
uv python install
npm.cmd run env:bootstrap

npm.cmd ls --depth=0
npx.cmd playwright install chromium
npm.cmd run product:mvp:test
```

`uv python install` reads `.python-version`. `env:bootstrap` creates `.venv` when absent, verifies its minor version, then performs strict wheel-only sync from the pinned requirements. Activation is optional because repository npm commands select `.venv` explicitly through uv.

For a connected disposable clone, `npm.cmd ci` verifies `package-lock.json`. Do not run it routinely in a working tree: it replaces the intentionally tracked offline `node_modules` baseline. In a closed network, retain the tracked directory and use `npm.cmd ls --depth=0`.

PowerShell may block the `npm.ps1` shim under the local execution policy. `npm.cmd` and `npx.cmd` are equivalent direct Windows shims and require no policy change.

## Python Environment Operations

Create or sync the default environment:

```powershell
npm.cmd run env:bootstrap
```

Recreate an existing `.venv` after corruption or a Python minor change:

```powershell
npm.cmd run env:recreate
```

Change the default minor only after updating the support decision and `.python-version`, then run the same recreate command. For a one-off supported alternate minor without changing the project default:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/environment/sync-python.ps1 -PythonVersion 3.14 -Recreate
```

After editing requirements:

```powershell
npm.cmd run env:sync
npm.cmd run test:compat
```

`uv pip sync` removes packages that are not listed. That is expected inside the disposable project environment, so do not point it at system Python or an environment shared with another project.

Direct uv equivalents:

```powershell
uv venv .venv --python 3.12 --clear
uv pip sync --python .venv\Scripts\python.exe tools/ai-generator/requirements.txt --strict --only-binary :all:
uv pip check --python .venv\Scripts\python.exe
uv run --python .venv --with-requirements tools/ai-generator/requirements.txt python --version
```

## Node And fnm

The Node `24.15.0` pin remains the verified baseline. npm `11.12.1` is supplied by that Node installation; npm is not pinned or upgraded separately.

```powershell
fnm --version
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm install
fnm use
node --version
npm.cmd --version
```

`fnm use` reads `.node-version`. With `--use-on-cd`, entering the repository automatically selects the declaration in a prepared shell. If a sandbox cannot create fnm multishell links, use the installed version directly:

```powershell
fnm exec --using=24.15.0 node --version
fnm exec --using=24.15.0 npm.cmd --version
```

## Standard Checks

Smoke checks:

```powershell
npm.cmd run test:python
npm.cmd run product:mvp:test
```

Full local regression without an external target or LLM call:

```powershell
npm.cmd run test:compat
npm.cmd run ai:validate-plan
npm.cmd run ai:validate-interaction-approvals -- --fixture tools/ai-generator/fixtures/interaction_approvals.fixture.json
npm.cmd run ai:reconcile-interaction-approvals -- --fixture tools/ai-generator/fixtures/interaction_approval_reconciliation.fixture.json
```

`test:compat` creates and clears `.venv-py312`, `.venv-py313`, and `.venv-py314`. It installs each interpreter with uv, requires binary wheels, checks dependencies/imports/syntax, runs all Python tests, and runs the npm MVP test under that exact interpreter. These environments are disposable and ignored by Git.

Browser-backed smoke/regression requires the appropriate tracked tests and browser installation:

```powershell
npm.cmd run test:smoke
npm.cmd run test:regression
```

## Dependency Update Policy

`tools/ai-generator/requirements.txt` is a fully pinned reproducibility snapshot containing direct and transitive packages. Project source directly imports `google-generativeai` and `python-dotenv`; update review starts with those requirements and then resolves and reviews the complete transitive snapshot.

- Do not bulk-upgrade merely to match latest releases.
- Review release notes and `Requires-Python` for direct dependencies.
- Resolve in clean 3.12, 3.13, and 3.14 environments.
- Require Windows wheels with `--only-binary :all:`; investigate rather than silently accepting source builds.
- Run `npm.cmd run test:compat` before replacing pins.
- Keep external LLM SDK changes separate from routine environment refreshes.
- Hash locking is not currently enabled. Exact pins provide deterministic versions, while package authenticity relies on the configured index/TLS. Adding hashes requires a reviewed multi-platform artifact policy.

The legacy `google-generativeai` SDK is end-of-life and emits a warning on import. It currently passes all supported Python versions. Migration to `google-genai` remains a known follow-up because its API surface changes and the authenticated LLM path must be tested.

## Troubleshooting

Dependency conflict or stale environment:

```powershell
npm.cmd run env:recreate
```

Repository-local uv cache corruption (only when `UV_CACHE_DIR` was explicitly placed in the repository):

```powershell
uv cache clean
npm.cmd run env:recreate
```

For the normal user-level uv cache, inspect first and use `uv cache clean` only when cache corruption is confirmed. A failed package download may instead be DNS, proxy, certificate, firewall, or registry access.

Other common cases:

- `.venv` uses the wrong minor: `npm.cmd run env:recreate`.
- `python` points elsewhere: use npm scripts or `uv run --python .venv ...`; activation is not required.
- missing module: `npm.cmd run env:sync`.
- no compatible wheel: keep the current pin or choose a reviewed compatible release; do not add local compiler requirements silently.
- Playwright executable missing: `npx.cmd playwright install chromium`.
- fnm does not switch: initialize `fnm env`, then run `fnm use` from the repository root.
- uv user cache is inaccessible in a sandbox: set `UV_CACHE_DIR` to a disposable writable directory; never commit it.
- target network error: check URL, proxy/firewall, DNS, and outbound access before diagnosing product assertions.

## Local Secrets

`.env` is local-only and ignored. Do not print or commit its values. It is needed only for external LLM modes; deterministic validators, renderers, Local MVP tests, and compatibility tests do not need an API key.

```powershell
Test-Path .env
git check-ignore -v .env
Copy-Item .env.example .env
```

`MVP_PYTHON` may override the Python executable for matrix validation or diagnostics. Normal development should leave it unset so `.venv\Scripts\python.exe` is selected.
