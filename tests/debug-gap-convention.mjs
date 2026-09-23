// Ground truth: where is the shell's door gap ACTUALLY located in world space?
// Samples the shell's own vertices and finds the angular sector with no geometry.
import { chromium } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
// Click via the DOM. The scene redraws every frame, so Playwright's own
// click can hang in "performing click action" even with force+noWaitAfter.
const clickSafe = async loc => { await loc.first().evaluate(el => el.click()); };
const openSection = async (page, id) => {
  const el = page.locator(`#section-${id}`);
  if (!(await el.evaluate(n => n.open))) await clickSafe(page.locator(`#section-${id} summary`));
};
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.preset-card');
  await page.locator('.preset-card').nth(1).click();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(800);
  await openSection(page, 'cabin');
  await clickSafe(page.locator('.type-filter button').filter({ hasText: 'Round' }));
  await page.waitForTimeout(400);
  await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').first());
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const { registry, THREE_DEBUG: THREE } = window.__saunaDebug;
    const shell = registry.find(m => /round wall/i.test(m.userData.info?.name || ''));
    const pos = shell.geometry.attributes.position;
    // Collect the distinct compass bearings (deg, atan2(x,z)) present in the shell.
    const bearings = new Set();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.hypot(x, z) < 1e-6) continue;
      bearings.add(Math.round((Math.atan2(x, z) * 180 / Math.PI + 360) % 360));
    }
    const present = [...bearings].sort((a, b) => a - b);
    // Find the largest angular gap between consecutive present bearings.
    let gapStart = null, gapSize = 0;
    for (let i = 0; i < present.length; i++) {
      const a = present[i], b = present[(i + 1) % present.length];
      const d = ((b - a) + 360) % 360;
      if (d > gapSize) { gapSize = d; gapStart = a; }
    }
    const doorLeaf = registry.find(m => /Round cabin door/i.test(m.userData.info?.name || ''));
    doorLeaf.updateMatrixWorld(true);
    const wp = new THREE.Vector3(); doorLeaf.getWorldPosition(wp);
    const doorBearing = Math.round((Math.atan2(wp.x, wp.z) * 180 / Math.PI + 360) % 360);
    return {
      shellGapFromDeg: gapStart, shellGapSizeDeg: gapSize,
      shellGapCentreDeg: Math.round((gapStart + gapSize / 2) % 360),
      doorLeafWorld: wp.toArray().map(v => +v.toFixed(3)),
      doorLeafBearingDeg: doorBearing,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
