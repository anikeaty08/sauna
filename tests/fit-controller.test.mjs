// FitController: raw hit stream -> placement decisions, driven by synthetic rooms.
//   node --test tests/fit-controller.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { FitController } from '../app/client/sauna/ar/fitController.js';

const SAUNA = { width: 2.0, depth: 1.8, height: 2.1, margin: 0.05, swing: { width: 0.7, depth: 0.7, offsetX: -0.4 } };
const FLOOR_Y = -1.4;                 // phone held ~1.4 m above the floor
const VIEWER = { x: 0, z: 0, yaw: 0 };

/** One sweep of hits over a room: floor, a wall at z = wallZ, optional extras. */
function sweep({ x0 = -3, x1 = 3, z0 = 0.2, z1 = 4, wallZ = 4, extra = [] } = {}) {
  const hits = [];
  for (let x = x0; x < x1; x += 0.1) for (let z = z0; z < z1; z += 0.1) hits.push({ x, y: FLOOR_Y, z, ny: 1 });
  if (wallZ !== null) for (let x = x0; x < x1; x += 0.1) for (let h = 0.2; h < 2; h += 0.3) hits.push({ x, y: FLOOR_Y + h, z: wallZ + 0.05, ny: 0 });
  return hits.concat(extra);
}

function run(ctrl, batches, { stepMs = 400, viewer = VIEWER } = {}) {
  let t = 0, st;
  for (const b of batches) { ctrl.ingest(b); t += stepMs; st = ctrl.update(viewer, t); }
  return { st, t };
}

test('scanning -> placed -> locked on a clear room with a back wall', () => {
  const c = new FitController(SAUNA);
  assert.equal(c.state().phase, 'scanning');
  const { st } = run(c, Array.from({ length: 12 }, () => sweep()));
  assert.equal(st.phase, 'locked');
  assert.equal(st.pose.fits, true);
  assert.ok(Math.abs(st.floorY - FLOOR_Y) < 0.01);
  assert.ok(st.pose.wallFrac > 0.5, 'should back onto the wall');
});

test('floor is the LOWEST horizontal surface, not a table top', () => {
  const table = [];
  for (let x = -0.5; x < 0.5; x += 0.1) for (let z = 1; z < 1.8; z += 0.1) table.push({ x, y: FLOOR_Y + 0.75, z, ny: 1 });
  const c = new FitController(SAUNA);
  run(c, [sweep({ extra: table }), sweep({ extra: table })]);
  assert.ok(Math.abs(c.floorY - FLOOR_Y) < 0.01, `floorY ${c.floorY} should be the floor, not the table`);
  const ev = c.grid.state(0, 1.4);
  assert.equal(ev, 1, 'the table area must be marked blocked');
});

test('gives up gracefully when not enough clear floor is ever seen', () => {
  const c = new FitController(SAUNA, { giveUpMs: 3000 });
  const { st } = run(c, Array.from({ length: 12 }, () => sweep({ x0: -0.5, x1: 0.5, wallZ: null })));
  assert.equal(st.phase, 'locked');
  assert.equal(st.pose.fits, false);
  assert.equal(st.pose.reason, 'not-enough-seen');
});

test('manual placement onto furniture is flagged, and rotation re-checks the fit', () => {
  const sofa = [];
  for (let x = -1; x < 1; x += 0.1) for (let z = 2; z < 2.8; z += 0.1) { sofa.push({ x, y: FLOOR_Y + 0.4, z, ny: 1 }); sofa.push({ x, y: FLOOR_Y + 0.4, z, ny: 1 }); }
  const c = new FitController(SAUNA);
  run(c, Array.from({ length: 6 }, () => sweep({ extra: sofa })));
  c.placeManually(0, 2.4, VIEWER);
  assert.equal(c.state().phase, 'locked');
  assert.equal(c.state().pose.fits, false);
  assert.equal(c.state().pose.reason, 'obstacles');
  const before = c.state().pose.rot;
  c.rotateBy(Math.PI / 2);
  assert.ok(Math.abs(c.state().pose.rot - before - Math.PI / 2) < 1e-9);
});

test('warns when the ceiling is lower than the cabin', () => {
  const ceiling = [];
  for (let x = -1; x < 1; x += 0.3) ceiling.push({ x, y: FLOOR_Y + 1.95, z: 2, ny: -1 });
  const c = new FitController(SAUNA);
  run(c, [sweep({ extra: ceiling })]);
  assert.deepEqual(c.state().warnings, ['ceiling-low']);
});

test('refit releases a lock and plans again', () => {
  const c = new FitController(SAUNA);
  const { t } = run(c, Array.from({ length: 12 }, () => sweep()));
  c.placeManually(2.5, 1, VIEWER);
  c.refit(t);
  assert.equal(c.state().manual, false);
  assert.equal(c.state().phase, 'searching');
  const st = c.update(VIEWER, t + 700);
  assert.equal(st.pose.fits, true);
});
