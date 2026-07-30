# Offline Network Policy

목적:
- 폐쇄망 웹 시스템에서 테스트 자동화를 수행하되, 실제 업무 데이터가 외부 AI API로 전송되지 않도록 한다.
- 공개 repository에 보존할 수 있는 정보와 sanitization 절차는 [PUBLIC_REPOSITORY_DATA_POLICY.md](PUBLIC_REPOSITORY_DATA_POLICY.md)를 따른다.

원칙:
1. 폐쇄망 내부에서는 외부 LLM API를 직접 호출하지 않는다.
2. 폐쇄망에서 수집한 scout_result.json은 외부로 반출하지 않는다.
3. 사외 개발 환경에서는 샘플 페이지 또는 익명화된 JSON만 사용한다.
4. 테스트 생성 로직은 사외에서 개발하고, 폐쇄망에는 실행 가능한 코드와 템플릿만 반입한다.
5. prompt, schema, generator는 외부에서 개발 가능하지만 실제 업무 URL, 계정, 메뉴명, 고객정보는 포함하지 않는다.

허용:
- 샘플 HTML
- 익명화된 메뉴 구조
- 가짜 URL
- 더미 selector
- 테스트용 계정명

금지:
- 실제 업무 URL
- 실제 계정/비밀번호
- 실제 고객 데이터
- 폐쇄망 시스템 화면 캡처
- 실제 운영 메뉴명 전체 반출

Node dependency packaging:

- repository에 commit된 최소 `node_modules`는 폐쇄망 실행 보장을 위한 vendor baseline이며 local artifact나 삭제 대상이 아니다.
- 외부 registry에 접근할 수 없는 폐쇄망에서는 `npm ci`를 실행하지 않고 vendor dependency를 `npm ls --depth=0`로 확인한다.
- 외부망에서 package-lock 재현성을 검증하는 `npm ci`는 별도의 disposable clean clone에서 수행한다.
- vendor dependency와 `package-lock.json`의 변경은 dependency 검토 작업으로 명시적으로 관리하며 runtime generated artifact와 구분한다.
