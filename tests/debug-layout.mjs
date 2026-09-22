import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle' });
await page.waitForSelector('.preset-card');
await page.locator('.preset-card').first().click();
await page.waitForSelector('canvas');
await page.waitForTimeout(1000);
const info = await page.evaluate(() => {
  const q = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { sel, rect: { top: r.top, bottom: r.bottom, height: r.height }, position: cs.position, display: cs.display, overflow: cs.overflowY, height: cs.height }; };
  return [q('.customize-layout'), q('.customizer-panel'), q('.panel-sections'), q('.total-bar'), q('#section-cabin'), q('.type-filter')];
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
