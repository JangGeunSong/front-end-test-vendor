function inferOpenTriggerCssPath(options = {}) {
  const cssPath = options.cssPath || '';
  const match = String(cssPath).match(/mainMenu-(\d+)/);

  if (!match) {
    return '';
  }

  const index = Number(match[1]) + 1;
  return `nav#gnbContentPC > ul.list_gnb > li:nth-of-type(${index})`;
}

async function locatorExists(locator) {
  try {
    return await locator.count() > 0;
  } catch {
    return false;
  }
}

async function hoverMenuTarget(page, target, label) {
  await target.waitFor({ state: 'visible', timeout: 5000 });

  const box = await target.boundingBox();
  if (!box) {
    throw new Error(`menu opener "${label}" has no bounding box`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);

  try {
    await target.hover({ timeout: 1000 });
  } catch {
    // Mouse movement above is the primary open action; hover() is best-effort.
  }

  await page.waitForTimeout(300);
}

async function openNavigationByOptions(page, options = {}) {
  const selectors = [
    options.openTriggerCssPath,
    options.hoverTargetCssPath,
    inferOpenTriggerCssPath(options),
    options.cssPath
  ].filter(Boolean);

  for (const selector of selectors) {
    const target = page.locator(selector).first();

    if (await locatorExists(target)) {
      try {
        await hoverMenuTarget(page, target, selector);
        return true;
      } catch {
        // Some plans only have the final menu item's cssPath. If that item is
        // present but hidden, keep looking and allow the depth1 fallback to run.
      }
    }
  }

  return false;
}

async function openDepth1ByIndex(page, depth1Index, options = {}) {
  if (await openNavigationByOptions(page, options)) {
    return;
  }

  const depth1 = page.locator('.menuContainer .depth1 > li').nth(depth1Index);
  await hoverMenuTarget(page, depth1, `depth1 index ${depth1Index}`);
}

async function highlightVisibleMenu(target, page, label = '') {
  if (process.env.HIGHLIGHT !== 'true') {
    return;
  }

  await target.evaluate((el, labelText) => {
    const originalOutline = el.style.outline;
    const originalBackground = el.style.backgroundColor;

    el.style.outline = '3px solid red';
    el.style.backgroundColor = 'rgba(255, 255, 0, 0.35)';

    const badge = document.createElement('div');
    badge.textContent = labelText || 'MENU ACTION';
    badge.setAttribute('data-gnb-highlight-badge', 'true');
    badge.style.position = 'fixed';
    badge.style.zIndex = '999999';
    badge.style.background = 'red';
    badge.style.color = 'white';
    badge.style.fontSize = '12px';
    badge.style.padding = '4px 8px';
    badge.style.borderRadius = '4px';
    badge.style.top = '10px';
    badge.style.left = '10px';

    document.body.appendChild(badge);

    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.backgroundColor = originalBackground;

      const existingBadge = document.querySelector('[data-gnb-highlight-badge="true"]');
      if (existingBadge) {
        existingBadge.remove();
      }
    }, 500);
  }, label);

  await page.waitForTimeout(300);
}

async function clickMenuTarget(page, target, label) {
  await target.waitFor({ state: 'visible', timeout: 5000 });

  const box = await target.boundingBox();
  if (!box) {
    throw new Error(`menu "${label}" has no bounding box`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);

  await highlightVisibleMenu(target, page, label);

  await target.click();
}

function escapeCssAttributeValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function clickVisibleMenuByText(page, text, options = {}) {
  await openNavigationByOptions(page, options);

  if (options.cssPath) {
    const cssPathTarget = page.locator(options.cssPath).first();

    if (await locatorExists(cssPathTarget)) {
      await clickMenuTarget(page, cssPathTarget, text);
      return;
    }
  }

  const menuContainer = page.locator('.menuContainer');
  if (await locatorExists(menuContainer)) {
    const menuTarget = menuContainer.getByText(text, { exact: true }).first();

    if (await locatorExists(menuTarget)) {
      await clickMenuTarget(page, menuTarget, text);
      return;
    }
  }

  const target = page.getByText(text, { exact: true }).first();

  await clickMenuTarget(page, target, text);
}

async function clickVisibleSubMenuByText(page, parentText, childText, options = {}) {
  await openNavigationByOptions(page, options);

  const menuContainer = page.locator('.menuContainer');
  const label = `${parentText} > ${childText}`;

  if (options.id) {
    const escapedId = escapeCssAttributeValue(options.id);
    const target = page.locator(`[id="${escapedId}"]`).first();

    if (await locatorExists(target)) {
      await clickMenuTarget(page, target, label);
      return;
    }
  }

  if (options.cssPath) {
    const target = page.locator(options.cssPath).first();

    if (await locatorExists(target)) {
      await clickMenuTarget(page, target, label);
      return;
    }
  }

  if (await locatorExists(menuContainer)) {
    const parent = menuContainer
      .locator('.depth2 > li')
      .filter({ has: page.getByText(parentText, { exact: true }) })
      .first();
    const target = parent.getByText(childText, { exact: true }).first();

    if (await locatorExists(target)) {
      await clickMenuTarget(page, target, label);
      return;
    }
  }

  const target = page.getByText(childText, { exact: true }).first();

  await clickMenuTarget(page, target, label);
}

module.exports = {
  openDepth1ByIndex,
  clickVisibleMenuByText,
  clickVisibleSubMenuByText
};
