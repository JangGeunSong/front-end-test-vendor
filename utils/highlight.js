async function highlight(locator, page, label = '') {
  if (process.env.HIGHLIGHT !== 'true') {
    return;
  }
  
  const element = locator.first();

  await element.evaluate((el, labelText) => {
    el.scrollIntoView({ block: 'center', inline: 'center' });

    const originalOutline = el.style.outline;
    const originalBackground = el.style.backgroundColor;
    const originalPosition = el.style.position;

    el.style.outline = '3px solid red';
    el.style.backgroundColor = 'rgba(255, 255, 0, 0.35)';
    el.style.position = originalPosition || 'relative';

    const badge = document.createElement('div');
    badge.textContent = labelText || 'TEST ACTION';
    badge.setAttribute('data-playwright-highlight-badge', 'true');
    badge.style.position = 'absolute';
    badge.style.zIndex = '999999';
    badge.style.background = 'red';
    badge.style.color = 'white';
    badge.style.fontSize = '12px';
    badge.style.padding = '2px 6px';
    badge.style.borderRadius = '4px';
    badge.style.top = '0';
    badge.style.left = '0';

    el.appendChild(badge);

    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.backgroundColor = originalBackground;
      const existingBadge = el.querySelector('[data-playwright-highlight-badge="true"]');
      if (existingBadge) {
        existingBadge.remove();
      }
    }, 800);
  }, label);

  await page.waitForTimeout(500);
}

async function highlightAndClick(locator, page, label = '') {
  await highlight(locator, page, label);
  await locator.first().click();
}

async function highlightAndHover(locator, page, label = '') {
  await highlight(locator, page, label);
  await locator.first().hover();
}

module.exports = {
  highlight,
  highlightAndClick,
  highlightAndHover
};