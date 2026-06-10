# Data Flow

1. Python orchestrator 실행
2. Node.js scout.js 실행
3. 대상 웹 페이지 탐색
4. 메뉴/버튼/링크/입력 필드 정보 수집
5. scout_result.json 생성
6. menu_map.json 생성
7. LLM 입력용 payload 생성
8. 테스트 케이스 초안 생성
9. Playwright spec 파일 생성
10. npm run test 실행
11. playwright-report 생성

중요 원칙:
- scout_result.json은 원본 탐색 결과이다.
- menu_map.json은 테스트 생성에 필요한 구조화 데이터이다.
- generated spec은 언제든 재생성 가능해야 한다.
- 사람이 검증한 spec은 regression 또는 smoke로 승격한다.