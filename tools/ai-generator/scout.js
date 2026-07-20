// scout.js (사외에서 실행)
const { chromium } = require('playwright');

async function waitForAppReady(page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  await page.waitForFunction(() => {
    const interactiveSelectors = [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]'
    ].join(', ');

    return document.querySelectorAll(interactiveSelectors).length > 0;
  }, { timeout: 10000 }).catch(() => {});

  await page.evaluate(() => {
    return new Promise(resolve => {
      let timer;
      const quietMs = 500;
      const maxMs = 3000;

      const done = () => {
        observer.disconnect();
        resolve();
      };

      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(done, quietMs);
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true
      });

      timer = setTimeout(done, quietMs);
      setTimeout(done, maxMs);
    });
  }).catch(() => {});
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

    function getClassAndIdText(el) {
      return `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
    }

    function hasCommonLayoutSignal(el) {
      return /(^|[-_\s])(header|footer|nav|navigation|gnb|lnb|menu|menubar|sidebar|aside)([-_\s]|$)/i
        .test(getClassAndIdText(el));
    }

    function closestByPredicate(el, predicate) {
      let current = el;
      while (current && current !== document.body) {
        if (predicate(current)) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }

    function isInsideCommonLayout(el) {
      return !!el.closest(
        'header, footer, nav, aside, [role="banner"], [role="navigation"], [role="menubar"], [role="menu"], [role="contentinfo"], [role="complementary"]'
      ) || !!closestByPredicate(el, hasCommonLayoutSignal);
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

    function getScopedStructuralPath(el, ancestor, ancestorSelector) {
      if (
        !(el instanceof Element) ||
        !(ancestor instanceof Element) ||
        !ancestorSelector ||
        !ancestor.contains(el) ||
        el === ancestor
      ) {
        return '';
      }

      const path = [];
      let current = el;

      while (current && current !== ancestor) {
        let selector = current.nodeName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) {
          return '';
        }

        const siblings = Array.from(parent.children).filter(
          sibling => sibling.nodeName === current.nodeName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }

        path.unshift(selector);
        current = parent;
      }

      if (current !== ancestor) {
        return '';
      }

      return [ancestorSelector, ...path].join(' > ');
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
        observedUrl: window.location.href,
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
          .map(el => {
            const tablist = el.closest('[role="tablist"]');
            const tabGroupSelector = tablist ? getCssPath(tablist) : '';
            const stableTabSelector = tablist && tabGroupSelector
              ? getScopedStructuralPath(el, tablist, tabGroupSelector)
              : '';
            const summary = {
              ...summarizeElement(el),
              ...(stableTabSelector ? { cssPath: stableTabSelector } : {}),
              selected: el.getAttribute('aria-selected') || ''
            };

            if (summary.role !== 'tab' || summary.selected !== 'false') {
              return summary;
            }

            if (!tablist) {
              return {
                ...summary,
                tabRestoreUnavailableReason: 'missingTabGroupEvidence'
              };
            }

            if (
              !tabGroupSelector ||
              document.querySelectorAll(tabGroupSelector).length !== 1
            ) {
              return {
                ...summary,
                tabRestoreUnavailableReason: 'missingTabGroupEvidence'
              };
            }

            const selectedPeers = Array.from(
              tablist.querySelectorAll('[role="tab"][aria-selected="true"]')
            ).filter(peer => peer.closest('[role="tablist"]') === tablist);
            if (selectedPeers.length === 0) {
              return {
                ...summary,
                tabRestoreUnavailableReason: 'missingPreviousSelection'
              };
            }
            if (selectedPeers.length > 1) {
              return {
                ...summary,
                tabRestoreUnavailableReason: 'ambiguousPreviousSelection'
              };
            }

            const restoreTarget = selectedPeers[0];
            const restoreSelector = getScopedStructuralPath(
              restoreTarget,
              tablist,
              tabGroupSelector
            );
            if (
              !isElementVisible(restoreTarget) ||
              restoreTarget.getAttribute('role') !== 'tab' ||
              restoreTarget.getAttribute('aria-selected') !== 'true' ||
              !restoreSelector ||
              restoreSelector === summary.cssPath ||
              document.querySelectorAll(restoreSelector).length !== 1
            ) {
              return {
                ...summary,
                tabRestoreUnavailableReason: 'invalidRestoreTarget'
              };
            }

            return {
              ...summary,
              tabRestore: {
                strategy: 'restorePreviousSelection',
                tabGroupSelector,
                target: {
                  ...summarizeElement(restoreTarget),
                  cssPath: restoreSelector,
                  selected: 'true'
                }
              }
            };
          })
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
      observedUrl: item.observedUrl || '',
      text: item.text || '',
      href: item.href || '',
      id: item.id || '',
      ngClick: item.ngClick || '',
      menuDepth: item.menuDepth,
      depth1Index: item.depth1Index,
      hoverTargetCssPath: item.hoverTargetCssPath || '',
      openTriggerCssPath: item.openTriggerCssPath || '',
      semanticRegion: item.semanticRegion || 'unknown',
      navigationGroupIndex: item.navigationGroupIndex,
      inferredMenuDepth: item.inferredMenuDepth,
      confidence: item.confidence || 'unknown',
      discoveryReason: item.discoveryReason || [],
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
        hoverTargetCssPath: currentDepth2.hoverTargetCssPath || '',
        openTriggerCssPath: currentDepth2.openTriggerCssPath || '',
        semanticRegion: currentDepth2.semanticRegion,
        navigationGroupIndex: currentDepth2.navigationGroupIndex,
        confidence: currentDepth2.confidence,
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
    observedUrl: menu.observedUrl || '',
    text: menu.text || '',
    href: menu.href || '',
    id: menu.id || '',
    ngClick: menu.ngClick || '',
    menuDepth: menu.menuDepth,
    depth1Index: menu.depth1Index,
    hoverTargetCssPath: menu.hoverTargetCssPath || '',
    openTriggerCssPath: menu.openTriggerCssPath || '',
    semanticRegion: menu.semanticRegion || 'unknown',
    navigationGroupIndex: menu.navigationGroupIndex,
    inferredMenuDepth: menu.inferredMenuDepth,
    confidence: menu.confidence || 'unknown',
    discoveryReason: menu.discoveryReason || [],
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

function flattenProfileTargets(menuTree) {
  const targets = [];

  for (const parent of menuTree || []) {
    if (!parent?.text || !parent?.cssPath) {
      continue;
    }

    targets.push({
      ...parent,
      menuPath: [parent.text],
      parentMenu: null
    });

    for (const child of parent.children || []) {
      if (!child?.text || !child?.cssPath) {
        continue;
      }

      targets.push({
        ...child,
        menuPath: [parent.text, child.text],
        parentMenu: {
          text: parent.text || '',
          href: parent.href || '',
          id: parent.id || '',
          ngClick: parent.ngClick || '',
          menuDepth: parent.menuDepth,
          depth1Index: parent.depth1Index,
          hoverTargetCssPath: parent.hoverTargetCssPath || '',
          openTriggerCssPath: parent.openTriggerCssPath || '',
          semanticRegion: parent.semanticRegion || 'unknown',
          navigationGroupIndex: parent.navigationGroupIndex,
          confidence: parent.confidence || 'unknown',
          cssPath: parent.cssPath || ''
        }
      });
    }
  }

  return targets;
}

async function openMenuForProfile(page, menu) {
  const hoverTargetCssPath =
    menu.hoverTargetCssPath ||
    menu.openTriggerCssPath ||
    menu.parentMenu?.hoverTargetCssPath ||
    menu.parentMenu?.openTriggerCssPath ||
    '';

  if (hoverTargetCssPath) {
    const hoverTarget = page.locator(hoverTargetCssPath).first();

    if (await hoverTarget.count()) {
      await hoverTarget.hover({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
  }

  const depth1Index =
    typeof menu.depth1Index === 'number'
      ? menu.depth1Index
      : menu.parentMenu?.depth1Index;

  if (typeof depth1Index === 'number') {
    const fallbackTarget = page.locator('.menuContainer .depth1 > li').nth(depth1Index);

    if (await fallbackTarget.count()) {
      await fallbackTarget.hover({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function clickMenuTargetForProfile(page, menu) {
  if (!menu.cssPath) {
    return false;
  }

  await openMenuForProfile(page, menu);

  try {
    const locator = page.locator(menu.cssPath).first();

    if (!await locator.count()) {
      return false;
    }

    if (await locator.isVisible().catch(() => false)) {
      await locator.hover({ timeout: 3000 }).catch(() => {});
      await locator.click({ timeout: 5000 });
    } else {
      await page.evaluate((cssPath) => {
        document.querySelector(cssPath)?.click();
      }, menu.cssPath);
    }

    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    return true;
  } catch (error) {
    console.warn(`pageProfile menu click failed: ${menu.menuPath?.join(' > ') || menu.text} (${error.message})`);
    return false;
  }
}

async function collectMenuPageProfiles(page, menus, baseUrl = '') {
  const pageProfiles = [];

  for (const menu of menus) {
    if (!menu.text || !menu.cssPath) {
      continue;
    }

    if (baseUrl) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await waitForAppReady(page);
    }

    const clicked = await clickMenuTargetForProfile(page, menu);
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

async function collectPrimaryMenuPageProfiles(url, menuTree) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForAppReady(page);

  const targets = flattenProfileTargets(menuTree);
  const pageProfiles = await collectMenuPageProfiles(page, targets, url);

  await browser.close();

  return JSON.stringify({
    url,
    count: pageProfiles.length,
    pageProfiles
  });
}

async function scoutSite(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. 페이지 이동 후 렌더링된 DOM을 기준으로 best-effort 탐색한다.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 2. framework-agnostic 로딩 안정화 대기
  await waitForAppReady(page);

  // 3. 요소 추출 (Body 및 dynamic content 포함)
  const scoutResult = await page.evaluate(() => {
    const selectors = [
      'nav a',
      'header a',
      '[role="navigation"] a',
      '[role="menubar"] a',
      '[role="menu"] a',
      '[role="menuitem"]',
      'a[href]',
      'button',
      '[onclick]',
      '[role="button"]',
      '[role="link"]',
      '[aria-haspopup="true"]'
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

    function getClassAndIdText(el) {
      return `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
    }

    function hasNavigationClassSignal(el) {
      return /(^|[-_\s])(nav|navigation|menu|menubar|dropdown|sidebar|gnb|lnb|header)([-_\s]|$)/i
        .test(getClassAndIdText(el));
    }

    function getSemanticRegion(el) {
      const region = el.closest(
        'header, nav, main, aside, footer, [role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"]'
      );

      if (!region) {
        return 'unknown';
      }

      const tagName = region.tagName.toLowerCase();
      const role = region.getAttribute('role') || '';

      if (tagName === 'header' || role === 'banner') return 'header';
      if (tagName === 'nav' || role === 'navigation') return 'nav';
      if (tagName === 'main' || role === 'main') return 'main';
      if (tagName === 'aside' || role === 'complementary') return 'aside';
      if (tagName === 'footer' || role === 'contentinfo') return 'footer';

      return 'unknown';
    }

    function uniqueBy(items, keyFn) {
      const seen = new Set();
      const results = [];

      for (const item of items) {
        const key = keyFn(item);
        if (!key || seen.has(key)) {
          continue;
        }

        seen.add(key);
        results.push(item);
      }

      return results;
    }

    const semanticNavigationGroups = Array.from(document.querySelectorAll(
      'nav, header, aside, [role="navigation"], [role="menubar"], [role="menu"], [role="banner"], [role="complementary"]'
    ));
    const classSignalNavigationGroups = Array.from(document.querySelectorAll('body *'))
      .filter(el => hasNavigationClassSignal(el) && el.querySelector('a, button, [role="link"], [role="menuitem"]'));
    const navigationGroups = uniqueBy(
      [...semanticNavigationGroups, ...classSignalNavigationGroups],
      el => getCssPath(el)
    );

    function findNavigationGroup(el) {
      let bestGroup = null;
      let bestDepth = Infinity;

      for (const group of navigationGroups) {
        if (!group.contains(el)) {
          continue;
        }

        let depth = 0;
        let current = el;
        while (current && current !== group) {
          depth += 1;
          current = current.parentElement;
        }

        if (depth < bestDepth) {
          bestDepth = depth;
          bestGroup = group;
        }
      }

      return bestGroup;
    }

    function getNavigationGroupIndex(el) {
      const group = findNavigationGroup(el);
      if (!group) {
        return null;
      }

      const index = navigationGroups.indexOf(group);
      return index >= 0 ? index : null;
    }

    function isListContainer(el) {
      if (!el) {
        return false;
      }

      const tagName = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';

      return tagName === 'ul' || tagName === 'ol' || role === 'menu' || role === 'menubar';
    }

    function getTopLevelNavigationItem(el) {
      const group = findNavigationGroup(el);
      if (!group) {
        return null;
      }

      const listItems = [];
      let current = el;

      while (current && current !== document.body && current !== group.parentElement) {
        if (current.tagName?.toLowerCase() === 'li') {
          listItems.push(current);
        }

        if (current === group) {
          break;
        }

        current = current.parentElement;
      }

      if (listItems.length > 0) {
        return listItems[listItems.length - 1];
      }

      return null;
    }

    function getHoverTargetInfo(el) {
      const topLevelItem = getTopLevelNavigationItem(el);

      if (!topLevelItem || !isListContainer(topLevelItem.parentElement)) {
        return {
          depth1Index: null,
          hoverTargetCssPath: '',
          openTriggerCssPath: ''
        };
      }

      const siblings = Array.from(topLevelItem.parentElement.children)
        .filter(child => child.tagName?.toLowerCase() === 'li');
      const index = siblings.indexOf(topLevelItem);

      return {
        depth1Index: index >= 0 ? index : null,
        hoverTargetCssPath: getCssPath(topLevelItem),
        openTriggerCssPath: getCssPath(topLevelItem)
      };
    }

    function getListDepthWithinGroup(el) {
      const group = findNavigationGroup(el);
      let depth = 0;
      let current = el.parentElement;

      while (current && current !== document.body && current !== group?.parentElement) {
        const tagName = current.tagName.toLowerCase();
        const role = current.getAttribute('role') || '';

        if (tagName === 'ul' || tagName === 'ol' || role === 'menu' || role === 'menubar') {
          depth += 1;
        }

        if (current === group) {
          break;
        }

        current = current.parentElement;
      }

      return depth;
    }

    function inferMenuDepth(el) {
      const role = el.getAttribute('role') || '';
      const group = findNavigationGroup(el);
      const listDepth = getListDepthWithinGroup(el);

      if (!group && role !== 'menuitem' && !hasNavigationClassSignal(el)) {
        return null;
      }

      if (listDepth >= 2) {
        return 3;
      }

      return 2;
    }

    function getDiscoveryReason(el) {
      const reasons = [];
      const role = el.getAttribute('role') || '';

      if (findNavigationGroup(el)) reasons.push('navigation-region');
      if (role) reasons.push(`role:${role}`);
      if (el.getAttribute('href')) reasons.push('href');
      if (el.hasAttribute('onclick')) reasons.push('onclick');
      if (el.getAttribute('aria-haspopup')) reasons.push('aria-haspopup');
      if (hasNavigationClassSignal(el)) reasons.push('class-signal');
      if (hasHiddenChildren(el)) reasons.push('hidden-children');

      return reasons;
    }

    function getNavigationConfidence(el) {
      const reasons = getDiscoveryReason(el);
      if (reasons.includes('navigation-region') && reasons.some(reason => reason === 'href' || reason.startsWith('role:'))) {
        return 'high';
      }
      if (reasons.includes('navigation-region') || reasons.includes('class-signal')) {
        return 'medium';
      }
      return reasons.length > 0 ? 'low' : 'unknown';
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
        const semanticRegion = getSemanticRegion(el);
        const navigationGroupIndex = getNavigationGroupIndex(el);
        const hoverTargetInfo = getHoverTargetInfo(el);
        const discoveryReason = getDiscoveryReason(el);
        const confidence = getNavigationConfidence(el);
        const inferredMenuDepth = inferMenuDepth(el);
        const buttonNavigationReason = discoveryReason.some(reason => {
          return (
            reason === 'navigation-region' ||
            reason === 'class-signal' ||
            reason === 'aria-haspopup' ||
            reason === 'onclick' ||
            reason === 'hidden-children'
          );
        });
        const isNavigationCandidate =
          tagNameLower === 'a' ||
          role === 'link' ||
          role === 'menuitem' ||
          !!href ||
          ((tagNameLower === 'button' || role === 'button') && buttonNavigationReason);

        const isHoverTarget =
          el.getAttribute('aria-haspopup') === 'true' ||
          hasNavigationClassSignal(el) ||
          hasHiddenChildren(el);

        return {
          index,
          observedUrl: window.location.href,
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
          isGnbCandidate: isNavigationCandidate && confidence !== 'unknown',
          semanticRegion,
          navigationGroupIndex,
          inferredMenuDepth,
          menuDepth: inferredMenuDepth,
          depth1Index: hoverTargetInfo.depth1Index,
          hoverTargetCssPath: hoverTargetInfo.hoverTargetCssPath,
          openTriggerCssPath: hoverTargetInfo.openTriggerCssPath,
          confidence,
          discoveryReason,

          parentText: getParentText(el),
          cssPath: getCssPath(el),
          locatorCandidates: buildLocatorCandidates(el, text),

          testHint: {
            isLink: tagNameLower === 'a' || role === 'link',
            isButton: tagNameLower === 'button' || role === 'button',
            isInput: tagNameLower === 'input' || tagNameLower === 'textarea',
            isSelect: tagNameLower === 'select',
            isNavigationCandidate,
            isActionCandidate:
              tagNameLower === 'button' ||
              role === 'button' ||
              el.hasAttribute('ng-click') ||
              el.hasAttribute('onclick'),
            requiresHoverBeforeClick: isHoverTarget && !isVisible
          }
        };
      })
      .filter(item => {
        return (
          (item.isVisible || item.isGnbCandidate) &&
          item.testHint.isNavigationCandidate &&
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

  scoutResult.pageProfiles = [];

  await browser.close();
  return JSON.stringify(scoutResult);
}

// [추가] 실제로 실행하고 결과를 콘솔에 찍어주는 로직
const url = process.argv[2]; // 파이썬이 보내준 URL 받기
if (!url) {
  console.error("URL이 필요합니다.");
  process.exit(1);
}

const profileFlagIndex = process.argv.indexOf('--profile-tree');
const profileTreePath = profileFlagIndex >= 0 ? process.argv[profileFlagIndex + 1] : '';

if (profileTreePath) {
  const fs = require('fs');
  const menuTree = JSON.parse(fs.readFileSync(profileTreePath, 'utf-8'));

  collectPrimaryMenuPageProfiles(url, menuTree)
    .then(data => console.log(data))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
} else {
scoutSite(url)
  .then(data => console.log(data)) // 파이썬이 가로챌 수 있게 출력
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
}
