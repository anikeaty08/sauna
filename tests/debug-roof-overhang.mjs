// For every entry type, test whether the roof/ceiling slab extends beyond the
// footprint the walls actually describe. Uses the convex hull of all wall
// vertices in XZ as ground truth, so it works for rectangular, chamfered,
// glass-corner and hex footprints alike.
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
  const { registry, THREE_DEBUG: THREE } = window.__saunaDebug;
  const wallPts = [], roofPts = [];
  for (const m of registry) {
    const name = m.userData.info?.name || '';
    const isRoof = /Decke|Ceiling|shingle|Dacheindeckung|roof/i.test(name);
    const isWall = /Wand|wall|Glasfront|Glass front|window|Fenster|Türrahmen|Door frame|mullion|Eckpfosten|profile|Profil/i.test(name);
    if (!isRoof && !isWall) continue;
    m.updateMatrixWorld(true);
    const p = m.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      (isRoof ? roofPts : wallPts).push([v.x, v.z]);
    }
  }
  if (!wallPts.length || !roofPts.length) return { skip: true, walls: wallPts.length, roof: roofPts.length };
  // convex hull (monotone chain)
  const cross = (o,a,b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const pts = wallPts.slice().sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length>=2 && cross(lo[lo.length-2], lo[lo.length-1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i=pts.length-1;i>=0;i--){ const p=pts[i]; while (up.length>=2 && cross(up[up.length-2], up[up.length-1], p) <= 0) up.pop(); up.push(p); }
  const hull = lo.slice(0,-1).concat(up.slice(0,-1));
  // max signed distance of any roof point outside the hull
  let worst = 0;
  for (const q of roofPts) {
    let d = -Infinity;
    for (let i=0;i<hull.length;i++){
      const a=hull[i], b=hull[(i+1)%hull.length];
      const ex=b[0]-a[0], ez=b[1]-a[1];
      const len=Math.hypot(ex,ez) || 1;
      // outward normal for a CCW hull
      const nx=ez/len, nz=-ex/len;
      d = Math.max(d, (q[0]-a[0])*nx + (q[1]-a[1])*nz);
    }
    worst = Math.max(worst, d);
  }
  return { overhang: +worst.toFixed(3), hullPts: hull.length };
})()`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.preset-card');
  await page.locator('.preset-card').nth(1).click();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(800);
  await openSection(page, 'cabin');
  // Zirbe offers every entry type.
  await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').filter({ hasText: /Zirbe|Stone pine/i }).first());
  await page.waitForTimeout(700);

  const label = page.locator('#section-cabin').getByText('Entry & glazing', { exact: true });
  const opts = label.locator('xpath=following-sibling::div[1]').locator('.opt-swatch');
  const names = await opts.allTextContents();
  for (let i = 0; i < names.length; i++) {
    await clickSafe(opts.nth(i));
    await page.waitForTimeout(700);
    const res = await page.evaluate(PROBE);
    const tag = names[i].replace(/included|\+CHF.*/gi, '').trim();
    console.log(`${tag.padEnd(18)} -> ${JSON.stringify(res)}`);
  }

  // hex family too
  await clickSafe(page.locator('.type-filter button').filter({ hasText: 'Hexagon' }));
  await page.waitForTimeout(400);
  await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').first());
  await page.waitForTimeout(900);
  console.log('hexagon'.padEnd(18) + ' -> ' + JSON.stringify(await page.evaluate(PROBE)));
  await browser.close();
})();
