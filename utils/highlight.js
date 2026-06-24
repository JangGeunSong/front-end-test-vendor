async function highlight(locator, page, label = '') {
  if (process.env.HIGHLIGHT !== 'true') {
    return;
  }

  const element = locator.first();

  await element.waitFor({ state: 'visible', timeout: 5000 });

  await element.evaluate((el, labelText) => {
    el.scrollIntoView({ block: 'center', inline: 'center' });

    const originalOutline = el.style.outline;
    const originalBackground = el.style.backgroundColor;

    el.style.outline = '3px solid red';
    el.style.backgroundColor = 'rgba(255, 255, 0, 0.35)';

    const badge = document.createElement('div');
    badge.textContent = labelText || 'TEST ACTION';
    badge.setAttribute('data-playwright-highlight-badge', 'true');
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

      const existingBadge = document.querySelector('[data-playwright-highlight-badge="true"]');
      if (existingBadge) {
        existingBadge.remove();
      }
    }, 800);
  }, label);

  await page.waitForTimeout(500);
}

async function highlightAndClick(locator, page, label = '') {
  await locator.first().waitFor({ state: 'visible', timeout: 5000 });
  await highlight(locator, page, label);
  await locator.first().click();
}

async function highlightAndHover(locator, page, label = '') {
  await locator.first().waitFor({ state: 'visible', timeout: 5000 });
  await highlight(locator, page, label);
  await locator.first().hover();
}

async function moveMouseToPageBody(page) {
  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  const x = Math.max(20, Math.floor(viewport.width / 2));
  const y = Math.max(20, viewport.height - 40);

  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
}

async function highlightPageIdentity(page, locator, label = '') {
  if (process.env.HIGHLIGHT !== 'true') {
    return;
  }

  const target = locator.first();

  try {
    await moveMouseToPageBody(page);
    await target.waitFor({ state: 'visible', timeout: 3000 });

    await target.evaluate((el, labelText) => {
      el.scrollIntoView({ block: 'center', inline: 'center' });

      const originalOutline = el.style.outline;
      const originalBoxShadow = el.style.boxShadow;
      const originalBackground = el.style.backgroundColor;

      el.style.outline = '4px solid #2563eb';
      el.style.boxShadow = '0 0 0 6px rgba(37, 99, 235, 0.25)';
      el.style.backgroundColor = 'rgba(147, 197, 253, 0.25)';

      const existingBadge = document.querySelector('[data-page-identity-highlight-badge="true"]');
      if (existingBadge) {
        existingBadge.remove();
      }

      const badge = document.createElement('div');
      badge.textContent = `PAGE IDENTITY${labelText ? `: ${labelText}` : ''}`;
      badge.setAttribute('data-page-identity-highlight-badge', 'true');
      badge.style.position = 'fixed';
      badge.style.zIndex = '999999';
      badge.style.background = '#2563eb';
      badge.style.color = 'white';
      badge.style.fontSize = '12px';
      badge.style.fontWeight = '700';
      badge.style.padding = '5px 9px';
      badge.style.borderRadius = '4px';
      badge.style.top = '10px';
      badge.style.left = '10px';
      badge.style.maxWidth = '70vw';
      badge.style.whiteSpace = 'nowrap';
      badge.style.overflow = 'hidden';
      badge.style.textOverflow = 'ellipsis';

      document.body.appendChild(badge);

      setTimeout(() => {
        el.style.outline = originalOutline;
        el.style.boxShadow = originalBoxShadow;
        el.style.backgroundColor = originalBackground;

        const badgeToRemove = document.querySelector('[data-page-identity-highlight-badge="true"]');
        if (badgeToRemove) {
          badgeToRemove.remove();
        }
      }, 1200);
    }, label);

    await page.waitForTimeout(700);
  } catch (error) {
    console.warn(`PAGE IDENTITY highlight skipped: ${error.message}`);
  }
}

module.exports = {
  highlight,
  highlightAndClick,
  highlightAndHover,
  highlightPageIdentity
};
