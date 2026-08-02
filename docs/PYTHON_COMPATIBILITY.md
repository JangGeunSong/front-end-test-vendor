# Python Compatibility Audit

## Decision

- Official support range: Python `3.12` through `3.14`.
- Default development minor: Python `3.12`, declared by `.python-version`.
- Validation platform: Windows x86-64, uv `0.11.32`.
- Dependency source of truth: fully pinned `tools/ai-generator/requirements.txt`.
- `pyproject.toml` is intentionally not used. This repository is not an installable Python package, and duplicating dependency or Python metadata would create a second source of truth.

Python 3.14 is supported but is not the default. The project uses no 3.14-only feature, while 3.12 remains the most conservative fresh-install and CI baseline. A minor pin lets uv select the latest available patch release with security fixes.

## Runtime Matrix

The audit used separate clean uv environments and did not reuse `.venv`.

| Python | Interpreter | Wheel-only sync | Import | compileall | Python tests | npm MVP test |
| --- | --- | --- | --- | --- | --- | --- |
| 3.12 | 3.12.13 | PASS | PASS | PASS | 2 PASS | Node 18 + Python 2 PASS |
| 3.13 | 3.13.14 | PASS | PASS | PASS | 2 PASS | Node 18 + Python 2 PASS |
| 3.14 | 3.14.6 | PASS | PASS | PASS | 2 PASS | Node 18 + Python 2 PASS |

`uv pip sync --only-binary :all: --strict` passed in every environment. No package fell back to a source build, resolution produced the same 32-package set, `uv pip check` found no broken requirements, and no project import uses a standard-library module removed in Python 3.14.

Running imports with `-W error` fails on all three minors because `google-generativeai` emits a `FutureWarning` announcing its end of support. This is not a Python 3.14 incompatibility. Normal imports and the repository test paths pass. Migration to the maintained `google-genai` SDK is a separate API change that requires an authenticated LLM-path regression and must not be hidden inside an environment-only dependency refresh.

## Dependency Inventory

Audit date: 2026-08-02. Latest versions and `Requires-Python` values came from PyPI release metadata. `Y/Y/Y` under support means install, dependency check, and import coverage passed on Python 3.12/3.13/3.14. `wheel` means the pinned version installed in wheel-only mode on Windows x86-64; platform-specific packages supplied native or `abi3` wheels.

Only `google-generativeai` and `python-dotenv` are imported directly by project source. The remaining entries are pinned transitives retained in the reproducible environment snapshot.

| Package | Pin | Latest | Requires-Python | 3.12/3.13/3.14 | Distribution | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| annotated-types | 0.7.0 | 0.8.0 | >=3.8 | Y/Y/Y | wheel | keep pin |
| certifi | 2026.4.22 | 2026.7.22 | >=3.7 | Y/Y/Y | wheel | keep pin |
| cffi | 2.0.0 | 2.1.0 | >=3.9 | Y/Y/Y | native wheels | keep pin |
| charset-normalizer | 3.4.7 | 3.4.9 | >=3.7 | Y/Y/Y | wheels | keep pin |
| colorama | 0.4.6 | 0.4.6 | >=2.7, excludes 3.0-3.6 | Y/Y/Y | wheel | keep pin |
| cryptography | 47.0.0 | 50.0.0 | >3.8, excludes 3.9.0-3.9.1 | Y/Y/Y | `abi3` wheel | keep pin |
| google-ai-generativelanguage | 0.6.15 | 0.12.0 | >3.7 | Y/Y/Y | wheel | keep pin |
| google-api-core | 2.30.3 | 2.33.0 | >=3.9 | Y/Y/Y | wheel | keep pin |
| google-api-python-client | 2.194.0 | 2.198.0 | >=3.7 | Y/Y/Y | wheel | keep pin |
| google-auth | 2.49.2 | 2.56.2 | >=3.8 | Y/Y/Y | wheel | keep pin |
| google-auth-httplib2 | 0.3.1 | 0.4.0 | >=3.9 | Y/Y/Y | wheel | keep pin |
| google-generativeai | 0.8.6 | 0.8.6 | >=3.9 | Y/Y/Y | wheel | keep temporarily; SDK migration required |
| googleapis-common-protos | 1.74.0 | 1.75.0 | >=3.9 | Y/Y/Y | wheel | keep pin |
| grpcio | 1.80.0 | 1.83.0 | >=3.9 | Y/Y/Y | native wheels | keep pin |
| grpcio-status | 1.71.2 | 1.83.0 | >=3.9 | Y/Y/Y | wheel | keep pin |
| httplib2 | 0.31.2 | 0.32.0 | >=3.6 | Y/Y/Y | wheel | keep pin |
| idna | 3.13 | 3.18 | >=3.8 | Y/Y/Y | wheel | keep pin |
| proto-plus | 1.27.2 | 1.28.2 | >=3.9 | Y/Y/Y | wheel | keep pin |
| protobuf | 5.29.6 | 7.35.1 | >=3.8 | Y/Y/Y | wheel | keep pin; major upgrade avoided |
| pyasn1 | 0.6.3 | 0.6.4 | >=3.8 | Y/Y/Y | wheel | keep pin |
| pyasn1-modules | 0.4.2 | 0.4.2 | >=3.8 | Y/Y/Y | wheel | keep pin |
| pycparser | 3.0 | 3.0 | >=3.10 | Y/Y/Y | wheel | keep pin |
| pydantic | 2.13.3 | 2.13.4 | >=3.9 | Y/Y/Y | wheel | keep pin |
| pydantic-core | 2.46.3 | 2.47.0 | >=3.9 | Y/Y/Y | native wheels | keep pin |
| pyparsing | 3.3.2 | 3.3.2 | >=3.9 | Y/Y/Y | wheel | keep pin |
| python-dotenv | 1.2.2 | 1.2.2 | >=3.10 | Y/Y/Y | wheel | keep pin |
| requests | 2.33.1 | 2.34.2 | >=3.10 | Y/Y/Y | wheel | keep pin |
| tqdm | 4.67.3 | 4.70.0 | >=3.7 | Y/Y/Y | wheel | keep pin |
| typing-inspection | 0.4.2 | 0.4.2 | >=3.9 | Y/Y/Y | wheel | keep pin |
| typing-extensions | 4.15.0 | 4.16.0 | >=3.9 | Y/Y/Y | wheel | keep pin |
| uritemplate | 4.2.0 | 4.2.0 | >=3.9 | Y/Y/Y | wheel | keep pin |
| urllib3 | 2.6.3 | 2.7.0 | >=3.9 | Y/Y/Y | wheel | keep pin |

No transitive conflict was observed with the current pins. Newer versions are not adopted solely because they exist: the current snapshot already supports the full Python matrix, and broad upgrades would add unrelated change. Dependency updates should start from the two direct requirements, resolve a complete candidate snapshot, and rerun `npm run test:compat` before replacing pins.
