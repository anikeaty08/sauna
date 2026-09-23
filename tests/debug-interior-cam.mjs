// Why is the interior camera point-blank against a surface? Compare where the
// builder ASKED the camera to stand (interiorView) with where it actually is
// in world space, and raycast forward to see what it is nose-to-nose with.
import { chromium } from '@playwright/test';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
// Click via the DOM. The scene redraws every frame, so Playwright's own
// click can hang in "performing click action" even with force+noWaitAfter.
const clickSafe = async loc => { await loc.first().evaluate(el => el.click()); };

const PROBE = `(() => {
  const { camera, controls, registry, scene, THREE_DEBUG: THREE, cfg, family } = window.__saunaDebug;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const ray = new THREE.Raycaster(camera.position.clone(), dir.clone());
  // Raycast the WHOLE scene, not just the registry: untagged meshes (fixture
  // sub-parts, glass) are exactly what an unexplained panel in frame would be.
  const hits = ray.intersectObjects(scene.children, true).slice(0, 5).map(h => ({
    dist: +h.distance.toFixed(3),
    name: (h.object.userData.info?.name || h.object.name || h.object.type).slice(0, 40),
    cat: h.object.userData.info?.category || '(untagged)',
    mat: h.object.material && (h.object.material.name || h.object.material.type),
    transparent: !!(h.object.material && h.object.material.transparent),
    opacity: h.object.material && h.object.material.opacity,
  }));
  // Where is the model group actually sitting?
  const model = registry[0] && registry[0].parent;
  let root = registry[0]; while (root && root.parent && root.parent.type !== 'Scene') root = root.parent;
  const bb = new THREE.Box3().setFromObject(root);
  return {
    family: cfg.family, type: family.type,
    camera: camera.position.toArray().map(n => +n.toFixed(3)),
    target: controls.target.toArray().map(n => +n.toFixed(3)),
    near: camera.near, fov: camera.fov,
    dist_cam_to_target: +camera.position.distanceTo(controls.target).toFixed(3),
    rootName: root?.name || root?.type,
    rootPos: root?.position.toArray().map(n => +n.toFixed(3)),
    worldBBox: { min: bb.min.toArray().map(n => +n.toFixed(2)), max: bb.max.toArray().map(n => +n.toFixed(2)) },
    firstHits: hits,
    transparentMeshes: (() => {
      const out = [];
      scene.traverse(o => {
        if (!o.isMesh || !o.material || !o.material.transparent) return;
        const wp = new THREE.Vector3(); o.getWorldPosition(wp);
        const bb = new THREE.Box3().setFromObject(o);
        out.push({
          name: (o.userData.info?.name || o.name || o.type).slice(0, 34),
          cat: o.userData.info?.category || '(untagged)',
          opacity: o.material.opacity,
          pos: wp.toArray().map(n => +n.toFixed(2)),
          size: bb.getSize(new THREE.Vector3()).toArray().map(n => +n.toFixed(2)),
        });
      });
      return out;
    })(),
  };
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
  const openSection = async id => {
    const el = page.locator(`#section-${id}`);
    if (!(await el.evaluate(n => n.open))) await clickSafe(page.locator(`#section-${id} summary`));
  };
  await openSection('cabin');

  for (const shape of ['Round', 'Barrel', 'Hexagon']) {
    await clickSafe(page.locator('.type-filter button').filter({ hasText: shape }).first());
    await page.waitForTimeout(400);
    await clickSafe(page.locator('#section-cabin .opt-grid').first().locator('.opt-swatch').first());
    await page.waitForTimeout(1200);
    for (const view of ['Exterior', 'Interior']) {
      const b = page.locator('button, .view-btn').filter({ hasText: new RegExp(view, 'i') });
      if (await b.count()) { await clickSafe(b.first()); await page.waitForTimeout(1800); }
      console.log(`\n### ${shape} / ${view}`);
      console.log(JSON.stringify(await page.evaluate(PROBE)));
    }
  }
  await browser.close();
})();
