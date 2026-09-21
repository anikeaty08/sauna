import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('console', msg => console.log('[page]', msg.text()));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.preset-card');
  await page.locator('.preset-card').nth(1).click();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    // Reach into React internals is fragile; instead read from a debug hook we set below.
    return window.__saunaDebug || null;
  });
  console.log('debug info:', JSON.stringify(info, null, 2));
  await browser.close();
})();
