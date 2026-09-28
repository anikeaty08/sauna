// Unit tests for the automatic-placement planner, against synthetic rooms.
//   node --test tests/fit-planner.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OccupancyGrid, planPlacement, gridFromRoom, footprintOutline, evaluatePose, footprintSamples,
} from '../app/client/sauna/ar/fitPlanner.js';

// A 2.0 x 1.8 m cabin whose 0.7 m door swings out of the front, left of centre.
const SAUNA = { width: 2.0, depth: 1.8, margin: 0.05, swing: { width: 0.7, depth: 0.7, offsetX: -0.4 } };

/** Floor seen over a rectangle (x0..x1, z0..z1). */
function floor(grid, x0, x1, z0, z1) {
  for (let x = x0 + 0.05; x < x1; x += 0.1) for (let z = z0 + 0.05; z < z1; z += 0.1) grid.addFloor(x, z);
}
/** Something standing on the floor over a rectangle (two hits = certain). */
function block(grid, x0, x1, z0, z1) {
  for (let x = x0 + 0.05; x < x1; x += 0.1) for (let z = z0 + 0.05; z < z1; z += 0.1) { grid.addBlocked(x, z); grid.addBlocked(x, z); }
}
const entranceDir = rot => [Math.sin(rot), Math.cos(rot)];
const inside = (pts, x0, x1, z0, z1) => pts.every(([x, z]) => x >= x0 - 1e-6 && x <= x1 + 1e-6 && z >= z0 - 1e-6 && z <= z1 + 1e-6);

test('open floor: places in front of the viewer, entrance facing them', () => {
  const g = new OccupancyGrid();
  floor(g, -3, 3, 0, 6);
  const viewer = { x: 0, z: 0, yaw: 0 };                     // looking along +z
  const p = planPlacement(g, SAUNA, { viewer });
  assert.equal(p.fits, true);
  const d = Math.hypot(p.x, p.z);
  assert.ok(d >= 1.5 && d <= 3.5, `distance ${d.toFixed(2)} should be comfortable`);
  const [ex, ez] = entranceDir(p.rot);
  const [tx, tz] = [(0 - p.x) / d, (0 - p.z) / d];
  assert.ok(ex * tx + ez * tz > 0.9, 'entrance should face the viewer');
});

test('backs onto a wall and squares up to it', () => {
  const g = new OccupancyGrid();
  floor(g, -3, 3, 0, 4);
  block(g, -3, 3, 4, 4.3);                                  // wall across the far side
  const p = planPlacement(g, SAUNA, { viewer: { x: 0, z: 0, yaw: 0 } });
  assert.equal(p.fits, true);
  assert.ok(p.wallFrac > 0.5, `should back onto the wall (wallFrac ${p.wallFrac.toFixed(2)})`);
  const [ex, ez] = entranceDir(p.rot);
  assert.ok(ez < -0.95, 'entrance should point back toward the viewer, square to the wall');
});

test('avoids a sofa in the way', () => {
  const g = new OccupancyGrid();
  floor(g, -3, 3, 0, 5);
  block(g, -1.2, 1.2, 2.0, 2.9);                            // sofa right where it would go
  const p = planPlacement(g, SAUNA, { viewer: { x: 0, z: 0, yaw: 0 } });
  assert.equal(p.fits, true);
  const ev = evaluatePose(g, footprintSamples(SAUNA, 0.1), p);
  assert.equal(ev.blocked, 0, 'no part of the footprint or door swing may overlap the sofa');
});

test('door swing is part of the footprint: fits the body but not the swing -> no fit', () => {
  // 2.3 x 2.2 m alcove: the 2.0 x 1.8 body fits, but body + 0.7 m swing does not
  // in either orientation.
  const withSwing = planPlacement(gridFromRoom(2.3, 2.2), SAUNA, { face: { x: 1.15, z: 1.1 } });
  assert.equal(withSwing.fits, false);
  const noSwing = planPlacement(gridFromRoom(2.3, 2.2), { ...SAUNA, swing: null }, { face: { x: 1.15, z: 1.1 } });
  assert.equal(noSwing.fits, true, 'without the door swing the body alone should fit');
});

test('room too small: reports no fit with a reason', () => {
  const p = planPlacement(gridFromRoom(1.5, 1.5), SAUNA, { face: { x: 0.75, z: 0.75 } });
  assert.equal(p.fits, false);
  assert.ok(['obstacles', 'not-enough-seen'].includes(p.reason));
});

test('only half the floor seen yet: waits rather than claiming a fit', () => {
  const g = new OccupancyGrid();
  floor(g, -0.6, 0.6, 0, 5);                                // a narrow strip only
  const p = planPlacement(g, SAUNA, { viewer: { x: 0, z: 0, yaw: 0 } });
  assert.equal(p.fits, false);
  assert.equal(p.reason, 'not-enough-seen');
});

test('room check: auto-places inside the room, against a wall, door into the room', () => {
  const W = 4, D = 3.5;
  const p = planPlacement(gridFromRoom(W, D), SAUNA, { face: { x: W / 2, z: D / 2 } });
  assert.equal(p.fits, true);
  const o = footprintOutline(SAUNA, p);
  assert.ok(inside(o.body, 0, W, 0, D), 'body inside the room');
  assert.ok(inside(o.swing, 0, W, 0, D), 'door swing inside the room');
  assert.ok(p.wallFrac > 0.5, 'backs onto a wall');
  const [ex, ez] = entranceDir(p.rot);
  const [cx, cz] = [W / 2 - p.x, D / 2 - p.z];
  assert.ok(ex * cx + ez * cz > 0, 'door opens into the room, not into a wall');
});
