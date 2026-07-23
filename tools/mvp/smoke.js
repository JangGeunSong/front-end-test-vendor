const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const targetUrl = option('url');
const mode = option('mode', 'navigation-only');
const port = Number(option('port', '4174'));

if (!targetUrl || !['interaction', 'navigation-only'].includes(mode)) {
  throw new Error('Usage: node tools/mvp/smoke.js --url <url> --mode <interaction|navigation-only> [--port <port>]');
}

async function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MVP server did not start.')), 10000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Local Test MVP')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`MVP server exited early with code ${code}.`));
    });
  });
}

async function main() {
  const server = spawn(process.execPath, ['tools/mvp/server.js'], {
    cwd: process.cwd(),
    windowsHide: true,
    env: { ...process.env, MVP_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator('#target-url').fill(targetUrl);
    await page.locator('#analyze-form button[type="submit"]').click();
    const runId = await page.evaluate(() => state.runId);
    const analysisDeadline = Date.now() + 600000;
    while (Date.now() < analysisDeadline) {
      const response = await page.request.get(`http://127.0.0.1:${port}/api/runs/${runId}/status`);
      const status = await response.json();
      if (status.status === 'failed') {
        throw new Error(`Analysis failed: ${status.error}\n${JSON.stringify(status.debugLog, null, 2)}`);
      }
      if (status.status === 'ready_for_execution') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await page.locator('#review-panel:not(.hidden)').waitFor({ timeout: 10000 });

    const navigationCollapsed = !(await page.locator('#navigation-details').evaluate((node) => node.open));
    const readyFilterDefault = await page.locator('[data-filter="ready"]').getAttribute('aria-pressed') === 'true';
    const navigationCount = Number((await page.locator('#navigation-total').textContent()).match(/\d+/)?.[0] || 0);
    await page.locator('#navigation-details > summary').click();
    const navigationExpanded = await page.locator('#navigation-details').evaluate((node) => node.open);
    await page.locator('#navigation-details > summary').click();
    const navigationRecollapsed = !(await page.locator('#navigation-details').evaluate((node) => node.open));

    let selectedCount = 0;
    let selectedFilterWorks = null;
    if (mode === 'interaction') {
      const card = page.locator('.interaction-card:not(.filtered-out)').first();
      await card.waitFor();
      await card.locator('p').first().click();
      selectedCount = 1;
      if (!(await card.evaluate((node) => node.classList.contains('selected')))) {
        throw new Error('Selected interaction card styling was not applied.');
      }
      await page.locator('[data-filter="selected"]').click();
      selectedFilterWorks = await card.isVisible();
      await page.locator('[data-filter="ready"]').click();
      await page.locator('#explicit-approval').check();
      await page.locator('#approve-button').click();
      await page.getByText('Approval validated.', { exact: false }).waitFor({ timeout: 120000 });
    }

    const runButtonEnabled = await page.locator('#execute-button').isEnabled();
    await page.locator('#execute-button').click();
    await page.locator('#result-panel:not(.hidden)').waitFor({ timeout: 900000 });

    const resultResponse = await page.request.get(`http://127.0.0.1:${port}/api/runs/${runId}/result`);
    const result = await resultResponse.json();
    const statusResponse = await page.request.get(`http://127.0.0.1:${port}/api/runs/${runId}/status`);
    const status = await statusResponse.json();
    const reportResponse = await page.request.get(`http://127.0.0.1:${port}${result.reportUrl}`);
    const reportHtml = await reportResponse.text();

    process.stdout.write(`${JSON.stringify({
      runId,
      targetUrl,
      mode,
      navigationCollapsed,
      navigationExpanded,
      navigationRecollapsed,
      readyFilterDefault,
      selectedFilterWorks,
      runButtonEnabled,
      navigationCount,
      selectedCount,
      overall: result.overall,
      pageNavigation: result.pageNavigation,
      softInteractions: result.softInteractions,
      interactionStages: Object.fromEntries(
        Object.entries(status.stages).filter(([name]) => name.startsWith('Interaction')),
      ),
      reportStatus: reportResponse.status(),
      reportHasPlaywrightTitle: /Playwright Test Report/i.test(reportHtml),
    }, null, 2)}\n`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
