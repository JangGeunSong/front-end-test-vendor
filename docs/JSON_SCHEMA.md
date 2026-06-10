{
  "page": {
    "url": "https://sample.local/main",
    "title": "Sample Main"
  },
  "menus": [
    {
      "id": "menu-user-management",
      "label": "User Management",
      "path": ["Admin", "User Management"],
      "selector": "#user-menu",
      "type": "link",
      "children": []
    }
  ],
  "elements": [
    {
      "type": "button",
      "text": "Search",
      "selector": "button.search",
      "visible": true,
      "enabled": true
    }
  ]
}

필드 설명:
- page.url: 테스트 대상 URL. 폐쇄망 반출 시 반드시 sample URL로 치환한다.
- menus[].label: 메뉴 표시명. 외부 반출 시 익명화할 수 있다.
- selector: Playwright 테스트 생성에 사용되는 locator 후보.
- elements[].type: button, input, select, table, link 등.
- visible/enabled: 테스트 가능 여부 판단 기준.

주의:
- 실제 운영 데이터 값은 포함하지 않는다.
- 개인정보성 textContent는 저장하지 않는다.
- 테스트 생성에 불필요한 DOM 전체 HTML은 저장하지 않는다.