import * as THREE from 'three';
import { nameOf } from './names.js';
import { tag, box } from './mesh.js';
import { doorHandleMaterials } from './materials.js';
import { wallLamp, ledStrip, bucketSet, controlUnit, ventSlider } from './fixtures.js';

/**
 * Barrel sauna (Saunafass): a horizontal cylinder, axis along X (=width in the
 * catalog), diameter = depth. This is a pilot geometry - round staves are
 * approximated as a smooth shell, and the door sits on the flat front cap
 * rather than following the curve, which real barrel doors do.
 */
/**
 * One cradle bracket: flat on the ground, with a circular bite out of the top
 * that the barrel sits in. Built in the tube's YZ cross-section (local origin
 * at the circle centre, so the ground is at local y = -centreHeight) and
 * rotated so local X -> world Z and local Y -> world Y, with the extrusion
 * running along the tube axis.
 *
 * Modelled as one solid bracket rather than a thin arc band plus separate
 * feet: the band hid under the barrel and left the feet reading as loose
 * blocks on the ground.
 */
function cradleBracket(radius, centreHeight, halfAngle, thickness) {
  const a0 = Math.PI + halfAngle, a1 = 2 * Math.PI - halfAngle;  // through straight-down
  const x0 = Math.cos(a0) * radius, y0 = Math.sin(a0) * radius;
  const x1 = Math.cos(a1) * radius, y1 = Math.sin(a1) * radius;
  const ground = -centreHeight;
  const shape = new THREE.Shape();
  shape.moveTo(x1, y1);
  shape.lineTo(x1, ground);
  shape.lineTo(x0, ground);
  shape.lineTo(x0, y0);
  shape.absarc(0, 0, radius, a0, a1, false);   // the seat the barrel rests in
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 48 });
  g.rotateY(-Math.PI / 2);
  return g;
}

export function buildBarrelSauna(cfg, catalog, materials, lang) {
  const itemTitle = spec => nameOf(spec, lang);
  const isDe = lang === 'de';
  const group = new THREE.Group();
  const registry = [];
  const push = mesh => { if (mesh.userData.info) registry.push(mesh); group.add(mesh); return mesh; };
  const mm = v => Math.round(v * 1000);

  const family = catalog.families[cfg.family];
  const length = cfg.widthCm / 100, radius = cfg.depthCm / 200, wallT = family.wall_mm / 1000;
  // Double-sided: the shell and caps are seen from outside (exterior view) and
  // from inside (interior view) - a single-sided material culls whichever
  // side its normal doesn't face, which previously made the end caps and
  // inner shell disappear entirely from some camera angles.
  const wallMat = materials.wood(family.wall_wood, true, true);
  const benchSpec = catalog.interiors[cfg.interior.material];
  const benchMat = materials.wood(benchSpec.wood, false);
  // The barrel is lifted so its cradles, which wrap OUTSIDE the shell, have
  // somewhere to go - resting the tube straight on the ground pushed them
  // below it. Real barrel saunas stand on cradles exactly this way.
  const standH = 0.12;
  const cy = radius + standH;
  // Height of the walk-in deck, measured up from the inside of the tube (not
  // from the ground, which now sits `standH` lower). Kept low: every cm of
  // deck is a cm of headroom lost, and a 2.05 m tube has little to spare.
  const floorY = (cy - radius) + radius * 0.22;

  // Individual staves rather than one smooth cylinder. A Saunafass is built
  // from solid planks clamped by steel bands, and that plank line is what
  // makes it read as a barrel at all - a smooth tube just looks like a drum.
  // Verified against a Blender reference build before porting.
  //
  // Each plank's THICKNESS must point along the radius. box() gives dims
  // (x,y,z), so thickness sits on local Y; rotating about X by (PI/2 - a)
  // maps local Y onto the radius and local Z onto the tangent. Rotating by
  // `a` instead lays the planks edge-on and leaves the shell as open fins.
  const staveCount = Math.max(18, Math.round((Math.PI * 2 * radius) / 0.22));
  const staveW = (Math.PI * 2 * (radius - wallT / 2)) / staveCount * 0.94;
  const staveR = radius - wallT / 2;
  for (let i = 0; i < staveCount; i++) {
    const a = (i + 0.5) * (Math.PI * 2 / staveCount);
    const stave = new THREE.Mesh(box(length, wallT, staveW, 1, 'x'), wallMat);
    stave.position.set(length / 2, cy + Math.sin(a) * staveR, radius + Math.cos(a) * staveR);
    stave.rotation.x = Math.PI / 2 - a;
    push(tag(stave, 'cabin', family.sku, `${itemTitle(catalog.woods[family.wall_wood])} ${isDe ? 'Fassdaube' : 'barrel stave'}, ${family.wall_mm} mm`, 0, [mm(length), mm(staveW), family.wall_mm], { includedIn: 'cabin' }));
  }

  // Round rear window (holzsauna.ch: "Rundes Rueckwandfenster", solid /
  // half-height / full-height - a genuine priced option, not decorative).
  // Cut from the back cap the same way the front door opening is cut from the
  // front cap: a THREE.Path hole in the cap's Shape.
  const winKind = cfg.window && cfg.window !== 'none' ? cfg.window : null;
  const backShape = new THREE.Shape();
  backShape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  let winHole = null;
  if (winKind) {
    const winR = Math.min(radius * (winKind === 'round_full' ? 0.62 : 0.42), radius - wallT * 2.4);
    const winCy = winKind === 'round_full' ? 0 : -radius + winR + wallT * 1.5;
    winHole = new THREE.Path();
    winHole.absarc(0, winCy, winR, 0, Math.PI * 2, false);
    backShape.holes.push(winHole);
  }
  const backCap = new THREE.Mesh(new THREE.ShapeGeometry(backShape, 40), wallMat);
  backCap.rotation.y = -Math.PI / 2;
  backCap.position.set(0.01, cy, radius);
  push(tag(backCap, 'cabin', family.sku, isDe ? 'Rueckwand' : 'Back cap', 0, [mm(radius * 2), mm(radius * 2), family.wall_mm], { includedIn: 'cabin' }));

  if (winKind) {
    const winSpec = catalog.window_types?.[winKind];
    const winR = Math.min(radius * (winKind === 'round_full' ? 0.62 : 0.42), radius - wallT * 2.4);
    const winCy = winKind === 'round_full' ? 0 : -radius + winR + wallT * 1.5;
    const glassMat = materials.plain('barrelWindow', { color: 0xdfeee8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, side: THREE.DoubleSide });
    const pane = new THREE.Mesh(new THREE.CircleGeometry(winR, 40), glassMat);
    pane.rotation.y = -Math.PI / 2;
    pane.position.set(0.012, cy + winCy, radius);
    const ring = new THREE.Mesh(new THREE.RingGeometry(winR, winR + 0.03, 40), materials.black);
    ring.rotation.y = -Math.PI / 2;
    ring.position.set(0.011, cy + winCy, radius);
    for (const m of [pane, ring]) push(tag(m, 'cabin', family.sku, winSpec ? itemTitle(winSpec) : (isDe ? 'Rundfenster' : 'Round window'), 0, [mm(winR * 2), mm(winR * 2), 20], { includedIn: 'cabin' }));
  }

  const doorW = family.door_mm[0] / 1000;
  const hy0 = -radius + floorY;
  // The opening is cut out of a CIRCULAR end cap, so both top corners must stay
  // inside the circle. Once the door was raised onto the deck, a catalog height
  // of 1.8 m pushed them past the rim - and a THREE.Path hole that escapes its
  // Shape triangulates to nothing, taking the whole cap and door with it. Clamp
  // the height to what the circle can actually accommodate at this width.
  const doorTopMax = Math.sqrt(Math.max(0.01, radius * radius - (doorW / 2) * (doorW / 2))) - 0.03;
  const doorH = Math.min(family.door_mm[1] / 1000, doorTopMax - hy0);
  const frontShape = new THREE.Shape();
  frontShape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  const hx0 = -doorW / 2, hx1 = doorW / 2, hy1 = hy0 + doorH;
  hole.moveTo(hx0, hy0); hole.lineTo(hx1, hy0); hole.lineTo(hx1, hy1); hole.lineTo(hx0, hy1); hole.closePath();
  frontShape.holes.push(hole);
  const frontCap = new THREE.Mesh(new THREE.ShapeGeometry(frontShape, 32), wallMat);
  frontCap.rotation.y = Math.PI / 2;
  frontCap.position.set(length - 0.01, cy, radius);
  push(tag(frontCap, 'cabin', family.sku, isDe ? 'Frontwand mit Tuer' : 'Front cap with door', 0, [mm(radius * 2), mm(radius * 2), family.wall_mm], { includedIn: 'cabin' }));

  const doorGlassSpec = catalog.door_glass?.[cfg.door.glass] || catalog.door_glass?.clear;
  const doorMat = cfg.door.glass === 'wood_window' ? materials.wood('fichte') : materials.plain('barrelGlass' + cfg.door.glass, { color: new THREE.Color(...(doorGlassSpec?.tint || [0.87, 0.93, 0.91])), roughness: 0.08, transparent: true, opacity: doorGlassSpec?.opacity ?? 0.3, side: THREE.DoubleSide });
  const sign = cfg.door.hinge === 'right' ? -1 : 1;   // which edge the door is hinged on
  const doorRoot = new THREE.Group();
  doorRoot.position.set(length - wallT - 0.005, cy + hy0 + doorH / 2, radius + (sign > 0 ? hx0 : hx1));
  const leafParts = [];
  // Thin axis on X (the leaf faces out through the end cap), height on Y, width
  // on Z running hinge -> free edge. Building it rotated instead - rotation.x
  // AND rotation.z both at 90 deg - composes under Euler XYZ to a leaf lying
  // flat like a table top, floating inside the cabin.
  const leaf = new THREE.Mesh(box(0.008, doorH, doorW - 0.01), doorMat);
  leaf.position.set(0, 0, sign * (doorW - 0.01) / 2);
  leafParts.push(leaf);
  // Handle: inside grip (-X, into the barrel) and outside grip (+X) near the free edge,
  // materials from the selected catalog handle option.
  const handle = doorHandleMaterials(cfg, catalog, materials, benchMat);
  const handleZ = sign * (doorW - 0.09);
  const handleIn = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 12), handle.inside);
  handleIn.rotation.x = Math.PI / 2; handleIn.position.set(-0.05, 0, handleZ);
  const handleOut = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 12), handle.outside);
  handleOut.rotation.x = Math.PI / 2; handleOut.position.set(0.05, 0, handleZ);
  leafParts.push(handleIn, handleOut);
  for (const y of [-0.09, 0.09]) {
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.11, 10), handle.mountMat);
    mount.position.set(0, y, handleZ);
    leafParts.push(mount);
  }
  const doorName = `${isDe ? 'Fasstuer' : 'Barrel door'}, ${itemTitle(doorGlassSpec)}, ${isDe ? (cfg.door.hinge === 'right' ? 'Anschlag rechts' : 'Anschlag links') : `hinged ${cfg.door.hinge}`}, ${itemTitle(handle.spec)}`;
  // tag() + registry.push() directly, NOT the push() helper: push() also
  // calls group.add(), which would re-parent these off doorRoot (an Object3D
  // can only have one parent) right after doorRoot.add() just set it.
  for (const m of leafParts) { doorRoot.add(m); tag(m, 'door', family.sku, doorName, 0, [family.door_mm[0], 8, mm(doorH)], { includedIn: 'cabin', hinge: cfg.door.hinge }); registry.push(m); }
  group.add(doorRoot);

  // ---- interior: walk-in deck + two facing slatted benches -----------------
  // The tube's cross-section is a circle centred at (y=cy, z=radius), so the
  // usable width closes to nothing at the very bottom. Everything inside is
  // placed against this half-width rather than against a rectangular box.
  const rIn = radius - wallT;
  const halfWidthAt = y => Math.sqrt(Math.max(0, rIn * rIn - (y - cy) * (y - cy)));
  const slatT = 0.035, slatGap = 0.012;
  const ivars = cfg.interior;
  const xPad = 0.06;
  const deckX0 = wallT + xPad, deckX1 = length - wallT - xPad;

  // Walk-in deck: a flat duckboard floor low in the barrel.
  const deckHalf = halfWidthAt(floorY) - 0.015;
  const deckParts = [];
  {
    // The bearers hang 60 mm below the deck, where the tube is narrower than
    // at deck level, so size them against the half-width at their own underside.
    const bearerH = 0.06;
    const bearerZ = Math.min(deckHalf - 0.08, halfWidthAt(floorY - bearerH) - 0.045);
    for (const s of [-1, 1]) {
      const bearer = new THREE.Mesh(box(deckX1 - deckX0, bearerH, 0.06, 1, 'x'), benchMat);
      bearer.position.set((deckX0 + deckX1) / 2, floorY - bearerH / 2, radius + s * bearerZ);
      deckParts.push(bearer);
    }
    const n = Math.max(4, Math.round((deckX1 - deckX0) / 0.085));
    const pitch = (deckX1 - deckX0) / n;
    for (let i = 0; i < n; i++) {
      const slat = new THREE.Mesh(box(pitch - slatGap, 0.028, deckHalf * 2, 1, 'x'), benchMat);
      slat.position.set(deckX0 + (i + 0.5) * pitch, floorY + 0.014, radius);
      deckParts.push(slat);
    }
  }
  for (const m of deckParts)
    push(tag(m, 'interior', 'FLOOR-GRATE', isDe ? 'Bodenrost (inbegriffen)' : 'Floor decking (included)', 0, [mm(deckX1 - deckX0), mm(deckHalf * 2), 40], { includedIn: 'cabin' }));

  // Two benches facing each other down the length of the tube.
  const benchY = Math.max(floorY + 0.30, cy * 0.62);
  const benchHalf = Math.min(halfWidthAt(benchY), halfWidthAt(benchY - slatT)) - 0.015;
  const benchDepth = Math.min((ivars.upperDepthCm ?? 55) / 100, Math.max(0.28, benchHalf - 0.30));
  const benchInner = benchHalf - benchDepth;
  for (const s of [-1, 1]) {
    const parts = [];
    const n = Math.max(3, Math.round(benchDepth / 0.11));
    const pitch = benchDepth / n;
    for (let i = 0; i < n; i++) {
      const w = pitch - slatGap;
      const slat = new THREE.Mesh(box(deckX1 - deckX0, slatT, w, 1, 'x'), benchMat);
      slat.position.set((deckX0 + deckX1) / 2, benchY - slatT / 2, radius + s * (benchInner + (i + 0.5) * pitch));
      parts.push(slat);
    }
    // Legs down to the deck. Their feet land at deck level, where the tube is
    // far narrower than at seat height, so keep the whole foot inside the deck
    // rather than centring them under the bench.
    const legDepth = benchDepth * 0.55;
    const legZ = Math.min(benchInner + benchDepth * 0.45, deckHalf - 0.015 - legDepth / 2);
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Mesh(box(0.07, benchY - slatT - floorY, legDepth), benchMat);
      leg.position.set(deckX0 + (i + 0.5) * (deckX1 - deckX0) / 3, floorY + (benchY - slatT - floorY) / 2, radius + s * legZ);
      parts.push(leg);
    }
    for (const m of parts)
      push(tag(m, 'interior', cfg.interior.material, `${isDe ? 'Liege' : 'Bench'}, ${itemTitle(benchSpec)}`, s > 0 ? benchSpec.price : 0, [mm(deckX1 - deckX0), mm(benchDepth), 35], s > 0 ? {} : { includedIn: 'cabin' }));

    // Backrest slats climbing the curve above each bench.
    if (ivars.backrests) {
      for (let i = 0; i < 3; i++) {
        const y = benchY + 0.20 + i * 0.16;
        const hw = halfWidthAt(y);
        if (!hw || y > cy + rIn - 0.25) break;
        const rail = new THREE.Mesh(box(deckX1 - deckX0, 0.11, 0.028, 1, 'x'), benchMat);
        rail.position.set((deckX0 + deckX1) / 2, y, radius + s * (hw - 0.03));
        rail.rotation.x = -s * Math.asin(Math.min(1, (y - cy) / rIn));
        push(tag(rail, 'interior', 'BACKREST', isDe ? 'Rückenlehne (inbegriffen)' : 'Backrest (included)', 0, [mm(deckX1 - deckX0), 30, 110], { includedIn: 'cabin' }));
      }
    }
  }

  const heaterSpec = catalog.heaters[cfg.heater.sku];
  let heaterInfo = null;
  if (heaterSpec) {
    const [hwMm, , hhMm] = heaterSpec.dims_mm;
    const hw = hwMm / 1000, hh = hhMm / 1000;
    const bodyMat = heaterSpec.color === 'black' ? materials.black : materials.steel;
    // Stand the heater on the deck at the door end, tucked against one bench.
    // Sitting it at y=0 put its base where the tube has no width at all, so it
    // hung out through the staves.
    const hx = deckX0 + hw / 2 + 0.10;
    const hz = radius;   // walkway centreline, clear of both benches
    const casing = new THREE.Mesh(box(hw, hh, hw * 0.8), bodyMat);
    casing.position.set(hx, floorY + hh / 2, hz);
    const stones = new THREE.Mesh(new THREE.CylinderGeometry(hw * 0.4, hw * 0.4, 0.05, 16), materials.stones);
    stones.position.set(hx, floorY + hh + 0.03, hz);
    for (const m of [casing, stones]) push(tag(m, 'heater', cfg.heater.sku, itemTitle(heaterSpec), heaterSpec.price, heaterSpec.dims_mm, { kw: heaterSpec.kw, control: heaterSpec.control, mount: heaterSpec.mount, approx: true }));
    heaterInfo = { cx: hx, cz: hz, hz0: hz, hz1: hz, base: floorY, hh, atBack: false };
    if (heaterSpec.wood_fired && cfg.chimney && catalog.chimneys?.[cfg.chimney]) {
      const chimneySpec = catalog.chimneys[cfg.chimney];
      const flueParts = [];
      const shellTop = radius * 2;
      if (cfg.chimney === 'CHIMNEY-AUSSEN-130') {
        const flueTop = shellTop + 0.55;
        const vertical = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, flueTop, 20), materials.black);
        vertical.position.set(hx, flueTop / 2, radius * 2 - wallT + 0.09);
        flueParts.push(vertical);
        const elbow = new THREE.Mesh(box(0.15, 0.13, 0.15), materials.black);
        elbow.position.set(hx, floorY + 0.07, radius * 2 - wallT / 2);
        flueParts.push(elbow);
      } else {
        const flueTop = shellTop + 0.4;
        const base = floorY + hh;
        const vertical = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, flueTop - base, 24), materials.black);
        vertical.position.set(hx, base + (flueTop - base) / 2, hz);
        flueParts.push(vertical);
      }
      for (const p of flueParts) push(tag(p, 'heater', cfg.chimney, itemTitle(chimneySpec), chimneySpec.price, chimneySpec.dims_mm, { includedIn: 'heater' }));
    }
  }

  // ---- cradles, tension bands and door trim ------------------------------
  // What makes a barrel sauna read as one from outside: it sits in curved
  // cradle saddles rather than resting on its own curve, and steel bands
  // clamp the staves. Without these it is just a drum lying on the ground.
  {
    const deg = d => (d * Math.PI) / 180;
    const cradleT = 0.10;
    for (const cxPos of [length * 0.18, length * 0.82]) {
      const saddle = new THREE.Mesh(cradleBracket(radius, cy, deg(35), cradleT), wallMat);
      saddle.position.set(cxPos - cradleT / 2, cy, radius);
      push(tag(saddle, 'cabin', family.sku, isDe ? 'Wiege (inbegriffen)' : 'Cradle support (included)', 0, [mm(cradleT), mm(radius * 1.64), mm(cy)], { includedIn: 'cabin' }));
    }

    for (const bx of [length * 0.16, length * 0.5, length * 0.84]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.012, 0.016, 8, 56), materials.steel);
      band.rotation.y = Math.PI / 2;               // ring plane -> the tube's YZ cross-section
      band.position.set(bx, cy, radius);
      push(tag(band, 'cabin', family.sku, isDe ? 'Spannband Edelstahl' : 'Stainless tension band', 0, [20, mm(radius * 2), 32], { includedIn: 'cabin' }));
    }

    // Trim framing the doorway on the front cap.
    const trimT = 0.035, frameX = length - 0.012;
    for (const [w, h, dy, dz] of [
      [trimT, doorH + trimT * 2, doorH / 2 + trimT / 2 - doorH / 2, -(doorW / 2 + trimT / 2)],
      [trimT, doorH + trimT * 2, 0, doorW / 2 + trimT / 2],
      [trimT, trimT, doorH / 2 + trimT / 2, 0],
      [trimT, trimT, -(doorH / 2 + trimT / 2), 0],
    ]) {
      const horizontal = h === trimT;
      const piece = new THREE.Mesh(
        box(w, horizontal ? trimT : doorH + trimT * 2, horizontal ? doorW + trimT * 2 : trimT), wallMat);
      piece.position.set(frameX, cy + hy0 + doorH / 2 + dy, radius + dz);
      push(tag(piece, 'cabin', family.sku, isDe ? 'Tuerzarge' : 'Door surround', 0, [mm(doorW), mm(doorH), mm(trimT)], { includedIn: 'cabin' }));
    }
  }

  if (cfg.accessories.includes('TERRACE-70')) {
    const terrace = new THREE.Mesh(box(length, 0.05, 0.7), materials.wood('fichte', true));
    terrace.position.set(length / 2, -0.025, radius * 2 + 0.35);
    push(tag(terrace, 'accessory', 'TERRACE-70', isDe ? 'Terrasse 70 cm' : '70 cm terrace', 0, [mm(length), 700, 50], { includedIn: 'cabin' }));
  }

  for (const sku of (cfg.lighting || [])) {
    const spec = catalog.lighting[sku];
    if (!spec) continue;
    if (spec.kind === 'wall_lamp') {
      // Lamp on inner upper shell, centered along length, offset to one side
      const lampY = cy + radius * 0.35;
      const lampReach = Math.min(halfWidthAt(lampY - 0.17), halfWidthAt(lampY + 0.17));
      const lampPos = new THREE.Vector3(length / 2 + 0.3, lampY, radius + lampReach - 0.02);
      const lampDir = new THREE.Vector3(0, -0.5, -1).normalize();
      for (const m of wallLamp(materials, spec, sku, lang, lampPos, lampDir, group)) push(m);
    } else if (spec.kind === 'backrest_strip') {
      // Under the lip of the +Z bench, running along the tube.
      const stripY = benchY + 0.22, stripZ = radius + benchHalf - 0.04;
      const a = new THREE.Vector3(deckX0 + 0.2, stripY, stripZ);
      const b = new THREE.Vector3(deckX1 - 0.2, stripY, stripZ);
      for (const m of ledStrip(materials, spec, sku, lang, a, b, group)) push(m);
    }
  }

  const controlSpec = cfg.control !== 'none' ? catalog.controls?.[cfg.control] : null;
  if (controlSpec && heaterInfo) {
    const ctrlPos = new THREE.Vector3(wallT + 0.02, cy + radius * 0.3, radius + radius * 0.4);
    const ctrlDir = new THREE.Vector3(1, 0, 0); // faces into the barrel (+X)
    for (const m of controlUnit(materials, controlSpec, cfg.control, lang, ctrlPos, ctrlDir, benchMat)) push(m);
  }

  if (cfg.ventilation && heaterInfo) {
    // Supply vent on back cap, low, near heater
    const supY = floorY + 0.12;
    const supPos = new THREE.Vector3(wallT + 0.01, supY, radius + Math.min(radius * 0.5, halfWidthAt(supY) - 0.05));
    const supDir = new THREE.Vector3(1, 0, 0);
    for (const m of ventSlider(materials, benchMat, lang, supPos, supDir, 'supply')) push(m);
    // Exhaust on front cap, high, opposite side
    const exhPos = new THREE.Vector3(length - wallT - 0.01, cy + radius * 0.5, radius - radius * 0.4);
    const exhDir = new THREE.Vector3(-1, 0, 0);
    for (const m of ventSlider(materials, benchMat, lang, exhPos, exhDir, 'exhaust')) push(m);
  }

  for (const sku of (cfg.accessories || []).filter(s => s !== 'TERRACE-70')) {
    const spec = catalog.accessories[sku];
    if (!spec) continue;
    if (spec.kind === 'set') {
      const bucketPos = new THREE.Vector3(deckX0 + 0.55, floorY, radius + deckHalf - 0.22);
      for (const m of bucketSet(materials, spec, sku, lang, bucketPos)) push(m);
    }
  }

  const bounds = { minX: 0, maxX: length, minZ: 0, maxZ: radius * 2, minY: 0, maxY: cy + radius + 0.05 };
  // The door is on the end cap (max X), so the natural interior shot looks
  // down the length of the tube, with both benches receding toward the back
  // cap. Stand just inside the door on the deck, a little off the centreline
  // so both benches and the heater are in frame rather than edge-on.
  const eyeY = floorY + Math.min(1.20, (cy + rIn - floorY) * 0.72);
  const interiorView = {
    pos: new THREE.Vector3(deckX1 - 0.32, eyeY, radius + deckHalf * 0.45),
    look: new THREE.Vector3(deckX0 + 0.45, benchY + 0.06, radius - deckHalf * 0.55),
  };
  // Negated: a barrel door opens OUTWARD through the end cap. Swinging it
  // inward put the leaf and its handle straight across the interior view.
  return { group, registry, bounds, doorRoot, doorSign: -sign, heaterInfo, familyName: itemTitle(family), interiorView };
}
