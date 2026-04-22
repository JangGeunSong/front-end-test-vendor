const { defineConfig, devices } = require('@playwright/test');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',
  /* 파일 하나 내의 테스트들을 병렬로 실행할지 여부 */
  fullyParallel: true,
  /* 테스트 실패 시 재시도 횟수 (폐쇄망 환경의 일시적 순발력 저하 대비) */
  retries: 1,
  /* 테스트 결과 리포트 설정 (사내망에서는 html이 가장 가독성이 좋음) */
  reporter: [['html', { open: 'never' }]], // 실행 후 리포트가 자동으로 뜨는 현상 방지 (서버 실행 시 에러 방지)

  use: {
    /* 사내망 설치된 크롬 사용 */
    channel: 'chrome', 
    /* 테스트 시 브라우저를 띄움 (기본값) */
    headless: false,
    /* 각 작업 사이의 대기 시간(ms) - 너무 빠르면 Angular 1 렌더링이 못 따라올 수 있음 */
    launchOptions: {
      slowMo: 500, 
    },
    /* 에러 분석을 위한 수집 설정 */
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry', // 실패 시 상세 로그(Trace) 기록
  },

  /* 테스트 타임아웃 설정 (폐쇄망의 느린 반응 속도 고려) */
  timeout: 60000, // 개별 테스트당 60초
  expect: {
    timeout: 10000, // expect() 조건 대기 10초
  },
});