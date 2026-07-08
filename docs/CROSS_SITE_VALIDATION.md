# Cross-Site Validation

## Purpose

이 문서는 특정 회사나 서비스명이 아니라 사이트 유형 기준으로 cross-site validation 결과를 기록한다.

검증 목적은 “모든 사이트를 100% 무보정 지원한다”는 선언이 아니다. 서로 다른 navigation 구조에서 projection, structured plan validation, deterministic rendering이 어디까지 일반화되었는지 확인하고, 발견한 이슈를 일반 규칙으로 환원하는 것이다.

## Validation Matrix

| Site Type | Primary Navigation Shape | Result | Notes |
| --- | --- | --- | --- |
| Business/complex GNB site | 복합 GNB, depth2/depth3, 동일 child text 반복, tab-like menu | 41 passed | 같은 child text가 다른 parent 아래 반복되는 케이스 포함 |
| Corporate PC/MO overlay GNB site | PC/MO navigation duplicate, overlay open/close, header utility links | 17 passed | mobile duplicate와 utility/overlay control 제외 규칙 확인 |
| Docs/Docusaurus direct nav site | top-level direct nav link, dropdown language/runtime menu | 8 passed | `depth1Index`가 null인 direct nav link를 primary 대상으로 승격 |

## Generalized Issues And Rules

### Utility, Overlay, Mobile Navigation Mixing

Issue:

- close/open/search/theme/language/social utility 후보가 primary navigation tree에 섞일 수 있다.
- PC와 mobile navigation이 함께 수집될 때 mobile duplicate가 primary 대상이 될 수 있다.

Generalized rule:

- utility/overlay control은 primary navigation parent/child에서 제외한다.
- PC/desktop navigation 후보가 있으면 mobile navigation 후보는 fallback/non-primary로 보존한다.
- 후보는 삭제하지 않고 non-primary candidate로 남겨 추후 link/profile 확장에 활용한다.

### Direct Top-Level Navigation

Issue:

- 문서형 사이트는 top-level nav link가 dropdown 없이 바로 이동한다.
- 이런 후보는 `depth1Index`가 null일 수 있으나 정상 primary navigation이다.

Generalized rule:

- header/nav 영역, visible/high-confidence, href/text가 있는 direct nav link는 `primaryNavigationDirect` 후보로 승격할 수 있다.
- brand/logo, skip link, search, theme toggle, social/community utility, footer/main/hero CTA/card link는 제외한다.

### Generic Navigation Open

Issue:

- 특정 사이트 전용 fixed selector에 의존하면 다른 사이트에서 navigation open이 timeout으로 실패한다.

Generalized rule:

- renderer와 helper는 plan에 포함된 `openTriggerCssPath`, `hoverTargetCssPath`, `cssPath`를 우선 사용한다.
- fixed selector는 fallback으로만 유지한다.

### Duplicate Test Titles

Issue:

- 서로 다른 parent 아래 같은 child text가 있을 때 Playwright가 duplicate test title로 실행 전 중단할 수 있다.

Generalized rule:

- renderer는 LLM이 제공한 title을 그대로 신뢰하지 않는다.
- 최종 Playwright test title은 full `menuPath` 기준으로 생성한다.
- 그래도 중복되면 suffix를 붙여 실행 가능성을 보장한다.

## Interpretation

현재 검증 결과는 Level 1/2 navigation/page identity 자동 생성의 일반화 가능성을 보여준다. 다만 이것은 business scenario 자동 생성이나 데이터 변경 action 자동화를 의미하지 않는다.

생성 테스트는 validator와 실행을 통과하더라도 사람이 visual/debug와 목적 적합성을 확인한 뒤 smoke/regression 승격을 검토해야 한다.
