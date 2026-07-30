# Public Repository Data Policy

## Purpose

이 문서는 공개 repository에 보존할 수 있는 제품 개발 정보와 공개하면 안 되는 discovery·업무·환경 정보를 구분한다. 기술적 architecture와 검증 근거는 유지하되 특정 회사, 고객사 또는 내부 시스템과 불필요하게 연결되는 문맥은 UI/site profile 중심으로 일반화한다.

폐쇄망 실행과 외부 LLM 사용 경계는 [OFFLINE_NETWORK_POLICY.md](OFFLINE_NETWORK_POLICY.md), generated JSON별 민감도는 [JSON_SCHEMA.md](JSON_SCHEMA.md)를 함께 따른다.

## Repository Rules

1. 회사 source code, 비공개 설정, 내부 업무 데이터, 개인정보와 인증정보를 공개 repository에 넣지 않는다.
2. Public website validation은 회사·서비스 이름보다 UI 유형과 generic result로 기록한다. 예: `complex public multi-depth navigation site: 41 navigation cases PASS`.
3. 회사·고객사 이름은 제품 architecture나 재현 가능한 공개 fixture에 꼭 필요하지 않다면 일반화한다. 실제 target에서 유래한 menu label/relation, route/hash, handler argument, DOM id/class/cssPath와 page identity text도 회사명이 없더라도 synthetic sample로 바꾼다.
4. `scout_result.json`, `menu_map.json`, generated spec, trace, screenshot, HTML report와 run log는 기본적으로 commit하지 않는다.
5. Scout result와 menu map에는 실제 화면 label, URL, selector와 주변 text가 포함될 수 있으므로 public URL에서 수집했더라도 자동으로 공개 가능한 데이터로 간주하지 않는다.
6. 외부 LLM에는 sample, anonymized 또는 명시적으로 승인된 최소 구조 데이터만 전달한다.
7. Secret이 한 번이라도 commit됐다면 Git history에서 제거하는 것만으로 충분하지 않다. 해당 credential을 즉시 revoke/rotate하고 관련 서비스 audit를 수행한다.
8. URL이 공개되어 있다는 이유만으로 response body, DOM 전체, cookie, storage state, request/response header, network log, screenshot 또는 trace 전체를 공개하지 않는다.
9. Commit 전에 아래 sanitization checklist로 current tree와 staged diff를 확인한다.

## Public Reference Allowlist

다음 범주는 목적이 명확할 때 유지할 수 있다.

- Playwright, Node.js, Python과 공식 documentation URL
- 이 repository 자체의 public GitHub URL
- `package-lock.json`의 npm registry URL, integrity와 공개 package metadata
- Local MVP의 `127.0.0.1`/`localhost` endpoint
- IANA reserved example domain과 repository의 neutral fixture host: `example.test`, `example.com`, `target.example.com`, `sample.example.com`
- `playwright.dev`: 공식 공개 documentation site의 generic navigation/interaction regression 근거로 사용한 경우

Allowlist는 full DOM, cookie, trace 또는 generated discovery artifact 공개를 허용하지 않는다. 다른 public company/service domain은 재현에 필수인 tracked fixture가 아니라면 site profile로 일반화한다.

## Data Requiring Generalization

- 회사, 고객사, 서비스명과 실제 검증 결과의 결합
- public domain을 포함한 historical command transcript
- 공개 화면에서 수집한 실제 menu label, product/model name과 site-specific operational text
- 실제 target의 `menuTree`/`menuPath` relation, route/hash, `ngClick` argument, DOM selector와 heading/representative text sample
- local run ID, session ID, user directory와 absolute workspace path
- 실제 장애 문맥을 특정 조직이나 운영 환경과 연결하는 설명

기술적 수치가 민감하지 않다면 generic site profile 아래 보존할 수 있다.

## Data That Must Not Be Committed

- private hostname, IP range, network topology, firewall rule와 deployment endpoint
- API key, token, password, cookie, session, private key와 storage state
- 직원 이름·사번·내부 이메일, 고객·사용자·계약·device·발송 데이터
- 내부 SQL, source fragment, configuration, deployment script와 test case copy
- 공개 화면만으로 알 수 없는 내부 menu, status, incident 또는 vulnerability detail
- 개인 PC absolute path와 IDE/session-only state

## Generated Artifact Handling

Generated discovery/execution artifact는 source나 neutral fixture와 다르다.

- 기본 ignore 대상: `tests/generated/`, `tools/ai-generator/generated/`, `test-results/`, `playwright-report/`
- Schema/example 목적의 tracked fixture는 reserved sample URL과 anonymized label만 사용한다.
- Public site smoke 결과는 count, PASS/FAIL/SKIPPED, browser/retry 조건과 UI profile로 기록하고 raw artifact는 commit하지 않는다.
- Raw artifact를 fixture로 승격해야 한다면 실제 label/URL/text를 최소화하고 별도 review를 거친다.

## Commit Sanitization Checklist

- `git status --short`와 staged diff에 generated artifact가 없는지 확인
- 회사·고객사·서비스명과 non-allowlisted domain 검색
- target-derived menu/path/handler/selector/page-identity example 검색
- private IPv4, internal hostname, absolute Windows/Unix path 검색
- API key/token/password/private-key header와 high-risk credential pattern 검색
- email, phone, employee/customer identifier 검색
- JSON parse, Markdown link, package lock/source syntax와 관련 fixture 검증
- public URL inventory를 allowlist와 대조
- secret이 발견되면 값을 출력하지 말고 masking해 보고한 뒤 rotation과 history cleanup을 별도 수행

## History Cleanup

Current tree에서 파일을 수정해도 과거 commit, tag, fork, archive와 clone에는 이전 내용이 남을 수 있다. Full-history sanitization은 별도 backup과 rewrite clone에서 검증한 뒤 수행한다. Author identity, repository owner, license, package name과 public repository URL은 별도 승인 없이 변경하지 않는다.
