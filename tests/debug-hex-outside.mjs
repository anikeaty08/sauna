// Ground truth for "something pokes out of the hexagon".
//
// Tests every non-shell mesh's real transformed vertices against the hex
// footprint polygon reconstructed from cfg (widthCm/depthCm/wall_mm), inset by
// the wall thickness along each edge's own normal.
//
// It deliberately does NOT derive W/D from the registry bounding box: that box
// includes the roof overhang (z ran to 2.65 for a 2.00 m deep cabin), which
// moves the hexagon's widest point and makes the whole front half of the test
// far too lenient. Use the config, not the bounds.
import { chromium } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
// Click via the DOM. The scene redraws every frame, so Playwright's own
// click can hang in "performing click action" even with force+noWaitAfter.
const clickSafe = async loc => { await loc.first().evaluate(el => el.click()); };
const openSection = async (page, id) => {
  const el = page.locator(`#section-${id}`);
  if (!(await el.evaluate(n => n.open))) await clickSafe(page.locator(`#section-${id} summary`));
};

const PROBE = `(() => {
  const { registry, THREE_DEBUG: THREE, cfg, family } = window.__saunaDebug;
  if (!cfg || !family) return { error: 'cfg/family not exposed on __saunaDebug' };
  const W = cfg.widthCm / 100, D = cfg.depthCm / 100, t = family.wall_mm / 1000;
  const half = W * 0.28, R = W / 2, pz = D / 2;
  // Same polygon planPolygon() builds, CCW from above.
  const poly = [[-half,0],[-R,pz],[-half,D],[half,D],[R,pz],[half,0]];

  // Outward unit normal per edge; signed distance > 0 means outside that edge.
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const ex = b[0]-a[0], ez = b[1]-a[1], L = Math.hypot(ex, ez) || 1;
    return { a, nx: ez/L, nz: -ex/L };
  });
  // Orientation check: the centroid must be strictly inside every edge.
  const cx = poly.reduce((s,p)=>s+p[0],0)/poly.length, cz = poly.reduce((s,p)=>s+p[1],0)/poly.length;
  const flip = edges.some(e => (cx-e.a[0])*e.nx + (cz-e.a[1])*e.nz > 0) ? -1 : 1;
  const dist = (x, z) => Math.max(...edges.map(e => flip*((x-e.a[0])*e.nx + (z-e.a[1])*e.nz)));

  const offenders = {}, expectedOutside = {};
  for (const m of registry) {
    const info = m.userData.info || {};
    if (info.category === 'cabin') continue;          // walls/roof/floor ARE the shell
    m.updateMatrixWorld(true);
    const p = m.geometry.attributes.position, v = new THREE.Vector3();
    let worst = -Infinity, at = null;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.y < 0.01) continue;                        // ground shadow plane
      const d = dist(v.x, v.z);
      if (d > worst) { worst = d; at = [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]; }
    }
    // Inner face of the wall sits at -t. Anything past that is inside the wall
    // or clean through it.
    const over = worst + t;
    if (over > 0.005) {
      const key = (info.name || '?').slice(0, 44);
      // A swung-open door leaf and an exterior-mounted control panel are
      // SUPPOSED to sit outside the shell - list them, but don't fail on them.
      const expected = info.category === 'door' || info.category === 'control';
      const rec = { overBy: +over.toFixed(3), at, category: info.category, through: worst > 0 };
      const bag = expected ? expectedOutside : offenders;
      if (!bag[key] || bag[key].overBy < rec.overBy) bag[key] = rec;
    }
  }
  return { W, D, t, half: +half.toFixed(2), R,
           count: Object.keys(offenders).length, offenders, expectedOutside };
})()`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.preset-card');
  await page.locator('.preset-card').nth(1).click();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(800);
  await openSection(page, 'cabin');
  await clickSafe(page.locator('.type-filter button').filter({ hasText: 'Hexagon' }));
  await page.waitForTimeout(400);
  await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').first());
  await page.waitForTimeout(1000);

  console.log('baseline:');
  console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));

  // Turn on every interior toggle so all furniture types are present. Toggling
  // re-renders the panel, so locators go stale - each click is best-effort.
  for (const sec of ['interior', 'lighting', 'accessory']) {
    try { await openSection(page, sec); } catch { continue; }
    const n = await page.locator(`#section-${sec} .opt-row`).count();
    for (let i = 0; i < n; i++) {
      try { await page.locator(`#section-${sec} .opt-row`).nth(i).evaluate(el => el.click()); } catch {}
    }
    console.log(`  toggled ${n} rows in ${sec}`);
  }
  const lBtn = page.locator('#section-interior .opt-swatch').filter({ hasText: /L-shape/i });
  if (await lBtn.count()) { try { await clickSafe(lBtn.first()); } catch {} }
  await page.waitForTimeout(900);

  console.log('\nall fixtures on:');
  console.log(JSON.stringify(await page.evaluate(PROBE), null, 1));
  await browser.close();
})();
