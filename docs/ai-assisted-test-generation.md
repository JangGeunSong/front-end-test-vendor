# AI-assisted 테스트 생성 전략

## 1. 목적

본 문서는 AI 보조 기반(AI-assisted) Playwright 테스트 코드 생성 전략을 설명한다.

이 프로젝트의 목표는 AI가 직접 보안 환경 내부에서 테스트를 수행하는 것이 아니라, 테스트 케이스 초안 및 Playwright 코드 초안을 빠르게 생성하는 생산성 보조 도구로 활용하는 것이다.

실제 운영 또는 회귀 테스트에 사용되는 최종 테스트 코드는 반드시 개발자가 검토하고 수정 및 승인한 이후에만 사용되어야 한다.

또한 공개 저장소에는 실제 고객사 URL, 내부 시스템 정보, 계정 정보, 테스트 데이터 등 민감한 정보가 포함되지 않도록 관리한다.

---

## 2. 기본 원칙

본 프로젝트는 AI 기반 생성 과정과 실제 실행 환경을 분리한다.

사외 / 로컬 환경
- 공개 가능하거나 비민감한 WEB 화면 분석
- 테스트 케이스 초안 생성
- Playwright 테스트 코드 초안 생성
- 테스트 구조 및 시나리오 설계

사내 / 보안 환경
- 외부 AI API 호출 금지
- 내부 URL, 계정, 고객 데이터 외부 노출 금지
- 검토 완료된 Playwright spec 파일만 실행
- 실제 업무 테스트 코드는 별도 내부 저장소에서 관리

---

## 3. 전체 워크플로우

1. Playwright 기반 scout 스크립트로 페이지 구조 수집
2. DOM 정보를 JSON 형태로 변환
3. 비민감한 JSON 데이터를 AI 모델에 전달
4. Playwright 테스트 코드 초안 생성
5. 생성된 코드를 tools/ai-generator/generated 에 저장
6. 개발자가 selector, assertion, 테스트 데이터 사용 여부 검토
7. 승인된 테스트만 tests/smoke 또는 tests/regression 으로 이동
8. 실제 내부 환경에서는 검토 완료된 Playwright spec 만 실행

---

## 4. 공개 저장소 정책

공개 저장소에는 민감한 업무 정보가 포함되어서는 안 된다.

커밋 금지 대상:

- 실제 서비스 URL
- 고객사명
- 내부 시스템명
- 로그인 계정 및 비밀번호
- 실제 테스트 데이터
- 내부 API Endpoint
- 운영 화면 캡처
- 실제 Playwright 실행 리포트
- 실제 업무 프로세스를 유추할 수 있는 테스트 코드

허용 예시:

- https://example.com
- https://yoursite.domain.url
- Dummy 메뉴명
- 샘플 테스트 시나리오
- 일반적인 로그인 / 조회 / 메뉴 접근 예시

---

## 5. AI의 역할

AI는 다음 작업을 보조할 수 있다.

- Playwright 테스트 코드 초안 생성
- 테스트 시나리오 제안
- Smoke Test 템플릿 생성
- Regression Test 템플릿 생성
- 누락 가능성이 있는 테스트 케이스 제안
- 반복 코드 리팩토링
- 테스트 결과 요약 초안 작성

하지만 AI를 최종 검증자로 신뢰해서는 안 된다.

다음 항목은 반드시 개발자가 검토해야 한다.

- 업무 규칙
- Selector 안정성
- Assertion 정확성
- 테스트 데이터 처리 방식
- 등록/수정/삭제 등 데이터 변경 작업
- 보안 이슈
- 실제 기능 검증 여부

---

## 6. 안전한 테스트 생성 원칙

AI가 생성하는 테스트는 우선적으로 안전한 시나리오 중심으로 구성한다.

초기 권장 범위:

- 페이지 접근
- 로그인 흐름
- 메뉴 이동
- 조회 화면 접근
- 목록 조회
- 상세 화면 접근

다음과 같은 데이터 변경 작업은 자동 실행하지 않는다.

- 등록(Create)
- 수정(Update)
- 삭제(Delete)
- 승인(Approval)
- 대량 실행(Batch)
- 파일 업로드
- 메시지 발송

이러한 동작은 우선 TODO 주석 형태로 생성하고, 개발자가 검토 후 활성화한다.

---

## 7. 디렉토리 구조 규칙

tools/ai-generator/
  agent_orchestrator.py
  scout.js
  generated/
  prompts/

tests/
  generated/
  smoke/
  regression/

docs/
  ai-assisted-test-generation.md
  test-case-list.md
  run-guide.md

### tools/ai-generator

AI 기반 테스트 코드 초안 생성 프로토타입 영역

### tools/ai-generator/generated

AI가 생성한 테스트 초안 저장 영역
운영 검증용 코드로 간주하지 않는다.

### tests/generated

검토 전 임시 Playwright spec 저장 영역

### tests/smoke

배포 직후 빠른 검증을 위한 Smoke Test 영역

### tests/regression

기능 회귀 검증용 Regression Test 영역

---

## 8. 사외 환경과 사내 환경 분리

### 사외 환경

사외 또는 로컬 환경에서는 AI API를 활용해 테스트 코드 초안을 생성할 수 있다.

입력:
- 비민감 DOM 구조 정보
- 샘플 테스트 시나리오
- 일반적인 페이지 설명

출력:
- Playwright spec 초안
- Assertion 추천
- 테스트 단계 추천

### 사내 환경

사내 또는 폐쇄망 환경에서는 검토 완료된 테스트 코드만 실행한다.

입력:
- 승인된 Playwright spec
- 내부 환경 설정
- 내부 테스트 계정
- 내부 테스트 데이터

출력:
- Playwright report
- Screenshot
- Trace
- 테스트 실행 결과 요약

사내 환경에서는 외부 AI API 호출이 필요하지 않아야 한다.

---

## 9. 기대 효과

이 접근 방식은 반복적인 테스트 코드 작성 비용을 줄이고, 회귀 테스트 기반을 더 빠르게 구축하기 위한 목적을 가진다.

기대 효과:

- 테스트 초안 작성 속도 향상
- 반복 Playwright 코드 작성 감소
- 테스트 구조 일관성 확보
- Smoke / Regression Test 확장 용이
- AI 생성 코드와 운영 코드의 명확한 분리
- 폐쇄망 및 보안 환경에서도 적용 가능한 구조 확보

---

## 10. 요약

본 프로젝트는 AI를 자동 QA 판단 시스템이 아니라 테스트 코드 생성 보조 도구로 활용한다.

최종 책임은 개발자에게 있다.

AI는 초안을 생성한다.
개발자는 정확성을 검증한다.
Playwright는 반복 가능한 테스트를 수행한다.
리포트는 배포 검증을 지원한다.
