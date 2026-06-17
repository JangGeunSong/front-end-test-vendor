# Prompt Strategy

## GNB depth3 duplicate menu rule

- depth3 child menu names may be duplicated under different depth2 parents.
- Generated tests must not click a depth3 child menu with `clickVisibleMenuByText(page, childName)` alone.
- Generated tests should call `clickVisibleSubMenuByText(page, parentDepth2Name, childName, options)` for depth3 child menus.
- When the menu JSON includes `id`, `ngClick`, or `cssPath`, include those values in the helper options so duplicate labels such as `NB-IoT`, `eMTC`, `LTE-M`, `LTE`, and `5G` can be resolved to the intended parent.

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
