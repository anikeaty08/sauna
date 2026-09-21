// Manual smoke check for the sauna customizer, run with:
//   node tests/customizer.spec.js
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';

function log(...args) { console.log('[smoke]', ...args); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.preset-card', { timeout: 15000 });
  log('preset picker rendered, cards:', await page.locator('.preset-card').count());
  await page.screenshot({ path: 'test-results/01-presets.png' });

  await page.locator('.preset-card').nth(1).click();
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(1200);
  log('total after preset pick:', await page.locator('.grand-total b').textContent());
  await page.screenshot({ path: 'test-results/02-customize.png' });

  // Change width and confirm the total updates.
  const before = await page.locator('.grand-total b').textContent();
  await page.locator('.dims-row select').first().selectOption({ index: 3 });
  await page.waitForTimeout(400);
  const after = await page.locator('.grand-total b').textContent();
  log('width change total:', before, '->', after);
  await page.screenshot({ path: 'test-results/03-width-change.png' });

  // Click on the 3D canvas near the heater and expect the drawer to open on some click.
  const canvasBox = await page.locator('canvas').boundingBox();
  await page.mouse.click(canvasBox.x + canvasBox.width * 0.55, canvasBox.y + canvasBox.height * 0.62);
  await page.waitForTimeout(400);
  const drawerOpen = await page.locator('.component-drawer').count();
  log('component drawer opened on click:', drawerOpen > 0);
  await page.screenshot({ path: 'test-results/04-click-component.png' });

  // Toggle a lighting checkbox via the persistent panel and confirm the price responds.
  await page.locator('#section-lighting summary').click();
  const totalBeforeLight = await page.locator('.grand-total b').textContent();
  await page.locator('#section-lighting .opt-row').first().click();
  await page.waitForTimeout(300);
  const totalAfterLight = await page.locator('.grand-total b').textContent();
  log('lighting toggle total:', totalBeforeLight, '->', totalAfterLight);
  await page.screenshot({ path: 'test-results/05-lighting-toggle.png' });

  log('console/page errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exitCode = 1;
})();
