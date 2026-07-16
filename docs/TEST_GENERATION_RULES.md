# Test Generation Rules

## Purpose

이 문서는 AI generated Playwright spec 생성 규칙을 정의한다.

현재 안정 실행 검증 범위는 Level 1 Navigation Smoke Test와 Level 2 Page Identity Test MVP까지이다. Level 3는 validated Structured Interaction Plan의 두 safe template을 deterministic spec으로 렌더링하고 static discovery하는 단계까지 구현됐다. 첫 tab runtime은 restore mismatch를 확인했으며 아직 안정 실행 범위로 승격되지 않았다. Level 4 Business Scenario Test는 자동 생성 대상이 아니다.

## Generated Spec Scope

generated spec이 자동 생성할 수 있는 범위:

- `menu_map.primaryMenuTree`에 포함된 primary navigation 후보
- navigation/GNB hover 또는 open
- depth2 메뉴 클릭
- depth3 child 메뉴 클릭
- URL/hash assertion
- 명백한 오류 화면 접근 여부 확인
- pageProfiles 기반 heading assertion
- pageProfiles 기반 mainContainer visible assertion
- 보수적인 Page Identity highlight
- 안정적인 후보가 없을 때 TODO 주석
- validated interaction plan의 exact `startUrl`/selector와 `interaction.tabSelection`/`interaction.expandedToggle` bounded transition rendering

`menus` 전체 후보를 그대로 generated spec 대상으로 사용하지 않는다. `linkCandidates`, `ctaCandidates`, `footerLinks`, `nonPrimaryNavigationCandidates`는 Level 1/2 generated spec 대상이 아니며 추후 Level 3/link check 확장 후보로 보존한다.

## Out of Scope

현재 generated spec이 자동 생성하지 않는 범위:

- 데이터 생성/수정/삭제/승인/발송/업로드
- 업무 시나리오 검증
- 입력값 조합 테스트
- 조회 결과 데이터 정확성 검증
- 제품명, 모델명, 공지 제목, FAQ 질문 같은 volatile content assertion
- selector 근거 없이 만든 임의 locator assertion
- generated Level 3 interaction spec의 안정화된 browser click/reset/restore runtime과 cross-site 실행

## Safety Rules

다음 액션은 자동 생성하지 않는다.

- 저장
- 삭제
- 등록
- 생성
- 수정
- 승인
- 반려
- 발송
- 제출
- 업로드
- 데이터 변경 가능성이 있는 초기화

모호한 버튼이나 action은 클릭하지 않고 TODO로 남긴다.

## Selector Rules

generated spec은 scout/menu_map/pageProfiles 근거를 벗어나면 안 된다.

규칙:

- depth3 메뉴 클릭용 `cssPath`는 `menu_map.json`의 값을 그대로 사용한다.
- Page Identity용 `page.locator(...)` selector는 `pageProfiles`에 수집된 `cssPath` 하나를 그대로 사용한다.
- 수집된 `cssPath`를 상위 parent selector로 축약하지 않는다.
- 여러 selector를 `page.locator('selector1, selector2')`처럼 합성하지 않는다.
- `page.locator('table')`, `page.locator('form')`, `page.locator('[role="tab"]')` 같은 일반 selector를 생성하지 않는다.
- selector가 길거나 불안정해 보이면 assertion 대신 TODO를 남긴다.

heading assertion은 `getByRole('heading', { name })` 사용을 허용한다.

## Depth3 Generation Rules

depth3 child 메뉴는 parent context 없이 단독 클릭하지 않는다.

허용:

```js
await clickVisibleSubMenuByText(page, parentText, childText, { cssPath });
```

loop 기반 생성도 허용한다.

표준 패턴:

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

`cssPath`는 계산하거나 합성하지 않고 `menu_map`에서 온 literal 값을 사용한다.

## Validator Gate

generated spec은 `npm run ai:validate` 통과 전에는 smoke/regression 승격 후보로 보지 않는다.

validator error가 있으면:

1. generated spec을 직접 수정하지 않는다.
2. prompt, scout/pageProfile 수집, menu_map 구성, validator 규칙 중 원인을 찾는다.
3. 생성 로직을 보완한다.
4. `npm run ai:generate`로 재생성한다.
5. `npm run ai:validate`를 다시 실행한다.

warning은 사람이 검토해 false positive인지 실제 개선 대상인지 판단한다.

## Promotion Rule

generated spec은 자동 생성 초안이다.

승격 전 필요 조건:

- validator 통과
- generated test 실행 통과
- visual/debug 확인
- 데이터 변경 없음
- 반복 실행 안정성
- 테스트 목적 명확성

세부 기준은 `docs/TEST_LEVELS.md`를 따른다.
