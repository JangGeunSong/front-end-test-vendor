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
    // 3. 요소 추출 (Body 및 dynamic content 포함)
  const elements = await page.evaluate(() => {
    const selectors = [
      'a',
      'button',
      'input',
      'select',
      'textarea',
      '[ng-click]',
      '[ng-mouseover]',
      '[onclick]',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '.bizMainCont a'
    ].join(', ');

    function normalizeText(value) {
      return (value || '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function getElementText(el) {
      return normalizeText(
        el.innerText ||
        el.textContent ||
        el.getAttribute('placeholder') ||
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.getAttribute('value') ||
        ''
      );
    }

    function isElementVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    }

    function getCssPath(el) {
      if (!(el instanceof Element)) {
        return '';
      }

      const path = [];

      while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.body) {
        let selector = el.nodeName.toLowerCase();

        if (el.id) {
          selector += `#${CSS.escape(el.id)}`;
          path.unshift(selector);
          break;
        }

        const className = normalizeText(
          typeof el.className === 'string' ? el.className : ''
        );

        if (className) {
          const classes = className
            .split(' ')
            .filter(Boolean)
            .slice(0, 3)
            .map(cls => `.${CSS.escape(cls)}`)
            .join('');

          selector += classes;
        }

        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            sibling => sibling.nodeName === el.nodeName
          );

          if (siblings.length > 1) {
            const index = siblings.indexOf(el) + 1;
            selector += `:nth-of-type(${index})`;
          }
        }

        path.unshift(selector);
        el = el.parentElement;
      }

      return path.join(' > ');
    }

    function getParentText(el) {
      const parent = el.closest('li, tr, td, th, div, section, nav, header, aside');
      if (!parent || parent === el) {
        return '';
      }

      return normalizeText(parent.innerText || parent.textContent || '').slice(0, 200);
    }

    function hasHiddenChildren(el) {
      const childCandidates = Array.from(el.querySelectorAll('a, button, [role="menuitem"], li'));

      return childCandidates.some(child => {
        const style = window.getComputedStyle(child);
        const rect = child.getBoundingClientRect();

        return (
          child !== el &&
          (style.display === 'none' ||
            style.visibility === 'hidden' ||
            rect.width === 0 ||
            rect.height === 0)
        );
      });
    }

    function buildLocatorCandidates(el, text) {
      const candidates = [];

      const tagName = el.tagName.toLowerCase();
      const id = el.id;
      const role = el.getAttribute('role');
      const ariaLabel = el.getAttribute('aria-label');
      const placeholder = el.getAttribute('placeholder');
      const name = el.getAttribute('name');
      const type = el.getAttribute('type');

      if (role && (text || ariaLabel)) {
        candidates.push(`page.getByRole('${role}', { name: '${(text || ariaLabel).replace(/'/g, "\\'")}' })`);
      }

      if (tagName === 'button' && text) {
        candidates.push(`page.getByRole('button', { name: '${text.replace(/'/g, "\\'")}' })`);
      }

      if (tagName === 'a' && text) {
        candidates.push(`page.getByRole('link', { name: '${text.replace(/'/g, "\\'")}' })`);
      }

      if (placeholder) {
        candidates.push(`page.getByPlaceholder('${placeholder.replace(/'/g, "\\'")}')`);
      }

      if (ariaLabel) {
        candidates.push(`page.getByLabel('${ariaLabel.replace(/'/g, "\\'")}')`);
      }

      if (text) {
        candidates.push(`page.getByText('${text.replace(/'/g, "\\'")}', { exact: true })`);
      }

      if (id) {
        candidates.push(`page.locator('#${CSS.escape(id)}')`);
      }

      if (name) {
        candidates.push(`page.locator('[name="${name.replace(/"/g, '\\"')}"]')`);
      }

      if (type && tagName === 'input') {
        candidates.push(`page.locator('input[type="${type.replace(/"/g, '\\"')}"]')`);
      }

      return candidates;
    }

    return Array.from(document.querySelectorAll(selectors))
      .map((el, index) => {
        const text = getElementText(el);
        const tagName = el.tagName;
        const tagNameLower = tagName.toLowerCase();
        const id = el.id || '';
        const className = typeof el.className === 'string' ? el.className : '';

        const role = el.getAttribute('role') || '';
        const href = el.getAttribute('href') || '';
        const name = el.getAttribute('name') || '';
        const type = el.getAttribute('type') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const value = el.getAttribute('value') || '';

        const ngClick = el.getAttribute('ng-click') || '';
        const ngMouseover = el.getAttribute('ng-mouseover') || '';
        const onclick = el.getAttribute('onclick') || '';

        const isVisible = isElementVisible(el);

        const isHoverTarget =
          !!el.querySelector('ul, ol, .dropdown-menu, .submenu, .sub-menu') ||
          el.classList.contains('has-sub') ||
          el.classList.contains('dropdown') ||
          el.classList.contains('depth1') ||
          el.classList.contains('menu') ||
          el.hasAttribute('ng-mouseover') ||
          hasHiddenChildren(el);

        return {
          index,
          tagName,
          text,
          id,
          className,

          href,
          name,
          type,
          role,
          placeholder,
          ariaLabel,
          title,
          value,

          hasNgClick: el.hasAttribute('ng-click'),
          hasNgMouseover: el.hasAttribute('ng-mouseover'),
          hasOnClick: el.hasAttribute('onclick'),
          ngClick,
          ngMouseover,
          onclick,

          isVisible,
          isHoverTarget,

          parentText: getParentText(el),
          cssPath: getCssPath(el),
          locatorCandidates: buildLocatorCandidates(el, text),

          testHint: {
            isLink: tagNameLower === 'a' || role === 'link',
            isButton: tagNameLower === 'button' || role === 'button',
            isInput: tagNameLower === 'input' || tagNameLower === 'textarea',
            isSelect: tagNameLower === 'select',
            isNavigationCandidate:
              tagNameLower === 'a' ||
              role === 'link' ||
              role === 'menuitem' ||
              !!href,
            isActionCandidate:
              tagNameLower === 'button' ||
              role === 'button' ||
              el.hasAttribute('ng-click') ||
              el.hasAttribute('onclick')
          }
        };
      })
      .filter(item => {
        return (
          item.isVisible &&
          (
            item.text.length > 0 ||
            item.id.length > 0 ||
            item.name.length > 0 ||
            item.placeholder.length > 0 ||
            item.ariaLabel.length > 0 ||
            item.href.length > 0
          )
        );
      });
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