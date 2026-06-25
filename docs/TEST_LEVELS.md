# Test Levels

## Purpose

이 문서는 WEB 자동 테스트 AX 패키지의 테스트 자동화 성숙 단계를 정의한다.

현재 프로젝트는 특정 사이트 전용 테스트 저장소가 아니라, 대상 URL에서 수집한 UI 구조를 바탕으로 Playwright generated spec을 만들고 검수하는 범용 테스트 생성 도구를 목표로 한다.

## Current Status

현재 구현 상태는 다음과 같다.

- Level 1 Navigation Smoke Test: 구현 완료 및 사용 중
- Level 2 Page Identity Test MVP: 구현 및 validator 연동 단계
- Generated Spec Validator: generated spec 품질 게이트로 사용 중
- Level 3 Safe Interaction Test: Future
- Level 4 Business Scenario Test: Future

현재 generated 테스트는 Level 1 navigation 검증에 더해 Level 2 page identity 후보 assertion을 보수적으로 생성한다. 단, full test automation 또는 업무 시나리오 자동화로 보지 않는다.

## Level Summary

| Level | Name | Purpose | Current Status |
| --- | --- | --- | --- |
| Level 1 | Navigation Smoke Test | 메뉴 이동과 기본 접근 가능 여부 확인 | Implemented |
| Level 2 | Page Identity Test MVP | 메뉴 클릭 후 의도한 페이지 도달 여부 식별 | Implemented MVP |
| Level 3 | Safe Interaction Test | 데이터 변경 없는 안전 상호작용 확인 | Future |
| Level 4 | Business Scenario Test | 사람이 정의한 업무 흐름 검증 | Future |

## Level 1 - Navigation Smoke Test

### Scope

Level 1은 대상 사이트의 navigation 또는 GNB 메뉴를 통해 주요 페이지에 접근 가능한지 확인한다.

포함 범위:

- depth1 hover 또는 navigation open
- depth2 메뉴 클릭
- depth3 child 메뉴 클릭
- URL 또는 hash 이동 확인
- 명백한 navigation 오류 확인

명백한 오류 예:

- 404 page
- 500 error page
- blank page
- unauthorized 또는 forbidden page
- expected URL/hash not reached
- visible error indicator text

### Completed

- generated 테스트는 `tests/generated`에 저장된다.
- navigation helper는 `utils/gnb.js`를 사용한다.
- 동일한 depth3 메뉴명이 여러 parent 아래에 있어도 parent-aware helper로 클릭할 수 있다.
- `HIGHLIGHT=true` visual debug를 지원한다.

## Level 2 - Page Identity Test MVP

### Definition

Level 2는 전수 테스트가 아니다.

Level 2는 메뉴 클릭 후 의도한 페이지에 도달했는지 확인하는 page identity 검증 단계이다. 현재는 MVP 구현 상태이며, pageProfiles에서 수집된 안정적인 후보를 바탕으로 제한적인 assertion과 highlight를 생성한다.

### Scope

Level 2 MVP는 다음 후보를 보수적으로 사용한다.

- URL/hash
- heading
- main content container
- 일부 안정적인 representative text
- table/form/tab 후보는 안정적인 수집 selector가 명확할 때만 제한적으로 사용
- buttons는 클릭하지 않고 강한 assertion 대상으로 사용하지 않음

Page Identity assertion 우선순위:

1. URL/hash
2. heading
3. mainContainer
4. representativeTexts

### pageProfile Data

`scout.js`는 메뉴 클릭 후 page identity 후보를 `pageProfiles`로 수집한다.

후보 구조:

```json
{
  "menuPath": [],
  "navigation": {
    "url": "",
    "hash": "",
    "documentTitle": ""
  },
  "pageProfile": {
    "headings": [],
    "representativeTexts": [],
    "mainContainers": [],
    "tables": [],
    "forms": [],
    "tabs": [],
    "buttons": [],
    "errorIndicators": []
  }
}
```

`pageProfiles`는 전수 검증 데이터가 아니라 Level 2 Page Identity 검증용 후보 데이터이다.

### representativeTexts Criteria

`representativeTexts`는 단독 신호보다 heading, URL/hash, mainContainer, table/form 존재 여부와 조합해서 사용한다.

포함 후보:

- 페이지 고유 제목
- 업무 영역명
- 페이지 고유 안내 문구
- 안정적인 section title

제외 후보:

- 공통 layout text
- header/footer/GNB text
- 반복 라벨
- 너무 일반적인 text
- 운영 데이터, 목록 데이터, 공지 제목, FAQ 질문
- 제품명, 모델명, 요금제 숫자처럼 변동 가능성이 큰 text

### Validator Role

Generated Spec Validator는 Level 2 안정화 품질 게이트이다.

validator는 다음을 확인한다.

- generated spec이 수집된 selector 근거를 벗어나지 않는지
- menuTree의 depth2/depth3 step coverage가 누락되지 않았는지
- depth3 child 클릭에 parent context와 cssPath가 포함되는지
- 불안정한 assertion 후보가 사용되지 않았는지

validator error가 있으면 generated spec을 직접 고치지 않고 prompt, scout/pageProfile 수집, validator 규칙을 보완한 뒤 재생성한다.

## Level 3 - Safe Interaction Test

### Definition

Level 3는 Future 단계이다.

Level 3는 input 테스트 전체가 아니라 데이터 변경 없는 안전 상호작용만 대상으로 한다.

### Future Scope

- 검색어 입력
- filter 선택
- 조회 버튼 클릭
- tab 전환
- pagination
- read-only detail open
- 데이터 변경 없는 sort 또는 page size 변경

### Risky Actions

다음 액션은 자동 실행 대상이 아니다.

- save
- delete
- register
- create
- update
- modify
- approve
- reject
- send
- submit
- upload
- 데이터 변경 가능성이 있는 reset

모호한 action은 클릭하지 않고 TODO로 남긴다.

## Level 4 - Business Scenario Test

Level 4는 Future 단계이다.

사람이 정의한 TC 기반 업무 흐름 테스트이며 다음이 필요하다.

- 테스트 계정
- 테스트 데이터
- 전제조건
- 기대 결과
- 업무 규칙
- 승인된 scenario
- cleanup 또는 rollback 전략

UI 구조만으로 Level 4를 안전하게 자동 생성하지 않는다.

## Generated Test Promotion Criteria

generated 테스트는 사람이 검토하기 전까지 `tests/generated`에 머문다.

### Before Promoting To tests/smoke

smoke 승격 조건:

- `npm run ai:validate` 통과
- 데이터 변경 액션 없음
- 빠른 실행 가능
- visual/debug 확인 완료
- 핵심 navigation 또는 기본 availability 경로 검증
- 반복 실행 안정성 확인
- volatile data 의존성 없음
- 수동 개입 없음

### Before Promoting To tests/regression

regression 승격 조건:

- `npm run ai:validate` 통과
- 테스트 데이터가 명확함
- 전제조건이 명확함
- 반복 검증 가치가 명확함
- 기대 결과가 명시됨
- side effect가 이해되고 통제됨
- 사람이 scenario를 검토하고 승인함

## Future Work Candidates

- Level 3 interactionProfile 수집 후보 구체화
- safe/risky action classifier 설계
- generated-to-smoke/regression review checklist 고도화
- generator option으로 test level 선택
- Level 4 human-authored TC 연동 방식 검토
