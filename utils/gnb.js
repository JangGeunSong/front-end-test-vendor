async function openDepth1ByIndex(page, depth1Index) {
  const depth1 = page.locator('.menuContainer .depth1 > li').nth(depth1Index);

  await depth1.waitFor({ state: 'visible', timeout: 5000 });

  const box = await depth1.boundingBox();
  if (!box) {
    throw new Error(`depth1 index ${depth1Index} has no bounding box`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
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

async function clickVisibleMenuByText(page, text) {
  const target = page.locator('.menuContainer').getByText(text, { exact: true }).first();

  await target.waitFor({ state: 'visible', timeout: 5000 });

  const box = await target.boundingBox();
  if (!box) {
    throw new Error(`menu "${text}" has no bounding box`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);

  await highlightVisibleMenu(target, page, text);

  await target.click();
}

module.exports = {
  openDepth1ByIndex,
  clickVisibleMenuByText
};