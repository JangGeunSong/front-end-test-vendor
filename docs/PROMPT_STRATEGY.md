# Prompt Strategy

## Level 2 Page Identity prompt rule

- Tool code must receive the target URL from `--url` or `TARGET_URL`; it must not keep a service-domain default.
- Generated specs are target-specific artifacts and may include the target URL used at generation time as their runnable fallback.
- To test a different URL, run `ai:generate` again for that URL instead of reusing an old generated spec.
- Generated specs should not be env-only URL wrappers; `npm run test:generated` should work after generation unless the user overrides `BASE_URL`.
- Generated tests keep the existing Level 1 GNB navigation flow.
- Generated tests must create a `test.step` for every depth2 menu and every depth3 child in `menuTree`.
- Loop-based generation is allowed, but it should use the standard format inside each parent test:
  - `const children = [...]`
  - `for (const child of children)`
  - ``test.step(`Depth 3: ${child.text}`)``
  - `clickVisibleSubMenuByText(page, 'parentText', child.text, { ... cssPath: child.cssPath ... })`
- Each static depth3 `children` array item must include the literal `cssPath` from `menu_map`.
- Generated specs must not compute menu `cssPath` from `id`, template literals, or string operations such as `replace`.
- Forbidden example: ``cssPath: `a#\\3${tab.id.replace('_', ' _')}```.
- Allowed example: `{ text: 'NB-IoT', id: '4_1', ngClick: "modemTab('nbiot')", cssPath: "a#\\34 _1" }`.
- Loop click options should use `tab.cssPath` or `child.cssPath`, not a computed selector expression.
- Weak or unstable Page Identity candidates must not cause menu steps to be skipped.
- Each menu step should at least open the correct depth1 area, click the target menu, and assert URL/hash when available.
- If URL/hash does not change or the menu is ngClick/tab-like, leave a TODO when stable heading/mainContainer evidence is insufficient.
- The LLM input includes both `menuTree` and `pageProfiles`.
- `pageProfiles` are collected from `primaryMenuTree` targets and matched to menu cases by exact `menuPath`.
- If a `pageProfile` exists for a parent or child menu, generated tests should use its stable heading/mainContainer evidence before leaving a generic Page Identity TODO.
- Child Page Identity assertions must use only the pageProfile whose `menuPath` exactly matches that child.
- Generated specs must not use a sibling child's pageProfile selector as a fallback.
- In loop-based depth3 tests, child-specific Page Identity assertions should be placed inside `if (child.text === '...')` or `else if` branches when selectors differ by child.
- A common Page Identity assertion inside a loop is allowed only when the same stable cssPath is confirmed across all child pageProfiles.
- Generated specs must not create fallback chains such as `if contentArea visible else noticeArea` using selectors from different sibling menuPaths.
- Page Identity assertion priority:
  1. URL/hash
  2. heading
  3. mainContainer
  4. representativeTexts
- Level 2 assertions should be conservative. If a candidate is unstable, generated tests should leave a TODO instead of creating a failing assertion.
- `representativeTexts` are fallback identity signals only when heading/mainContainer signals are insufficient.
- `representativeTexts` must not be used for operational data, list data, notice titles, FAQ questions, product names, model names, manufacturer-home text, plan numbers, long text, bracketed notice titles, or numeric/model-like strings.
- Generic texts such as 로그인, 메뉴, 고객센터, 검색, 목록, 확인, 취소 are not valid page identity signals.
- `buttons` must not be clicked and must not be used as page identity assertions.
- Button texts such as 상세보기, 확대, 이전, 다음, Previous, Next, 조회, 검색 are excluded from assertions.
- `table`, `form`, and `tab` presence assertions are allowed only with stable, specific selectors.
- Generic selectors such as `page.locator('table')`, `page.locator('form')`, and `page.locator('[role="tab"]')` should not be generated.
- Except for heading assertions using `getByRole('heading')`, generated specs must use the exact `cssPath` collected in `pageProfiles`.
- Generated specs must not shorten, invent, or generalize pageProfile selectors.
- Generated specs must not combine pageProfile selectors into `page.locator('selector1, selector2')`. Choose one collected `cssPath` or leave a TODO.
- Page Identity `page.locator(...)` selectors must match one collected `pageProfiles` `cssPath` exactly.
- Generated specs must not remove trailing selector segments to create a parent/content selector.
- Generated specs must not invent one shared content selector for multiple menus.
- For shared menus such as `공유 > 자료실/공지사항/FAQ`, if no single stable collected `cssPath` is clear, leave a TODO instead of creating a Page Identity assertion or highlight.
- For example, if scout collected `div#developGuide01-01 > div.listContent > div.content:nth-of-type(2)`, generated specs must not replace it with `div#developGuide01-01`.
- If a collected `cssPath` looks too long or unstable, leave a TODO instead of generating an assertion.
- Guide pages whose heading is only the parent menu label should use collected `mainContainers[1]` or content `cssPath` for visible assertion and Page Identity highlight.
- For ngClick tab-like menus where URL/hash does not change, assert only stable heading or mainContainer candidates and avoid strong content/list assertions.
- `errorIndicators` may be used as error-screen evidence, but generated tests should avoid broad negative regex assertions that can create false positives.
- Saving, deleting, registering, updating, approving, sending, uploading, or any other data-changing action must not be generated.

## Level 2 Visual Debug Highlight Rule

- Generated specs should import `highlightPageIdentity` from `../../utils/highlight` when Page Identity assertions are generated.
- `highlightPageIdentity(page, locator, label)` must be called after a stable heading or mainContainer assertion.
- The helper only acts when `HIGHLIGHT=true`, so normal test runs are unaffected.
- Prefer highlighting the heading locator.
- Highlight the main container when no stable heading is available, or when the heading is only the parent depth2 label and does not identify the depth3 ngClick/tab page.
- Showcase depth3 ngClick/tab menus such as 모듈/모뎀 and 단말 children should still show PAGE IDENTITY even when URL/hash is unchanged.
- If a mainContainer visible assertion is generated, the same locator should be passed to `highlightPageIdentity`.
- A stable tab locator may be highlighted only when it is not a product/model/list/button target.
- The label should include the full menuPath, for example `단말 > NB-IoT: content area`.
- Buttons, tables, notice titles, FAQ questions, product names, model names, and 상세보기 buttons must not be used as Page Identity highlight targets.

## GNB depth3 duplicate menu rule

- depth3 child menu names may be duplicated under different depth2 parents.
- Generated tests must not click a depth3 child menu with `clickVisibleMenuByText(page, childName)` alone.
- Generated tests should call `clickVisibleSubMenuByText(page, parentDepth2Name, childName, options)` for depth3 child menus.
- When the menu JSON includes `id`, `ngClick`, or `cssPath`, include those values in the helper options so duplicate labels such as `NB-IoT`, `eMTC`, `LTE-M`, `LTE`, and `5G` can be resolved to the intended parent.
- If a depth3 child has `cssPath` in `menu_map`, generated specs must include it in `clickVisibleSubMenuByText` options.

LLM에게 전달하는 정보:
- 테스트 목적
- 메뉴 구조
- 화면 요소
- 위험 액션 목록
- 생성 코드 스타일
- 출력 형식

LLM에게 전달하지 않는 정보:
- 실제 계정 정보
- 실제 고객 데이터
- 운영 URL
- 폐쇄망 내부 IP
- 민감한 업무 코드명

출력 요구:
- Playwright test 코드만 생성한다.
- 설명 문장은 제외한다.
- 위험 액션은 클릭하지 않는다.
- locator가 불확실한 경우 TODO 주석을 남긴다.
