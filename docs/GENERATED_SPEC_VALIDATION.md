# Generated Spec Validation

## Purpose

Generated Spec Validator는 AI가 생성한 Playwright spec을 사람이 검토하기 전에 정적으로 점검하는 품질 게이트이다.

validator는 특정 사이트 전용 규칙이 아니라, generated spec이 scout/menu_map/pageProfiles 근거를 벗어나지 않는지 확인하는 범용 검수 도구이다.

validator는 테스트를 실행하지 않는다.

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
- 문제가 없으면 `validation passed` 성격의 메시지 출력

## Error Criteria

error는 generated spec이 생성 규칙을 명확히 위반한 경우이다.

대표 error:

- 금지 generic selector 사용
  - `page.locator('table')`
  - `page.locator('form')`
  - `page.locator('[role="tab"]')`
- pageProfiles에 수집되지 않은 selector를 강한 assertion으로 사용
- 수집된 `cssPath`를 parent selector로 축약
- depth3 child 메뉴 클릭에서 `clickVisibleSubMenuByText` options의 `cssPath` 누락
- depth3 child 메뉴를 `clickVisibleMenuByText(page, childText)`로 단독 클릭
- menuTree depth2/depth3 메뉴의 `test.step` coverage 누락
- menu cssPath를 id/template/string operation으로 계산

## Warning Criteria

warning은 false positive 가능성이 있어 사람이 검토해야 하는 항목이다.

대표 warning:

- generated spec의 CSS selector가 pageProfiles/menuTree cssPath 목록에 없음
- `page.locator('selector1, selector2')`처럼 selector를 합성한 의심
- 공지 제목처럼 보이는 대괄호 포함 `getByText` assertion
- FAQ 질문처럼 보이는 긴 질문형 assertion
- 제품명/모델명처럼 변동 가능성이 큰 text assertion
- 버튼 text assertion 의심
  - 상세보기
  - 확대
  - 이전
  - 다음
  - Previous
  - Next
  - 조회
  - 검색

## Accepted Depth3 Patterns

validator는 literal call과 표준 loop 패턴을 모두 허용한다.

### Literal Call

```js
await clickVisibleSubMenuByText(page, parentText, childText, {
  cssPath: '...'
});
```

### Static children Loop

```js
const children = [
  { text: '...', href: '...', id: '...', cssPath: '...' }
];

for (const child of children) {
  await test.step(`Depth 3: ${child.text}`, async () => {
    await clickVisibleSubMenuByText(page, parentText, child.text, {
      cssPath: child.cssPath
    });
  });
}
```

조건:

- parent test 내부에서 `const children = [...]`를 사용한다.
- 각 child는 `text`와 literal `cssPath`를 포함한다.
- loop는 `for (const child of children)` 형식이다.
- `test.step` 제목은 `Depth 3: ${child.text}` 형식을 포함한다.
- click options에는 `cssPath: child.cssPath`가 포함된다.

금지:

- `cssPath`를 id 기반 template literal로 계산
- string `replace` 등으로 selector 생성
- pageProfile selector를 축약
- 여러 pageProfile selector를 하나의 locator로 합성

## Why Validator Exists

LLM prompt는 생성 방향을 제어하지만 출력이 항상 규칙을 지킨다고 보장할 수 없다.

특히 Level 2 Page Identity MVP에서는 다음 위험이 반복될 수 있다.

- 수집되지 않은 selector를 LLM이 추정
- 긴 cssPath를 parent selector로 축약
- depth3 중복 메뉴를 parent context 없이 클릭
- 제품명, 공지 제목, FAQ, 목록 데이터 같은 불안정한 text를 assertion으로 사용
- menuTree 일부 항목의 step 누락

validator는 이런 문제를 테스트 실행 전에 빠르게 드러내기 위한 정적 품질 게이트이다.

## Review Flow

권장 흐름:

1. `npm run ai:generate`
2. `npm run ai:validate`
3. error가 있으면 generated spec을 직접 수정하지 않고 prompt/scout/pageProfile/validator 규칙을 보완
4. warning은 generated spec과 수집 JSON을 비교해 사람이 판단
5. `npm run test:generated`
6. `npm run test:generated:visual`
7. 사람이 검증한 테스트만 smoke/regression 승격 검토

validator 통과는 최소 조건이다. 통과했다고 해서 generated spec을 바로 smoke/regression으로 간주하지 않는다.
