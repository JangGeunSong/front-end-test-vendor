# Generated Spec Validation

## Purpose

Generated Spec Validator는 AI가 생성한 `tests/generated/generated_menu_access.spec.js`를 사람이 검토하기 전에 정적으로 점검하는 품질 게이트이다.

이 validator는 테스트를 실행하지 않는다. 대신 `generated spec`, `menu_map.json`, `scout_result.json`을 함께 읽어 prompt 규칙 위반, 위험한 selector, menuTree coverage 누락 가능성을 리포트한다.

## Command

```powershell
npm run ai:validate
```

실제 실행 스크립트:

```powershell
python tools/ai-generator/validate_generated_spec.py
```

기본 입력 파일:

- `tests/generated/generated_menu_access.spec.js`
- `tools/ai-generator/generated/menu_map.json`
- `tools/ai-generator/generated/scout_result.json`

## Exit Code

- error가 하나라도 있으면 exit code `1`
- warning만 있으면 exit code `0`
- 문제가 없으면 `validation passed` 메시지 출력

## Error Criteria

Error는 generated spec이 현재 prompt 규칙을 명확히 위반한 경우이다.

대표 error:

- 금지 selector 사용
  - `page.locator('table')`
  - `page.locator('form')`
  - `page.locator('[role="tab"]')`
  - `div#developGuide01-01` 단독 selector
  - `div#verifyGuide01-01` 단독 selector
- `pageProfiles`에 수집된 full `cssPath`를 임의로 축약한 selector 사용
- depth3 child 메뉴 클릭에서 `clickVisibleSubMenuByText` options에 `cssPath` 누락
- depth3 child 메뉴를 `clickVisibleMenuByText(page, childText)`로 단독 클릭
- `menuTree`의 depth2/depth3 메뉴가 generated spec의 `test.step`에 누락

Validator는 다음 generated spec 패턴을 정상 coverage로 인정한다.

- `clickVisibleSubMenuByText(page, '부모', '자식', { cssPath: '...' })` literal call
- 정적 배열 + `for...of` loop
  - parent test 내부에서 `const children = [...]`를 사용함
  - 배열 객체에 `text`와 `cssPath` literal이 있음
  - loop는 `for (const child of children)` 형식을 사용함
  - loop 내부에서 `clickVisibleSubMenuByText(page, parentText, child.text, { ... cssPath: child.cssPath ... })`를 호출함
  - loop 내부 `test.step` 제목에 ``Depth 3: ${child.text}``가 포함됨

단, menu `cssPath`는 `menu_map.json`에서 온 literal 값을 배열에 포함해야 한다. `id` 기반 template literal이나 string operation으로 `cssPath`를 계산하는 방식은 금지한다.

금지 예:

```js
cssPath: `a#\\3${tab.id.replace('_', ' _')}`
```

허용 예:

```js
{ text: 'NB-IoT', id: '4_1', ngClick: "modemTab('nbiot')", cssPath: "a#\\34 _1" }
```

복잡해서 정적으로 분석하기 어려운 동적 loop는 사람 검토 대상으로 분류한다.

pageProfile selector는 합성하지 않는다. 예를 들어 `page.locator('selector1, selector2')`처럼 여러 수집 selector를 하나로 합친 selector는 W201 warning 대상이다. 하나의 수집 `cssPath`를 고르기 어렵다면 generated spec은 TODO를 남겨야 한다.

## Warning Criteria

Warning은 false positive 가능성이 있어 사람 검토 대상으로 남기는 항목이다.

대표 warning:

- generated spec에서 사용하는 CSS selector가 `pageProfiles`의 `cssPath` 목록에 없음
- 공지 제목처럼 보이는 대괄호 포함 `getByText` assertion
- FAQ 질문처럼 보이는 긴 질문 문장 assertion
- 제품명/모델명처럼 영문+숫자 조합이 강한 `getByText` assertion
- 버튼 text assertion 의심
  - `상세보기`
  - `확대`
  - `이전`
  - `다음`
  - `Previous`
  - `Next`
  - `조회`
  - `검색`

## Why Validator Exists

Prompt는 생성 방향을 제어하지만 LLM 출력이 항상 규칙을 지킨다고 보장하지 않는다.

특히 Level 2 Page Identity Test에서는 다음 문제가 반복될 수 있다.

- 수집되지 않은 selector를 LLM이 추정해서 생성
- 긴 `cssPath`를 parent selector로 임의 축약
- depth3 중복 메뉴를 parent context 없이 클릭
- 안정적이지 않은 제품명, 공지, FAQ, 목록 데이터를 assertion으로 사용
- menuTree 일부 항목의 step 누락

Validator는 이런 문제를 실행 전에 빠르게 드러내기 위한 정적 품질 게이트이다.

## Review Flow

권장 흐름:

1. `npm run ai:generate`
2. `npm run ai:validate`
3. validator error가 있으면 prompt 또는 generator 입력을 수정하고 재생성
4. warning은 사람이 generated spec과 수집 JSON을 비교해 판단
5. `npm run test:generated`
6. `npm run test:generated:visual`
7. 사람이 검증한 테스트만 `tests/smoke` 또는 `tests/regression` 승격 검토

Generated spec은 자동 생성 초안이다. Validator를 통과해도 곧바로 smoke/regression으로 간주하지 않는다.
