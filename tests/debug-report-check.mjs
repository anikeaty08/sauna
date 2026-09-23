// One probe for the three shapes the user reports as broken. Captures console
// errors (no previous harness did), the registry composition, and screenshots,
// so we see what the user sees instead of inferring it.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const OUT = process.env.OUT || '.';
// Click via the DOM. The scene redraws every frame, so Playwright's own
// click can hang in "performing click action" even with force+noWaitAfter.
const clickSafe = async loc => { await loc.first().evaluate(el => el.click()); };
const openSection = async (page, id) => {
  const el = page.locator(`#section-${id}`);
  if (!(await el.evaluate(n => n.open))) await clickSafe(page.locator(`#section-${id} summary`));
};

const SUMMARY = `(() => {
  const d = window.__saunaDebug;
  if (!d) return { error: 'no __saunaDebug' };
  const { registry, THREE_DEBUG: THREE } = d;
  const byCat = {}, names = [];
  const bb = new THREE.Box3();
  let visibleCount = 0;
  for (const m of registry) {
    const info = m.userData.info || {};
    byCat[info.category || '?'] = (byCat[info.category || '?'] || 0) + 1;
    names.push(info.name || '?');
    m.updateMatrixWorld(true);
    let vis = m.visible, p = m.parent;
    while (p) { if (!p.visible) vis = false; p = p.parent; }
    if (vis) { visibleCount++; bb.expandByObject(m); }
  }
  const door = names.filter(n => /t\\u00fcr|door|leaf/i.test(n));
  return {
    meshes: registry.length, visible: visibleCount, byCat,
    doorParts: door,
    bbox: bb.isEmpty() ? null : {
      min: [+bb.min.x.toFixed(2), +bb.min.y.toFixed(2), +bb.min.z.toFixed(2)],
      max: [+bb.max.x.toFixed(2), +bb.max.y.toFixed(2), +bb.max.z.toFixed(2)]
    }
  };
})()`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type().toUpperCase() + ': ' + m.text().slice(0, 300)); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.preset-card');
  await page.locator('.preset-card').nth(1).click();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(800);
  await openSection(page, 'cabin');

  const filters = await page.locator('.type-filter button').allTextContents();
  console.log('type filters:', JSON.stringify(filters));

  for (const shape of ['Round', 'Hexagon', 'Barrel']) {
    const btn = page.locator('.type-filter button').filter({ hasText: shape });
    if (!(await btn.count())) { console.log(`\n### ${shape}: NO FILTER BUTTON`); continue; }
    errors.length = 0;
    await clickSafe(btn.first());
    await page.waitForTimeout(400);
    const swatches = page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch');
    console.log(`\n### ${shape} — ${await swatches.count()} family option(s)`);
    await clickSafe(swatches.first());
    await page.waitForTimeout(1500);

    console.log(JSON.stringify(await page.evaluate(SUMMARY), null, 1));
    if (errors.length) console.log('CONSOLE:\n  ' + [...new Set(errors)].join('\n  '));
    else console.log('CONSOLE: clean');

    // Reset to Exterior first: the view persists across shape changes, so
    // without this the "exterior" shot is whatever the previous shape left on.
    const outside = page.locator('button, .view-btn').filter({ hasText: /Exterior|Aussen/i });
    if (await outside.count()) { await clickSafe(outside.first()); await page.waitForTimeout(1600); }
    await page.screenshot({ path: `${OUT}/${shape.toLowerCase()}-ext.png` });
    const inside = page.locator('button, .view-btn').filter({ hasText: /Interior|Innen/i });
    if (await inside.count()) {
      await clickSafe(inside.first());
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${OUT}/${shape.toLowerCase()}-int.png` });
    }
  }
  await browser.close();
})();
