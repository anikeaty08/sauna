import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zirbe6eck, computeLayout, defaultConfiguration, normalizeConfiguration, validateConfiguration,
  priceConfiguration, dirtyGroups,
} from '../../packages/configuration-core/index.ts';
import { insidePolygon, distanceToBoundary } from '../../packages/configuration-core/geometry/planMath.ts';

const model = zirbe6eck;
const cfg = (w: number, d: number, extra = {}) => ({ ...defaultConfiguration(model), dimensions: { widthCm: w, depthCm: d }, ...extra });

test('reference drawing proportions are reproduced (2300 x 3160 outline)', () => {
  const L = computeLayout(model, cfg(230, 316));
  const byId = Object.fromEntries(L.segments.map(s => [s.id, s]));
  assert.equal(byId.back.length, 2.3);
  assert.equal(byId.left.length, 3.16);
  assert.equal(byId.top.length, 1.17);
  assert.ok(Math.abs(byId.right.length - 1.458) <= 0.005, `right ${byId.right.length}`);
  assert.equal(byId.control.length, 0.4);
  assert.ok(Math.abs(byId.diagonal.length - 1.209) < 0.01, `diagonal ${byId.diagonal.length}`);
});

test('outline is counter-clockwise with inward normals pointing inside', () => {
  const L = computeLayout(model, cfg(230, 250));
  for (const s of L.segments) {
    const mid: [number, number] = [(s.a[0] + s.b[0]) / 2 + s.inward[0] * 0.05, (s.a[1] + s.b[1]) / 2 + s.inward[1] * 0.05];
    assert.ok(insidePolygon(L.outline, mid), `${s.id} inward normal points outside`);
  }
});

test('every published size is valid, the door fits and every module stays inside', () => {
  for (const w of model.dimensions.widthCm.options) for (const d of model.dimensions.depthCm.options) {
    for (const heaterSet of model.options.heaterSet.map(h => h.id)) {
      const c = cfg(w, d, { heaterSet, accessories: ['nova-set-4', 'led-5m'] });
      const L = computeLayout(model, c);
      const errors = L.issues.filter(i => i.level === 'error');
      assert.deepEqual(errors, [], `${w}x${d} ${heaterSet}: ${errors.map(e => e.message).join('; ')}`);
      assert.ok(L.door.fixedPane[1] - L.door.fixedPane[0] >= 0.15, `${w}x${d}: fixed pane too narrow`);
      for (const p of L.placements) {
        if (p.key === 'control') continue; // mounted on the outside of the control segment
        assert.ok(insidePolygon(L.outline, p.position) && distanceToBoundary(L.outline, p.position) >= L.wall - 0.001, `${w}x${d}: ${p.key} at ${p.position} outside`);
      }
    }
  }
});

test('normalize snaps stale input onto real options', () => {
  const n = normalizeConfiguration(model, { dimensions: { widthCm: 233, depthCm: 999 }, heaterSet: 'bogus', accessories: ['led-5m', 'led-5m', 'x'] });
  assert.equal(n.dimensions.widthCm, 230);
  assert.equal(n.dimensions.depthCm, 250);
  assert.equal(n.heaterSet, 'eos-mythos-s35');
  assert.deepEqual(n.accessories, ['led-5m']);
  assert.equal(validateConfiguration(model, n).valid, true);
});

test('validation rejects unknown options', () => {
  const bad = { ...defaultConfiguration(model), heaterSet: 'nope' };
  const r = validateConfiguration(model, bad);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some(i => i.path === 'heaterSet'));
});

test('pricing matches holzsauna.ch (base + width + depth + options)', () => {
  const base = priceConfiguration(model, { ...cfg(150, 150), heaterSet: 'none' });
  assert.equal(base.total, 19990);
  const p = priceConfiguration(model, { ...cfg(230, 200), heaterSet: 'harvia-virta-combi-9', accessories: ['led-5m', 'nova-set-4'] });
  assert.equal(p.total, 19990 + 1181 + 560 + 3115 + 299 + 229);
  assert.equal(p.onRequest, false);
  assert.equal(priceConfiguration(model, { ...cfg(150, 150), materials: { benchWood: 'erle' } }).onRequest, true);
});

test('dependency graph rebuilds only what a change touches', () => {
  const a = defaultConfiguration(model);
  assert.deepEqual([...dirtyGroups(a, { ...a, materials: { benchWood: 'erle' } })], ['materials']);
  assert.ok(dirtyGroups(a, { ...a, dimensions: { ...a.dimensions, widthCm: 200 } }).has('structure'));
  assert.ok(!dirtyGroups(a, { ...a, heaterSet: 'none' }).has('structure'));
});
