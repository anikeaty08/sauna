// Ground truth for "all components must be inside it" on the curved families.
//
// Round:  everything must sit inside a vertical cylinder of radius (R - wall).
// Barrel: everything must sit inside a horizontal tube whose axis runs along X
//         at (y = R, z = R) - the cross-section closes to nothing at the very
//         bottom, which is what let the heater and the supply vent hang out
//         through the staves.
//
// Tests real transformed vertices, not bounding boxes: an AABB corner
// overstates radial extent by up to sqrt(2) on curved geometry.
import { chromium } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const SHAPES = (process.env.SHAPES || 'Round,Barrel').split(',');
// Toggling all ~26 accessories at once can exhaust the headless renderer on a
// low-memory host; cap it to keep the check about geometry, not about RAM.
const MAX_TOGGLES = +(process.env.MAX_TOGGLES || 10);
// Click via the DOM. The scene redraws every frame, so Playwright's own
// click can hang in "performing click action" even with force+noWaitAfter.
const clickSafe = async loc => { await loc.first().evaluate(el => el.click()); };
const openSection = async (page, id) => {
  const el = page.locator(`#section-${id}`);
  if (!(await el.evaluate(n => n.open))) await clickSafe(page.locator(`#section-${id} summary`));
};

const PROBE = `(() => {
  const { registry, THREE_DEBUG: THREE, cfg, family } = window.__saunaDebug;
  if (!cfg || !family) return { error: 'cfg/family not exposed' };
  const t = family.wall_mm / 1000;
  const isBarrel = family.type === 'barrel';
  const R = isBarrel ? cfg.depthCm / 200 : cfg.widthCm / 200;
  const rIn = R - t;
  const H = cfg.heightCm / 100;
  const len = cfg.widthCm / 100;

  // Derive the tube axis from the shell itself rather than assuming y = R:
  // the barrel is lifted onto cradles, so its axis sits above that.
  let axisY = R, axisZ = R;
  if (isBarrel) {
    const shell = new THREE.Box3();
    for (const m of registry) {
      const info = m.userData.info || {};
      if (info.category !== 'cabin' || !/stave|daube/i.test(info.name || '')) continue;
      m.updateMatrixWorld(true);
      shell.expandByObject(m);
    }
    if (!shell.isEmpty()) {
      axisY = (shell.min.y + shell.max.y) / 2;
      axisZ = (shell.min.z + shell.max.z) / 2;
    }
  }

  // Radial distance from the shell axis, and the along-axis coordinate.
  const radial = v => isBarrel
    ? Math.hypot(v.y - axisY, v.z - axisZ)
    : Math.hypot(v.x, v.z);
  const along = v => isBarrel ? v.x : v.y;
  const alongMax = isBarrel ? len : H;

  const offenders = {}, expectedOutside = {};
  for (const m of registry) {
    const info = m.userData.info || {};
    if (info.category === 'cabin') continue;
    m.updateMatrixWorld(true);
    const p = m.geometry.attributes.position, v = new THREE.Vector3();
    let worst = -Infinity, at = null;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      const a = along(v);
      if (a < -0.02 || a > alongMax + 0.02) continue;   // past the end caps
      const d = radial(v) - rIn;
      if (d > worst) { worst = d; at = [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]; }
    }
    if (worst > 0.005) {
      const key = (info.name || '?').slice(0, 44);
      // Open door leaves and exterior-mounted controls belong outside.
      const expected = info.category === 'door' || info.category === 'control'
                    || /terrace|Terrasse/i.test(info.name || '');
      const rec = { overBy: +worst.toFixed(3), at, category: info.category };
      const bag = expected ? expectedOutside : offenders;
      if (!bag[key] || bag[key].overBy < rec.overBy) bag[key] = rec;
    }
  }
  return { type: family.type, R, rIn: +rIn.toFixed(3), axis: [+axisY.toFixed(3), +axisZ.toFixed(3)],
           count: Object.keys(offenders).length, offenders, expectedOutside };
})()`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  let crashed = false;
  page.on('crash', () => { crashed = true; });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.preset-card');
  await page.locator('.preset-card').nth(1).click();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(800);
  await openSection(page, 'cabin');

  for (const shape of SHAPES) {
    await clickSafe(page.locator('.type-filter button').filter({ hasText: shape }).first());
    await page.waitForTimeout(400);
    await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').first());
    await page.waitForTimeout(1100);

    console.log(`\n### ${shape} (defaults)`);
    console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));

    // Then switch everything on one section at a time, probing after each so a
    // crash names the section that caused it.
    for (const sec of ['interior', 'lighting', 'accessory']) {
      try { await openSection(page, sec); } catch { continue; }
      const n = Math.min(MAX_TOGGLES, await page.locator(`#section-${sec} .opt-row`).count());
      for (let i = 0; i < n; i++) {
        const label = (await page.locator(`#section-${sec} .opt-row`).nth(i).innerText().catch(() => '?')).split('\n')[0].slice(0, 34);
        try { await page.locator(`#section-${sec} .opt-row`).nth(i).evaluate(el => el.click()); } catch {}
        await page.waitForTimeout(160);
        if (crashed || page.isClosed()) { console.log(`  RENDERER CRASHED right after toggling: ${label}`); throw new Error('page crashed'); }
      }
      await page.waitForTimeout(700);
      try {
        const r = await page.evaluate(PROBE);
        console.log(`  after ${sec} (${n} rows): offenders=${r.count} ${JSON.stringify(r.offenders)}`);
      } catch (e) { console.log(`  after ${sec}: FAILED - ${e.message.split('\n')[0]}`); throw e; }
    }
  }
  await browser.close();
})();
