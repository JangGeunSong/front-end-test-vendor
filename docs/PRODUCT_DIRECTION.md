# Product Direction

## Purpose

이 프로젝트는 URL-first WEB test generation AX pipeline을 지향한다.

목표는 “AI가 Playwright 코드를 자유롭게 작성하는 도구”가 아니라, 실제 브라우저 탐색 결과를 structured test plan으로 만들고 validator와 deterministic renderer를 거쳐 실행 가능한 Playwright spec을 생성하는 검증 가능한 자동화 흐름이다.

## Why AX

이 프로젝트를 AX로 보는 이유는 사람이 직접 수행하던 테스트 준비 과정을 AI와 자동화 파이프라인으로 재설계하기 때문이다.

기존 수작업 흐름:

- 대상 사이트 메뉴 탐색
- 테스트 케이스 초안 작성
- 페이지 식별 근거 선정
- Playwright spec 작성
- 실행 실패 원인 분류
- smoke/regression 승격 판단

AX pipeline 흐름:

- 브라우저 기반 scout가 rendered DOM과 navigation 후보를 수집한다.
- projection 단계가 primary navigation과 non-primary 후보를 분리한다.
- LLM이 structured test plan JSON에서 template과 page identity 근거를 제안한다.
- validator가 schema, coverage, 중복, selector 근거를 검증한다.
- renderer가 Playwright code shape를 deterministic하게 생성한다.
- 사람은 코드 줄 단위 작성보다 생성 근거, coverage, 실행 결과를 검수한다.

목표는 완전 자율 QA 대체가 아니다. 목표는 반복적인 초안 작성과 탐색 비용을 줄이고, 사람이 승인 가능한 근거를 남기는 테스트 자동화 보조다.

## Product Philosophy

- 완벽한 자동 추출보다 판단 근거가 남는 자동 추출을 우선한다.
- LLM 자유 코드 생성보다 structured plan + validator + renderer를 우선한다.
- 사용자 무보정 100%보다 80% 자동 생성 + 20% 검수/보정을 현실적인 목표로 둔다.
- 테스트 실행 파일만 생성하기보다 coverage, projection 결과, page identity 근거를 함께 제공한다.
- 불확실한 케이스는 강한 assertion을 만들지 않고 TODO 또는 낮은 수준의 검증으로 남긴다.

## Target Users

- QA 전담 인력이 없는 소규모 제품 팀
- 1인 SaaS 또는 소규모 비즈니스 운영자
- 문서와 테스트 케이스가 부족한 레거시 웹 제품 담당자
- 유지보수/SM 업체
- 외부 SaaS 사용이 어렵거나 제한적인 on-premise/폐쇄망 조직

## Current Scope

현재 지원 범위:

- Level 1 Navigation Smoke Test
- Level 2 Page Identity Test MVP
- structured test plan validation
- deterministic Playwright rendering
- cross-site primary navigation projection
- generated artifact와 source/docs 분리
- human-in-the-loop 승격 흐름

현재 비지원 또는 후순위 범위:

- 로그인/인증 세션 자동 처리
- 등록/수정/삭제/결제 같은 데이터 변경 action
- 완전한 business scenario 자동 생성
- 모든 사이트 100% 무보정 지원
- visual regression
- self-healing selector
- full test management dashboard

## Technical Product Direction

단기 방향:

- primary navigation projection 품질 확대
- page identity 후보 품질 개선
- structured plan validator와 compare gate 강화
- renderer output 안정성 강화
- cross-site validation matrix 확대

중기 방향:

- local/on-premise runner 옵션 정리
- target URL별 workspace와 산출물 관리
- 분석 URL 수, pageProfile 수, generated test case 수 제한 정책 검토
- 검수 UI 또는 project workspace 확장
- 폐쇄망/사내망에서 외부 AI API 없이 사용할 수 있는 실행 모델 검토

이 방향은 영업용 포장보다 기술적 제품 방향을 정리하기 위한 것이다. 현재 구현된 범위와 future work를 분리해 다룬다.
