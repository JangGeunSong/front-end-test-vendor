# Playwright Convention

파일 위치:
- 자동 생성 테스트: tests/generated
- 스모크 테스트: tests/smoke
- 회귀 테스트: tests/regression

locator 우선순위:
1. getByRole
2. getByLabel
3. getByText
4. data-testid
5. CSS selector
6. XPath는 최후 수단

규칙:
- waitForTimeout은 기본적으로 사용하지 않는다.
- 페이지 로딩은 expect(locator).toBeVisible() 기준으로 검증한다.
- 테스트 실패 시 screenshot을 남긴다.
- 테스트명은 메뉴 경로를 포함한다.