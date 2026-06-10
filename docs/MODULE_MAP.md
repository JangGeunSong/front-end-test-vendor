# Module Map

이 문서는 AI Agent와 개발자가 프로젝트 내 주요 파일/디렉터리의 책임을 빠르게 파악하기 위한 문서이다.  
새로운 기능을 추가하거나 기존 코드를 수정할 때, 먼저 이 문서를 기준으로 영향 범위를 확인한다.

---

## tools/ai-generator/agent_orchestrator.py

- 전체 테스트 생성 파이프라인을 오케스트레이션한다.
- scout.js 실행, JSON 로딩, LLM 호출, Playwright spec 저장을 담당한다.
- 향후 external-ai mode와 offline/template mode를 분리할 경우 이 파일은 실행 흐름 제어만 담당해야 한다.
- LLM prompt 세부 구성, template 생성 세부 로직은 별도 모듈로 분리하는 것을 원칙으로 한다.

---

## tools/ai-generator/scout.js

- Playwright 또는 Node.js 기반으로 웹 UI를 탐색한다.
- 메뉴, 링크, 버튼, 입력 필드 등 테스트 생성에 필요한 UI 요소를 수집한다.
- 수집 결과는 scout_result.json 형태로 저장한다.
- scout.js는 테스트 코드를 생성하지 않는다.
- scout.js는 웹 UI 구조 수집까지만 담당한다.

---

## tools/ai-generator/generated/scout_result.json

- scout.js의 원본 수집 결과이다.
- 웹 화면에서 발견한 메뉴, 링크, 버튼, 입력 필드, selector 후보 등이 포함된다.
- 이 파일은 원본 탐색 결과이므로 사람이 직접 편집하지 않는 것을 원칙으로 한다.
- 폐쇄망 실제 데이터가 포함될 수 있으므로 외부 반출 대상에서 제외한다.

---

## tools/ai-generator/generated/menu_map.json

- 테스트 생성에 필요한 메뉴 구조화 결과이다.
- scout_result.json에서 테스트 생성에 필요한 메뉴/경로 정보를 정제한 산출물이다.
- Playwright 테스트 생성 시 주요 입력 데이터로 사용된다.
- 실제 업무 메뉴명이 포함될 수 있으므로 외부 반출 시 익명화가 필요하다.

---

## tools/ai-generator/prompts/

- LLM 테스트 생성 prompt를 관리한다.
- Playwright spec 생성 규칙, 금지 액션, 출력 형식 등을 정의한다.
- prompt를 변경할 경우 docs/PROMPT_STRATEGY.md도 함께 갱신한다.
- 폐쇄망 실제 URL, 계정, 업무 데이터, 운영 메뉴명을 prompt에 직접 포함하지 않는다.

---

## tests/generated/

- AI 또는 generator가 생성한 Playwright 테스트를 저장한다.
- 이 디렉터리의 테스트는 재생성 가능한 산출물로 본다.
- 사람이 검증하기 전까지 안정 테스트로 간주하지 않는다.
- 검증 완료된 테스트는 tests/smoke 또는 tests/regression으로 승격할 수 있다.

---

## tests/smoke/

- 사람이 검증한 최소 안정성 테스트를 저장한다.
- 배포 전 또는 기본 동작 확인 시 우선 실행하는 테스트 영역이다.
- 로그인, 주요 메뉴 접근, 핵심 화면 로딩 확인 등 안전한 테스트만 포함한다.
- 데이터 변경, 저장, 삭제, 승인, 발송 등 위험 액션은 포함하지 않는다.

---

## tests/regression/

- 사람이 검증한 회귀 테스트를 저장한다.
- 기존 기능이 변경 후에도 정상 동작하는지 확인하기 위한 테스트 영역이다.
- 데이터 변경이 필요한 테스트는 별도 테스트 계정/테스트 데이터 기준으로만 작성한다.
- 자동 생성 테스트를 바로 이 디렉터리에 넣지 않는다.

---

## utils/gnb.js

- 네비게이션 메뉴 조작을 보조하는 Playwright 유틸이다.
- 현재 프로젝트에서는 네비게이션 hover 후 하이라이트 표시 처리를 위해 highlight.js와 별도로 분리되어 있다.
- 메뉴 접근 테스트에서 GNB 구조를 다룰 때 사용한다.
- 단순한 페이지 이동 로직 전체를 이 파일에 몰아넣지 않는다.
- 하이라이트 표시 자체는 highlight.js가 담당한다.

---

## utils/highlight.js

- 테스트 중 화면 하이라이트 표시를 담당한다.
- Playwright 실행 중 현재 클릭/검증 대상 요소를 시각적으로 표시하기 위한 유틸이다.
- 테스트 검증 로직 자체를 담당하지 않는다.
- 하이라이트는 디버깅과 리포트 가독성을 높이기 위한 보조 기능이다.