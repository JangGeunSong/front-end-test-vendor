// scout.js (사외에서 실행)
const { chromium } = require('playwright');

async function scoutSite(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. 페이지 이동 (가장 느린 네트워크가 끝날 때까지 1차 대기)
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  // 2. [Smart Wait] Angular/SPA 범용 로딩 대기
  // 사이트마다 다른 메인 태그를 감안하여 'ng-'로 시작하는 속성이 나타날 때까지 기다립니다.
  try {
    await Promise.race([
      // 전략 A: Angular 전용 속성이 보일 때까지 대기
      page.waitForSelector('[ng-controller], [ng-app], .ng-scope, [ng-repeat]', { timeout: 10000 }),
      // 전략 B: 본문 내부의 인터랙티브 요소(a, button 등)가 최소 5개 이상 생길 때까지 대기
      page.waitForFunction(() => document.querySelectorAll('a, button, input').length > 5, { timeout: 10000 })
    ]);
    console.warn("✅ Angular 컨텐츠 로딩 확인");
  } catch (e) {
    console.warn("⚠️ 자동 로딩 확인 실패. 현재 상태로 스캐닝을 강제 진행합니다.");
  }

  // 3. 요소 추출 (Body 및 dynamic content 포함)
  const elements = await page.evaluate(() => {
    // 텍스트 노드 중 의미 있는 것들을 찾기 위해 selector 확장
    const selectors = 'a, button, input, select, [ng-click], [role="button"], .bizMainCont a';
    
    return Array.from(document.querySelectorAll(selectors)).map(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';

      return {
        tagName: el.tagName,
        // 텍스트가 없으면 placeholder나 aria-label, 혹은 부모 노드의 텍스트라도 가져옴
        text: el.innerText.trim() || el.getAttribute('placeholder') || el.getAttribute('aria-label') || "",
        id: el.id,
        className: el.className,
        // Angular 특유의 클릭 이벤트 여부 확인
        hasNgClick: el.hasAttribute('ng-click'),
        isHoverTarget: !!el.querySelector('ul') || el.classList.contains('has-sub'),
        isVisible: isVisible
      };
    }).filter(item => item.isVisible && (item.text.length > 0 || item.id.length > 0)); 
  });

  await browser.close();
  return JSON.stringify(elements);
}

// [추가] 실제로 실행하고 결과를 콘솔에 찍어주는 로직
const url = process.argv[2]; // 파이썬이 보내준 URL 받기
if (!url) {
  console.error("URL이 필요합니다.");
  process.exit(1);
}

scoutSite(url)
  .then(data => console.log(data)) // 파이썬이 가로챌 수 있게 출력
  .catch(err => {
    console.error(err);
    process.exit(1);
  });