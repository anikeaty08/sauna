import * as THREE from 'three';
import { nameOf } from './names.js';
import { tag, box } from './mesh.js';

// Compact fixture builders for the curved shapes (round, barrel). The
// rectangular cabin keeps its own richer inline versions in cabin.js; these
// take explicit positions/orientations so a caller can place them anywhere
// inside a circular cross-section without the cabin's X0/X1/ZB/ZF assumptions.
//
// Every builder returns an array of meshes already tagged for hover/click.

/**
 * Orientation basis for a wall-mounted fixture whose `dir` points INTO the
 * room. Every builder below lays its parts out at positive local Z meaning
 * "proud of the wall", so local +Z has to end up along `dir`.
 *
 * Matrix4.lookAt puts local +Z along (eye - target), so the target is -dir.
 * Aiming it at +dir instead - as this did - flips every fixture around and
 * buries it in the wall; on the curved shells that pushed the lamp shade
 * ~90 mm out through the staves.
 */
const faceInto = dir => new THREE.Matrix4().lookAt(
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(-dir.x, 0, -dir.z), new THREE.Vector3(0, 1, 0));

/** Wall lamp with a slatted aspen shade. `dir` is the unit vector from the lamp INTO the room. */
export function wallLamp(materials, spec, sku, lang, pos, dir, group) {
  const parts = [];
  const espe = materials.wood('espe');
  const basis = faceInto(dir);
  const place = (m, off) => { m.position.set(off.x, off.y, off.z).applyMatrix4(basis).add(pos); m.quaternion.setFromRotationMatrix(basis); return m; };
  parts.push(place(new THREE.Mesh(box(0.235, 0.315, 0.026), espe), new THREE.Vector3(0, 0, 0.013)));
  parts.push(place(new THREE.Mesh(box(0.19, 0.25, 0.05), materials.opal), new THREE.Vector3(0, 0, 0.055)));
  for (let i = 0; i < 7; i++) parts.push(place(new THREE.Mesh(box(0.022, 0.30, 0.012), espe), new THREE.Vector3(-0.105 + i * 0.035, 0, 0.104)));
  const light = new THREE.PointLight(0xffb066, 7, 2.6, 2);
  light.position.copy(pos).add(new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(0.12));
  group.add(light);
  for (const m of parts) tag(m, 'lighting', sku, nameOf(spec, lang), spec.price, spec.dims_mm);
  return parts;
}

/** Warm LED strip along a straight run: from `a` to `b` (world), emissive bar + point light. */
export function ledStrip(materials, spec, sku, lang, a, b, group, colour = 'warm') {
  const len = a.distanceTo(b);
  const strip = new THREE.Mesh(box(len, 0.004, 0.012), colour === 'rgb' ? materials.ledRgb : materials.ledWarm);
  strip.position.copy(a).lerp(b, 0.5);
  strip.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
  const light = new THREE.PointLight(colour === 'rgb' ? 0xb28cff : 0xffb066, 4.5, 2.2, 2);
  light.position.copy(strip.position).add(new THREE.Vector3(0, 0.12, 0));
  group.add(light);
  tag(strip, 'lighting', sku, nameOf(spec, lang), spec.price, spec.dims_mm);
  return [strip];
}

/** Bucket + ladle set standing on the floor at `pos`. */
export function bucketSet(materials, spec, sku, lang, pos) {
  const r = spec.bucket_l >= 5 ? 0.11 : 0.095;
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.88, 0.20, 24), spec.bucket === 'black' ? materials.black : materials.wood('fichte'));
  bucket.position.set(pos.x, pos.y + 0.10, pos.z);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(r, 0.005, 8, 24, Math.PI), materials.steel);
  handle.position.set(pos.x, pos.y + 0.20, pos.z);
  const ladle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.42, 10), materials.wood('fichte'));
  ladle.position.set(pos.x - 0.05, pos.y + 0.24, pos.z - 0.03); ladle.rotation.z = 0.5; ladle.rotation.x = 0.3;
  const parts = [bucket, handle, ladle];
  for (const m of parts) tag(m, 'accessory', sku, nameOf(spec, lang), spec.price, spec.dims_mm, { approx: !!spec.approx });
  return parts;
}

/** Wall control unit whose face points along `dir` (unit, horizontal). */
export function controlUnit(materials, spec, sku, lang, pos, dir, benchMat) {
  const [cwMm, cdMm, chMm] = spec.dims_mm;
  const cw = cwMm / 1000, cd = cdMm / 1000, ch = chMm / 1000;
  const isGlass = spec.series === 'glass';
  const body = spec.color === 'white' ? materials.white : spec.color === 'wood' ? benchMat : materials.black;
  const faceMat = isGlass ? (spec.color === 'mirror' ? materials.mirror : spec.color === 'gold' ? materials.gold : materials.black) : body;
  const basis = faceInto(dir);
  const place = (m, off) => { m.position.set(off.x, off.y, off.z).applyMatrix4(basis).add(pos); m.quaternion.setFromRotationMatrix(basis); return m; };
  const unit = place(new THREE.Mesh(box(cw, ch, cd), body), new THREE.Vector3(0, 0, cd / 2));
  const face = place(new THREE.Mesh(box(cw - 0.006, ch - 0.006, 0.002), faceMat), new THREE.Vector3(0, 0, cd + 0.001));
  const screen = place(new THREE.Mesh(box(cw * 0.6, ch * 0.28, 0.002), materials.screen), new THREE.Vector3(0, ch * 0.12, cd + 0.0025));
  const dial = place(new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.006, 20), materials.steel), new THREE.Vector3(0, -ch * 0.25, cd + 0.004));
  dial.rotateX(Math.PI / 2);
  const parts = [unit, face, screen, dial];
  for (const m of parts) tag(m, 'control', sku, nameOf(spec, lang), spec.price, spec.dims_mm, { wifi: !!spec.wifi, series: spec.series || '' });
  return parts;
}

/** Supply/exhaust vent slider flush on a wall at `pos`, face pointing along `dir`. */
export function ventSlider(materials, benchMat, lang, pos, dir, kind) {
  const isDe = lang === 'de';
  const w = kind === 'supply' ? 0.15 : 0.20;
  const basis = faceInto(dir);
  const m = new THREE.Mesh(box(w, 0.10, 0.022), benchMat);
  m.position.set(0, 0, 0.011).applyMatrix4(basis).add(pos);
  m.quaternion.setFromRotationMatrix(basis);
  tag(m, 'cabin', 'VENT', kind === 'supply' ? (isDe ? 'Zuluftschieber (inbegriffen)' : 'Supply air vent (included)') : (isDe ? 'Abluftschieber (inbegriffen)' : 'Exhaust air vent (included)'), 0, [Math.round(w * 1000), 22, 100], { includedIn: 'cabin' });
  return [m];
}

/** Infrared emitter panel flush on a wall at `pos`, face pointing along `dir`. */
export function infraredPanel(materials, spec, sku, lang, pos, dir) {
  const [iwMm, idMm, ihMm] = spec.dims_mm;
  const iw = iwMm / 1000, id = idMm / 1000, ih = ihMm / 1000;
  const glowMat = spec.color === 'red'
    ? materials.plain('irRed', { color: 0x3a0c08, roughness: 0.5, emissive: 0xff3a1a, emissiveIntensity: 1.8 })
    : materials.plain('irBlack', { color: 0x0c0c0d, roughness: 0.35, metalness: 0.3, emissive: 0xb23a1a, emissiveIntensity: 0.9 });
  const basis = faceInto(dir);
  const m = new THREE.Mesh(box(iw, ih, id), glowMat);
  m.position.set(0, 0, id / 2 + 0.006).applyMatrix4(basis).add(pos);
  m.quaternion.setFromRotationMatrix(basis);
  tag(m, 'heater', sku, nameOf(spec, lang), spec.price, spec.dims_mm, { watts: spec.watts });
  return [m];
}

/** Compact electric heater (casing + stones, or cylinder mantle) standing at `pos` with its front along `dir`. */
export function heaterUnit(materials, spec, sku, lang, pos, dir, base = 0) {
  const [hwMm, hdMm, hhMm] = spec.dims_mm;
  const hw = hwMm / 1000, hd = hdMm / 1000, hh = hhMm / 1000;
  const bodyMat = spec.color === 'black' ? materials.black : materials.steel;
  const basis = faceInto(dir);
  const place = (m, off) => { m.position.set(off.x, off.y, off.z).applyMatrix4(basis).add(pos); m.quaternion.setFromRotationMatrix(basis); return m; };
  const parts = [];
  let stonesTop;
  if (spec.shape === 'cylinder') {
    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(hw / 2, hw / 2, hh - 0.02, 40, 1, true), materials.plain('mantle' + spec.color, { color: spec.color === 'black' ? 0x15181b : 0x9aa3a8, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }));
    parts.push(place(mantle, new THREE.Vector3(0, base + 0.02 + (hh - 0.02) / 2, 0)));
    parts.push(place(new THREE.Mesh(new THREE.CylinderGeometry(hw / 2 - 0.03, hw / 2 - 0.03, hh - 0.06, 24), materials.stones), new THREE.Vector3(0, base + hh / 2, 0)));
    parts.push(place(new THREE.Mesh(new THREE.CylinderGeometry(hw / 2 - 0.01, hw / 2 - 0.01, 0.02, 32), materials.black), new THREE.Vector3(0, base + 0.01, 0)));
    stonesTop = base + hh;
  } else {
    parts.push(place(new THREE.Mesh(box(hw, hh, hd), bodyMat), new THREE.Vector3(0, base + hh / 2, 0)));
    parts.push(place(new THREE.Mesh(box(hw * 0.86, hh * 0.66, 0.008), materials.darkGrille), new THREE.Vector3(0, base + hh * 0.42, hd / 2 + 0.004)));
    parts.push(place(new THREE.Mesh(box(hw - 0.015, 0.014, hd - 0.015), materials.black), new THREE.Vector3(0, base + hh + 0.007, 0)));
    stonesTop = base + hh + 0.014;
  }
  // stones
  let seed = 49;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const stoneGeom = new THREE.IcosahedronGeometry(0.034, 1);
  const sx = hw - 0.06, sz = (spec.shape === 'cylinder' ? hw : hd) - 0.06;
  const cols = Math.max(2, Math.floor(sx / 0.066)), rows = Math.max(2, Math.floor(sz / 0.07));
  for (let rI = 0; rI < rows; rI++) for (let c = 0; c < cols; c++) {
    const stone = new THREE.Mesh(stoneGeom, materials.stones);
    const off = new THREE.Vector3(-sx / 2 + (c + 0.5) * sx / cols + (rnd() - 0.5) * 0.012, stonesTop + 0.03 + rnd() * 0.02, -sz / 2 + (rI + 0.5) * sz / rows + (rnd() - 0.5) * 0.012);
    place(stone, off);
    stone.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    stone.scale.set(0.9 + rnd() * 0.3, 0.8 + rnd() * 0.3, 0.9 + rnd() * 0.3);
    parts.push(stone);
  }
  if (spec.control === 'integrated') {
    parts.push(place(new THREE.Mesh(box(0.032, 0.14, Math.min(0.157, hd * 0.7)), materials.black), new THREE.Vector3(-(hw / 2 + 0.016), base + 0.12, 0)));
  }
  for (const m of parts) tag(m, 'heater', sku, nameOf(spec, lang), spec.price, spec.dims_mm, { kw: spec.kw, control: spec.control, mount: spec.mount, approx: !!spec.approx });
  return { parts, stonesTop: stonesTop + 0.08, hw, hd, hh };
}

/** Two-rail backrest along a straight run from `a` to `b` at height `y`, offset into the room by `dir`. */
export function backrestRun(benchMat, lang, a, b, y, dir) {
  const isDe = lang === 'de';
  const len = a.distanceTo(b);
  const rot = Math.atan2(-(b.z - a.z), b.x - a.x);
  const mid = a.clone().lerp(b, 0.5);
  const parts = [];
  for (const yy of [y, y + 0.13]) {
    const s = new THREE.Mesh(box(len, 0.095, 0.027, 1, 'x'), benchMat);
    s.position.copy(mid).add(new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(0.045 + 0.0135)); s.position.y = yy + 0.0475;
    s.rotation.y = rot;
    parts.push(s);
  }
  for (const t of [0.06 / len, 1 - 0.06 / len]) {
    const st = new THREE.Mesh(box(0.045, 0.265, 0.045), benchMat);
    st.position.copy(a).lerp(b, t).add(new THREE.Vector3(dir.x, 0, dir.z).multiplyScalar(0.0225)); st.position.y = y + 0.11;
    st.rotation.y = rot;
    parts.push(st);
  }
  for (const m of parts) tag(m, 'interior', 'BACKREST', isDe ? 'Rückenlehne (inbegriffen)' : 'Backrest (included)', 0, [Math.round(len * 1000), 220, 27], { includedIn: 'cabin' });
  return parts;
}
