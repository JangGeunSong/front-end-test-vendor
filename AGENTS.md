이 프로젝트는 폐쇄망 웹 시스템의 프론트엔드 테스트 자동화를 위한 Playwright 테스트 생성 도구이다.

핵심 원칙:
- 실제 폐쇄망 업무 데이터는 외부 AI API로 전송하지 않는다.
- 사외 개발 환경에서는 샘플 HTML, 샘플 JSON, 익명화된 데이터만 사용한다.
- scout.js는 웹 UI 구조를 JSON으로 수집한다.
- agent_orchestrator.py는 JSON을 기반으로 테스트 생성 파이프라인을 실행한다.
- tests/generated는 자동 생성 테스트 저장 위치이다.
- tests/smoke와 tests/regression은 사람이 검증한 테스트 영역이다.

AI Agent 작업 규칙:
- 코드 수정 전에 관련 docs를 먼저 확인한다.
- prompts를 수정하면 PROMPT_STRATEGY.md도 업데이트한다.
- JSON 구조를 변경하면 JSON_SCHEMA.md와 agent_orchestrator.py를 함께 검토한다.
- 폐쇄망 정책을 위반하는 외부 전송 코드를 추가하지 않는다.