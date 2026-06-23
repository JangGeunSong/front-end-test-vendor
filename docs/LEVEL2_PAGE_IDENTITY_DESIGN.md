# Level 2 Page Identity Test Design

## Purpose

Level 2 Page Identity Test의 목적은 메뉴 클릭 후 의도한 페이지에 도달했는지 확인하는 것이다.

현재 generated 테스트는 `Level 1 Navigation Smoke Test MVP`이다. Level 1은 GNB hover/click, URL/hash 이동, 명백한 navigation error 없이 페이지에 접근 가능한지를 확인한다.

Level 2는 전수 테스트가 아니다. Level 2는 페이지 내부의 안정적인 식별 신호를 이용해 "이 메뉴가 의도한 페이지로 이동했는가"를 확인하는 Page Identity 검증 단계이다.

## Current Level 1 Pipeline

현재 Level 1 생성 흐름은 다음과 같다.

1. `agent_orchestrator.py` 실행
2. `scout.js` 실행
3. GNB/menu 후보 수집
4. `scout_result.json` 생성
5. `agent_orchestrator.py`가 menu candidate를 추출
6. `menu_map.json` 생성
7. LLM prompt에 `menuTree` 전달
8. `tests/generated/generated_menu_access.spec.js` 생성
9. generated Playwright 테스트 실행

현재 Level 1 generated spec은 주로 다음을 검증한다.

- depth1 GNB hover
- depth2/depth3 메뉴 click
- URL/hash 이동
- 메뉴 접근 중 명백한 오류 여부

현재 Level 1은 다음을 검증하지 않는다.

- 도착 페이지의 heading
- 대표 텍스트
- main/content 영역
- table/form/tab 존재 여부
- 조회 결과
- safe interaction
- 업무 시나리오

## Future Level 2 Pipeline

Level 2 구현 후 목표 흐름은 다음과 같다.

1. `agent_orchestrator.py` 실행
2. `scout.js` 실행
3. GNB/menu 후보 수집
4. 각 메뉴 후보를 안전하게 열고 클릭
5. 메뉴 클릭 후 현재 페이지의 identity 신호 수집
6. `scout_result.json`에 `pageProfile` 후보 저장
7. `agent_orchestrator.py`가 `menu_map.json` 또는 별도 generation input에 page identity 정보를 포함
8. LLM prompt에 `menuTree`와 `pageProfile` 전달
9. generated spec에 Page Identity assertion 생성
10. generated 테스트 실행으로 메뉴 접근과 page identity를 함께 확인

Level 2에서도 위험 액션은 실행하지 않는다. 버튼, input, form은 식별 신호로 수집할 수 있지만 자동 클릭이나 입력 대상은 아니다.

## scout_result.json Extension Candidate

`scout_result.json`의 기존 Level 1 메뉴 탐색 결과에 메뉴별 page identity 후보를 추가하는 방향을 우선 검토한다.

후보 구조:

```json
{
  "url": "https://sample.local",
  "count": 0,
  "elements": [],
  "pageProfiles": [
    {
      "menuPath": ["Showcase", "단말", "NB-IoT"],
      "menu": {
        "text": "NB-IoT",
        "href": "",
        "id": "5_1",
        "ngClick": "serviceTab('nbiot')",
        "menuDepth": 3
      },
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
  ]
}
```

설계 메모:

- `pageProfiles`는 메뉴 클릭 후 수집한 페이지 식별 후보 목록이다.
- `menuPath`는 어떤 메뉴 경로에서 수집한 profile인지 추적하기 위한 값이다.
- `menu`는 기존 menu candidate 중 pageProfile과 연결할 최소 식별 정보만 포함한다.
- `navigation`은 실제 도착 URL/hash/title을 기록한다.
- `pageProfile`은 Level 2 Page Identity 검증용 후보 데이터이다. 전수 테스트용 데이터가 아니다.

## pageProfile Collection Targets

### headings

수집 대상:

- `h1`
- `h2`
- `h3`
- `role=heading`

용도:

- 가장 우선순위가 높은 page identity 후보
- 메뉴명 또는 업무 영역명과 조합해 도착 페이지 판단에 사용

주의:

- 공통 layout heading은 제외한다.
- 숨김 heading은 기본적으로 제외한다.

### representativeTexts

수집 대상:

- 페이지 고유 제목
- 업무 영역명
- 페이지별 고유 안내 문구
- 해당 페이지에서만 안정적으로 보이는 section title

용도:

- heading, URL/hash, main container, table/form 존재 여부와 조합해 page identity 판단

주의:

- 단독 신호로 쓰기보다 다른 안정 신호와 조합하는 것을 권장한다.
- 공통 문구와 반복 label은 제외한다.

### mainContainers

수집 대상:

- `main`
- `[role="main"]`
- 주요 content wrapper
- 화면별 고유 container selector 후보

용도:

- 페이지가 빈 화면이 아니며 주요 content 영역이 렌더링되었는지 확인

### tables

수집 대상:

- table selector
- caption
- header text
- row count 후보

용도:

- 목록형 페이지 식별 신호
- table 존재 여부 중심으로 사용

주의:

- Level 2에서는 table data correctness를 검증하지 않는다.

### forms

수집 대상:

- form selector
- label text
- input/select/textarea 후보

용도:

- 검색/조회 조건 영역 또는 상세 form 존재 여부 확인

주의:

- Level 2에서는 입력하지 않는다.
- 저장/등록/수정 button은 클릭하지 않는다.

### tabs

수집 대상:

- tablist selector
- tab text
- selected tab 후보

용도:

- tab 기반 페이지의 identity 신호

### buttons

수집 대상:

- 조회
- 검색
- 필터
- 탭성 버튼
- 페이지 식별에 도움이 되는 안정적 버튼 text

용도:

- 버튼 존재 여부를 page identity 신호로 사용

주의:

- Level 2에서는 버튼을 클릭하지 않는다.
- 버튼은 존재 여부만 확인한다.

### errorIndicators

수집 대상:

- 404 page
- 500 error page
- blank page signal
- unauthorized
- forbidden
- visible error text
- expected URL/hash not reached

용도:

- 페이지 도착 실패 또는 오류 화면 판단

## representativeTexts Selection Rules

`representativeTexts`는 페이지 식별에 도움이 되는 안정적인 텍스트만 포함한다.

우선 포함 후보:

- 해당 페이지의 고유 제목
- 업무 영역명
- 화면별 고유 안내 문구
- 특정 페이지에만 등장하는 section title

제외 후보:

- GNB text
- footer text
- header text
- 공통 layout text
- 반복 label
- 모든 페이지에 나오는 문구
- 너무 일반적인 text

단독 page identity 신호로 쓰지 않을 예:

- 로그인
- 메뉴
- 고객센터
- 검색
- 목록
- 확인
- 취소

권장 판단 방식:

- `representativeTexts` 단독 assertion보다 조합 assertion을 우선한다.
- 예: URL/hash + heading
- 예: heading + main container
- 예: representative text + table presence
- 예: representative text + form presence

## Generated Spec Assertion Candidates

Level 2 generated spec은 메뉴 클릭 후 다음 assertion 후보를 생성할 수 있다.

### URL/hash Assertion

```js
await expect(page).toHaveURL(/showcaseServiceMain/);
```

사용 조건:

- `href` 또는 수집된 `navigation.hash`가 안정적인 경우

### Heading Assertion

```js
await expect(page.getByRole('heading', { name: '단말' })).toBeVisible();
```

사용 조건:

- heading 후보가 있고 공통 layout heading이 아닌 경우

### Representative Text Assertion

```js
await expect(page.getByText('단말 서비스 안내', { exact: true })).toBeVisible();
```

사용 조건:

- 해당 문구가 페이지별 고유 문구일 때
- 가능하면 URL/hash, heading, main container 등과 함께 사용

### Main Container Assertion

```js
await expect(page.locator('main')).toBeVisible();
```

사용 조건:

- main/content 영역 selector가 안정적일 때

### Table/Form/Tab Presence Assertion

```js
await expect(page.locator('table')).toBeVisible();
await expect(page.locator('form')).toBeVisible();
await expect(page.getByRole('tab', { name: 'NB-IoT' })).toBeVisible();
```

사용 조건:

- 해당 구조가 page identity에 도움이 될 때

### Error Indicator Negative Assertion

```js
await expect(page.getByText(/404|500|권한|오류/)).toHaveCount(0);
```

주의:

- text pattern은 사이트별로 조정이 필요하다.
- 너무 광범위한 negative assertion은 false positive/negative를 만들 수 있다.

## Level 2 Safety Rules

Level 2는 page identity 검증 단계이므로 다음 규칙을 따른다.

- 버튼 클릭 금지
- input 입력 금지
- select 변경 금지
- checkbox/radio 변경 금지
- 저장/삭제/등록/수정/승인/발송/업로드 등 데이터 변경 액션 금지
- 모호한 액션은 실행하지 않고 TODO로 남김
- pageProfile의 button/form/input 정보는 식별 신호로만 사용

Generated spec에 모호한 후보가 있으면 다음처럼 남긴다.

```js
// TODO: Page identity candidate exists, but action is ambiguous. Do not click automatically.
```

## Implementation Order

권장 구현 순서:

1. `docs/JSON_SCHEMA.md`의 `pageProfile` 후보 구조 최종 검토
2. `scout.js`에 pageProfile 수집 실험 코드 추가
3. 메뉴 클릭 후 navigation 정보 수집
4. headings/mainContainers/errorIndicators 우선 수집
5. representativeTexts 필터링 규칙 적용
6. tables/forms/tabs/buttons 존재 후보 수집
7. `scout_result.json`에 `pageProfiles` 추가
8. `agent_orchestrator.py`에서 generation input에 pageProfile 연결
9. Level 2 prompt 규칙 추가
10. generated spec에 page identity assertion 생성
11. generated spec 실행 및 visual/debug 확인
12. 안정화 후 `docs/TEST_LEVELS.md`, `docs/JSON_SCHEMA.md`, `docs/PROMPT_STRATEGY.md` 갱신

초기 구현은 headings, URL/hash, main container, errorIndicators부터 시작하는 것이 좋다. tables/forms/tabs/buttons는 두 번째 단계로 확장한다.

## Verification Commands After Implementation

구현 후 확인 명령 후보:

```powershell
npm run ai:generate
```

```powershell
npm run test:generated
```

```powershell
npm run test:generated:visual
```

Python 문법 확인:

```powershell
python -m py_compile tools/ai-generator/agent_orchestrator.py
```

Node.js 문법 확인:

```powershell
node -c tools/ai-generator/scout.js
```

검증 시 확인할 항목:

- `scout_result.json`에 `pageProfiles`가 생성되는가
- 각 `pageProfile`이 menuPath와 연결되는가
- generated spec에 Page Identity assertion이 생성되는가
- Level 2 assertion이 버튼 클릭이나 입력을 수행하지 않는가
- 기존 Level 1 navigation flow가 깨지지 않는가
