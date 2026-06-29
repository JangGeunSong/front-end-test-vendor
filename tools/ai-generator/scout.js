// scout.js (사외에서 실행)
const { chromium } = require('playwright');

async function waitForAppReady(page) {
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
}

async function collectPageProfile(page) {
  return page.evaluate(() => {
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

    function isInsideCommonLayout(el) {
      return !!el.closest(
        'header, footer, nav, aside, .header, .footer, .gnb, .lnb, .menuContainer, .menuContent, .depth1, .depth2, .depth3'
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

    function uniqueBy(items, keyFn, limit = 20) {
      const seen = new Set();
      const results = [];

      for (const item of items) {
        const key = keyFn(item);
        if (!key || seen.has(key)) {
          continue;
        }

        seen.add(key);
        results.push(item);

        if (results.length >= limit) {
          break;
        }
      }

      return results;
    }

    function summarizeElement(el, textLimit = 120) {
      return {
        tagName: el.tagName,
        text: normalizeText(el.innerText || el.textContent || '').slice(0, textLimit),
        id: el.id || '',
        className: typeof el.className === 'string' ? el.className : '',
        role: el.getAttribute('role') || '',
        isVisible: isElementVisible(el),
        cssPath: getCssPath(el)
      };
    }

    function collectHeadings() {
      const headingSelectors = 'h1, h2, h3, [role="heading"]';

      return uniqueBy(
        Array.from(document.querySelectorAll(headingSelectors))
          .filter(el => isElementVisible(el) && !isInsideCommonLayout(el))
          .map(el => ({
            ...summarizeElement(el),
            level: el.tagName.match(/^H[1-6]$/)
              ? Number(el.tagName.slice(1))
              : Number(el.getAttribute('aria-level') || 0)
          }))
          .filter(item => item.text.length > 0),
        item => `${item.level}:${item.text}:${item.cssPath}`,
        20
      );
    }

    function collectRepresentativeTexts(headings) {
      const excludedTexts = new Set([
        '로그인',
        '메뉴',
        '고객센터',
        '검색',
        '목록',
        '확인',
        '취소',
        'Previous',
        'Next',
        'prev',
        'next'
      ]);

      const candidateSelectors = [
        'h1',
        'h2',
        'h3',
        '[role="heading"]',
        '.title',
        '.tit',
        '.subTitle',
        '.sectionTitle',
        '.contentTitle',
        '.pageTitle',
        '.visualTitle',
        'main p',
        '[role="main"] p',
        '.contents p',
        '.content p'
      ].join(', ');

      const headingTexts = headings.map(item => item.text);
      const textCandidates = Array.from(document.querySelectorAll(candidateSelectors))
        .filter(el => isElementVisible(el) && !isInsideCommonLayout(el))
        .map(el => normalizeText(el.innerText || el.textContent || ''))
        .filter(text => {
          return (
            text.length >= 2 &&
            text.length <= 120 &&
            !excludedTexts.has(text) &&
            !/^(검색|확인|취소|목록|메뉴|Previous|Next|prev|next)$/i.test(text)
          );
        });

      return uniqueBy(
        [...headingTexts, ...textCandidates],
        text => text,
        20
      );
    }

    function collectMainContainers() {
      const mainSelectors = [
        'main',
        '[role="main"]',
        '#content',
        '#contents',
        '#container',
        '.content',
        '.contents',
        '.container',
        '.main',
        '.mainContainer',
        '.subContent',
        '.bizMainCont'
      ].join(', ');

      return uniqueBy(
        Array.from(document.querySelectorAll(mainSelectors))
          .filter(el => isElementVisible(el) && !isInsideCommonLayout(el))
          .map(el => ({
            ...summarizeElement(el, 160),
            childElementCount: el.querySelectorAll('*').length
          })),
        item => item.cssPath || item.id || item.className,
        10
      );
    }

    function collectTables() {
      return uniqueBy(
        Array.from(document.querySelectorAll('table'))
          .filter(el => isElementVisible(el) && !isInsideCommonLayout(el))
          .map(el => ({
            ...summarizeElement(el, 80),
            caption: normalizeText(el.querySelector('caption')?.innerText || ''),
            headers: Array.from(el.querySelectorAll('th'))
              .map(th => normalizeText(th.innerText || th.textContent || ''))
              .filter(Boolean)
              .slice(0, 12),
            rowCount: el.querySelectorAll('tbody tr, tr').length
          })),
        item => item.cssPath,
        10
      );
    }

    function collectForms() {
      return uniqueBy(
        Array.from(document.querySelectorAll('form, fieldset, .searchArea, .searchBox, .formArea'))
          .filter(el => isElementVisible(el) && !isInsideCommonLayout(el))
          .map(el => ({
            ...summarizeElement(el, 100),
            labels: Array.from(el.querySelectorAll('label'))
              .map(label => normalizeText(label.innerText || label.textContent || ''))
              .filter(Boolean)
              .slice(0, 12),
            controls: Array.from(el.querySelectorAll('input, select, textarea'))
              .map(control => ({
                tagName: control.tagName,
                type: control.getAttribute('type') || '',
                name: control.getAttribute('name') || '',
                placeholder: control.getAttribute('placeholder') || '',
                ariaLabel: control.getAttribute('aria-label') || ''
              }))
              .slice(0, 12)
          })),
        item => item.cssPath,
        10
      );
    }

    function collectTabs() {
      return uniqueBy(
        Array.from(document.querySelectorAll('[role="tab"], [role="tablist"] [role="tab"], .tabs a, .tab a, .tabMenu a, .tab li'))
          .filter(el => isElementVisible(el) && !isInsideCommonLayout(el))
          .map(el => ({
            ...summarizeElement(el),
            selected: el.getAttribute('aria-selected') || ''
          }))
          .filter(item => item.text.length > 0),
        item => `${item.text}:${item.cssPath}`,
        20
      );
    }

    function isCarouselButton(el, text) {
      const className = typeof el.className === 'string' ? el.className : '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const combined = `${className} ${ariaLabel} ${title} ${text}`;

      return /slick-prev|slick-next|carousel|swiper|bx-prev|bx-next|previous|next/i.test(combined);
    }

    function collectButtons() {
      const buttonSelectors = [
        'button',
        '[role="button"]',
        'input[type="button"]',
        'input[type="submit"]',
        'a.btn',
        'a.button'
      ].join(', ');

      return uniqueBy(
        Array.from(document.querySelectorAll(buttonSelectors))
          .filter(el => isElementVisible(el) && !isInsideCommonLayout(el))
          .map(el => {
            const text = getElementText(el);

            return {
              ...summarizeElement(el),
              text,
              type: el.getAttribute('type') || '',
              name: el.getAttribute('name') || '',
              value: el.getAttribute('value') || ''
            };
          })
          .filter(item => {
            const el = document.querySelector(item.cssPath);
            return (
              (item.text.length > 0 || item.value.length > 0) &&
              (!el || !isCarouselButton(el, item.text || item.value))
            );
          }),
        item => `${item.text}:${item.value}:${item.cssPath}`,
        20
      );
    }

    function collectErrorIndicators() {
      const bodyText = normalizeText(document.body?.innerText || document.body?.textContent || '');
      const indicators = [];

      if (!bodyText) {
        indicators.push({
          type: 'blank-page',
          text: '',
          cssPath: ''
        });
      }

      const patterns = [
        { type: '404', regex: /\b404\s*(not found|error|page not found)\b|\bnot found\b|페이지를 찾을 수 없습니다|요청하신 페이지를 찾을 수 없습니다/i },
        { type: '500', regex: /\b500\s*(error|internal server error)\b|\binternal server error\b|서버\s*오류|시스템\s*오류/i },
        { type: 'unauthorized', regex: /\bunauthorized\b|로그인이 필요(?:합니다)?|로그인 후 이용|인증이 필요(?:합니다)?|인증 후 이용|세션이 만료/i },
        { type: 'forbidden', regex: /\bforbidden\b|\b403\b|권한이 없습니다|접근 권한이 없습니다|접근이 제한|허용되지 않은 접근/i },
        { type: 'generic-error', regex: /오류가 발생|에러가 발생|error|exception/i }
      ];

      for (const pattern of patterns) {
        const match = bodyText.match(pattern.regex);
        if (match) {
          indicators.push({
            type: pattern.type,
            text: match[0],
            cssPath: ''
          });
        }
      }

      const visibleErrorElements = Array.from(document.querySelectorAll(
        '.error, .exception, .not-found, [class*="error"], [class*="Error"], [role="alert"]'
      ))
        .filter(el => isElementVisible(el) && !isInsideCommonLayout(el))
        .map(el => ({
          type: 'visible-error-element',
          text: normalizeText(el.innerText || el.textContent || '').slice(0, 160),
          cssPath: getCssPath(el)
        }))
        .filter(item => item.text.length > 0);

      return uniqueBy(
        [...indicators, ...visibleErrorElements],
        item => `${item.type}:${item.text}:${item.cssPath}`,
        20
      );
    }

    const headings = collectHeadings();

    return {
      headings,
      representativeTexts: collectRepresentativeTexts(headings),
      mainContainers: collectMainContainers(),
      tables: collectTables(),
      forms: collectForms(),
      tabs: collectTabs(),
      buttons: collectButtons(),
      errorIndicators: collectErrorIndicators()
    };
  });
}

function extractMenuCandidates(elements) {
  const candidates = [];
  let currentDepth2 = null;

  for (const item of elements) {
    if (!item.isGnbCandidate || !item.testHint?.isNavigationCandidate) {
      continue;
    }

    const menu = {
      text: item.text || '',
      href: item.href || '',
      id: item.id || '',
      ngClick: item.ngClick || '',
      menuDepth: item.menuDepth,
      depth1Index: item.depth1Index,
      isVisible: item.isVisible,
      parentText: item.parentText || '',
      cssPath: item.cssPath || '',
      locatorCandidates: item.locatorCandidates || []
    };

    if (menu.menuDepth === 2) {
      currentDepth2 = menu;
      menu.menuPath = [menu.text].filter(Boolean);
    } else if (menu.menuDepth === 3 && currentDepth2) {
      menu.parentMenu = {
        text: currentDepth2.text,
        href: currentDepth2.href,
        id: currentDepth2.id,
        ngClick: currentDepth2.ngClick,
        menuDepth: currentDepth2.menuDepth,
        depth1Index: currentDepth2.depth1Index,
        cssPath: currentDepth2.cssPath
      };
      menu.menuPath = [currentDepth2.text, menu.text].filter(Boolean);
    } else {
      menu.menuPath = [menu.text].filter(Boolean);
    }

    candidates.push(menu);
  }

  return candidates;
}

function toProfileMenu(menu) {
  return {
    text: menu.text || '',
    href: menu.href || '',
    id: menu.id || '',
    ngClick: menu.ngClick || '',
    menuDepth: menu.menuDepth,
    depth1Index: menu.depth1Index,
    parentText: menu.parentMenu?.text || '',
    cssPath: menu.cssPath || ''
  };
}

async function clickMenuCandidate(page, menu) {
  if (!menu.cssPath) {
    return false;
  }

  try {
    const locator = page.locator(menu.cssPath).first();

    if (await locator.count()) {
      if (await locator.isVisible().catch(() => false)) {
        await locator.click({ timeout: 3000 });
      } else {
        await page.evaluate((cssPath) => {
          document.querySelector(cssPath)?.click();
        }, menu.cssPath);
      }

      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      return true;
    }
  } catch (error) {
    console.warn(`⚠️ 메뉴 클릭 실패: ${menu.text} (${error.message})`);
  }

  return false;
}

async function collectMenuPageProfiles(page, menus) {
  const pageProfiles = [];

  for (const menu of menus) {
    if (!menu.text || !menu.cssPath) {
      continue;
    }

    const clicked = await clickMenuCandidate(page, menu);
    if (!clicked) {
      continue;
    }

    pageProfiles.push({
      menuPath: menu.menuPath || [menu.text],
      menu: toProfileMenu(menu),
      navigation: {
        url: page.url(),
        hash: await page.evaluate(() => window.location.hash || ''),
        documentTitle: await page.title()
      },
      pageProfile: await collectPageProfile(page)
    });
  }

  return pageProfiles;
}

async function scoutSite(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. 페이지 이동 (가장 느린 네트워크가 끝날 때까지 1차 대기)
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  // 2. [Smart Wait] Angular/SPA 범용 로딩 대기
  // 사이트마다 다른 메인 태그를 감안하여 'ng-'로 시작하는 속성이 나타날 때까지 기다립니다.
  await waitForAppReady(page);

  // 3. 요소 추출 (Body 및 dynamic content 포함)
  const scoutResult = await page.evaluate(() => {
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
      '.bizMainCont a',
      '.menuContainer a',
      '.menuContainer button',
      '.menuContent a',
      '.depth1 a',
      '.depth2 a',
      '.depth3 a'
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

    const depth1Items = Array.from(document.querySelectorAll('.menuContainer .depth1 > li'));
    const menuContentPanels = Array.from(document.querySelectorAll('.menuContainer .menuContent'));

    function inferDepth1Index(el) {
      const depth1Item = el.closest('.menuContainer .depth1 > li');
      if (depth1Item) {
        const index = depth1Items.indexOf(depth1Item);
        return index >= 0 ? index : null;
      }

      const menuContentPanel = el.closest('.menuContainer .menuContent');
      if (menuContentPanel) {
        const index = menuContentPanels.indexOf(menuContentPanel);
        return index >= 0 && index < depth1Items.length ? index : null;
      }

      return null;
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

    const elements = Array.from(document.querySelectorAll(selectors))
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

        const isGnbCandidate = !!el.closest(
          '.menuContainer, .menuContent, .depth1, .depth2, .depth3'
        );

        const menuDepth = el.closest('.depth3')
          ? 3
          : el.closest('.depth2')
            ? 2
            : el.closest('.depth1')
              ? 1
              : null;

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
          isGnbCandidate,
          menuDepth,
          depth1Index: inferDepth1Index(el),

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
              el.hasAttribute('onclick'),
            requiresHoverBeforeClick: isGnbCandidate && !isVisible
          }
        };
      })
      .filter(item => {
        return (
          (item.isVisible || item.isGnbCandidate) &&
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

    return {
      url: window.location.href,
      count: elements.length,
      elements
    };
  });

  const menus = extractMenuCandidates(scoutResult.elements);
  scoutResult.pageProfiles = await collectMenuPageProfiles(page, menus);

  await browser.close();
  return JSON.stringify(scoutResult);
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
