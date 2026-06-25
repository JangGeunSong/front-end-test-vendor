# Playwright Convention

## Purpose

이 문서는 수동 작성 테스트와 AI generated spec 모두에 적용할 Playwright 작성 규칙을 정리한다.

테스트 수준과 승격 기준은 `docs/TEST_LEVELS.md`를 따른다.

## File Locations

- 자동 생성 테스트: `tests/generated`
- 사람이 검증한 smoke 테스트: `tests/smoke`
- 사람이 검증한 regression 테스트: `tests/regression`

## Locator Priority

일반적인 locator 우선순위:

1. `getByRole`
2. `getByLabel`
3. `getByText`
4. `data-testid`
5. CSS selector
6. XPath는 최후 수단

generated spec의 Page Identity selector는 예외적으로 `pageProfiles`에 수집된 `cssPath`를 그대로 사용할 수 있다.

## Generated Spec Standard Pattern

generated spec은 다음 흐름을 따른다.

1. `test.step`으로 메뉴 단위 동작을 구분한다.
2. depth1 또는 navigation 영역을 연다.
3. depth2 또는 depth3 메뉴를 클릭한다.
4. URL/hash를 확인한다.
5. 안정적인 Page Identity 후보가 있으면 heading 또는 mainContainer를 확인한다.
6. 안정적인 후보가 없으면 TODO를 남긴다.

## Depth3 Loop Pattern

depth3 child가 여러 개인 경우 반복 생성이 가능하다.

허용 패턴:

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

규칙:

- 배열명은 `children`을 사용한다.
- `cssPath`는 `menu_map`에서 온 literal 값을 포함한다.
- `cssPath`를 id 기반 template literal이나 string 연산으로 계산하지 않는다.
- `clickVisibleSubMenuByText` options에는 `child.cssPath`를 전달한다.
- child text를 `clickVisibleMenuByText`로 단독 클릭하지 않는다.

## Selector Rules

- `page.locator('table')`, `page.locator('form')`, `page.locator('[role="tab"]')` 같은 일반 selector를 generated spec에 만들지 않는다.
- Page Identity용 selector는 `pageProfiles`의 수집 `cssPath` 하나를 그대로 사용한다.
- 수집 selector를 축약하거나 parent selector로 바꾸지 않는다.
- 여러 selector를 합성하지 않는다.
- selector가 불안정하면 assertion 대신 TODO를 남긴다.

## Wait Rules

- `waitForTimeout`은 기본적으로 사용하지 않는다.
- navigation 또는 UI 상태는 `expect(locator).toBeVisible()` 같은 조건 기반 assertion으로 기다린다.
- 필요한 경우 Playwright의 auto-waiting을 우선 활용한다.

## Visual Debug

`HIGHLIGHT=true`인 경우 helper가 메뉴 클릭 대상과 Page Identity 대상을 강조할 수 있다.

visual debug는 사람이 generated spec을 검토하기 위한 보조 수단이다. 일반 test 실행의 assertion 의미를 바꾸지 않는다.
