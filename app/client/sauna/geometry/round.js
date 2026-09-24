import * as THREE from 'three';
import { nameOf } from './names.js';
import { tag, box, cylindricalUVs } from './mesh.js';
import { doorHandleMaterials } from './materials.js';
import { wallLamp, ledStrip, bucketSet, controlUnit, ventSlider } from './fixtures.js';

/**
 * Round sauna: a free-standing vertical cylinder with a conical roof and a
 * flat door leaf filling an angular gap cut out of the curved wall (the shell
 * is a partial CylinderGeometry via thetaStart/thetaLength), which is how real
 * round cabins are built rather than curving a door into the shell.
 *
 * ANGLE CONVENTION - everything here uses THREE.CylinderGeometry's own one:
 *   x = sin(theta) * r ,  z = cos(theta) * r
 * so a bearing computed here lands exactly on the shell arc. Mixing in the
 * more intuitive (cos, -sin) form is what previously put the door leaf 90
 * degrees away from the actual opening, leaving a bare hole and a door buried
 * in a solid wall. Layout verified against a Blender reference build.
 */

/** World position on the cabin's circle at bearing `theta`, radius `r`. */
const polar = (theta, r, y = 0) => new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r);
/** Unit vector at `theta` pointing from the wall in toward the cabin's axis. */
const inward = theta => new THREE.Vector3(-Math.sin(theta), 0, -Math.cos(theta));
/**
 * RingGeometry lies in its local XY (x=r·cos s, y=r·sin s) and is laid flat with
 * rotation.x = -PI/2, which maps it to world (r·cos s, -r·sin s). Matching that
 * against this file's (sin, cos) convention gives s = theta - PI/2.
 */
const ringStartFor = (worldCentre, arc) => worldCentre - arc / 2 - Math.PI / 2;

/**
 * A solid annular sector (curved plank) lying flat, `thickness` tall, with its
 * underside at y=0. Shape space maps to world the same way RingGeometry does,
 * so `ringStartFor` gives the start angle here too.
 *
 * RingGeometry alone is a zero-thickness disc, which reads as nothing at all
 * from a seated eye height - benches need real extruded stock.
 */
function sectorSolid(r0, r1, aStart, aLen, thickness) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, r1, aStart, aStart + aLen, false);
  shape.absarc(0, 0, r0, aStart + aLen, aStart, true);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 64 });
  g.rotateX(-Math.PI / 2);   // shape XY -> world XZ, extrusion along +Y
  return g;
}

export function buildRoundSauna(cfg, catalog, materials, lang) {
  const itemTitle = spec => nameOf(spec, lang);
  const isDe = lang === 'de';
  const group = new THREE.Group();
  const registry = [];
  const push = mesh => { if (mesh.userData.info) registry.push(mesh); group.add(mesh); return mesh; };
  const mm = v => Math.round(v * 1000);

  const family = catalog.families[cfg.family];
  const radius = cfg.widthCm / 200, H = cfg.heightCm / 100, wallT = family.wall_mm / 1000;
  // Double-sided: seen from outside (exterior view) and from inside (interior
  // view) - a single-sided material culls whichever side its normal doesn't
  // face, which previously made walls vanish from some camera angles.
  const wallMat = materials.wood(cfg.woodOutside || family.wall_wood, true, true);
  const trimMat = materials.wood(cfg.woodInside || family.wall_wood, false, true);
  const interiorSpec = catalog.interiors[cfg.interior.material];
  const benchMat = materials.wood(interiorSpec.wood, false);

  // ---- layout bearings ---------------------------------------------------
  const [doorWmm, doorHmm] = family.door_mm;
  const doorW = doorWmm / 1000, doorH = doorHmm / 1000;
  const halfGap = Math.asin(Math.min(0.95, doorW / (2 * radius)));
  const GAP_C = Math.PI / 2;            // door opening faces +X
  const BACK = GAP_C + Math.PI;         // bench wraps the far side
  const edgeA = GAP_C + halfGap, edgeB = GAP_C - halfGap;
  const benchArc = Math.PI * 1.1;       // leaves two free sectors beside the door
  // Free wall sectors either side of the bench: put the heater/controls in the
  // one clockwise of the door, lamp in the other, so nothing collides.
  const heaterAngle = GAP_C + 0.87;     // ~140 deg when the gap is at 90
  const lampAngle = GAP_C - 0.87;

  // ---- shell, floor, conical roof ---------------------------------------
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, H, 48, 1, true, edgeA, Math.PI * 2 - halfGap * 2), wallMat);
  shell.position.set(0, H / 2, 0);
  cylindricalUVs(shell.geometry, radius, 1.0);
  push(tag(shell, 'cabin', family.sku, isDe ? `${itemTitle(catalog.woods[family.wall_wood])} Rundwand, ${family.wall_mm} mm` : `${itemTitle(catalog.woods[family.wall_wood])} round wall, ${family.wall_mm} mm`, 0, [mm(radius * 2), mm(radius * 2), mm(H)], { includedIn: 'cabin' }));

  const floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), trimMat);
  floor.rotation.x = -Math.PI / 2;
  push(tag(floor, 'cabin', family.sku, isDe ? 'Saunaboden' : 'Floor', 0, [mm(radius * 2), mm(radius * 2), 45], { includedIn: 'cabin' }));

  const roofH = Math.max(0.35, radius * 0.55);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(radius + 0.08, roofH, 48), wallMat);
  roof.position.set(0, H + roofH / 2, 0);
  push(tag(roof, 'cabin', family.sku, isDe ? `Kegeldach, ${itemTitle(catalog.woods[family.wall_wood])}` : `Conical roof, ${itemTitle(catalog.woods[family.wall_wood])}`, 0, [mm((radius + 0.08) * 2), mm((radius + 0.08) * 2), mm(roofH)], { includedIn: 'cabin' }));

  // ---- door: flat leaf spanning the gap chord, hinged on one edge --------
  const hingeOnA = cfg.door.hinge === 'right';
  const hingePoint = polar(hingeOnA ? edgeA : edgeB, radius);
  const otherPoint = polar(hingeOnA ? edgeB : edgeA, radius);
  const doorRoot = new THREE.Group();
  doorRoot.position.copy(hingePoint);
  // local +Z runs hinge -> far edge, so the leaf always extends along +Z.
  doorRoot.rotation.y = Math.atan2(otherPoint.x - hingePoint.x, otherPoint.z - hingePoint.z);
  // local +X is inward for one hinge side and outward for the other, so work
  // out which way it actually points before placing the inside/outside grips.
  const gapInward = inward(GAP_C);
  const localXInward = Math.cos(doorRoot.rotation.y) * gapInward.x - Math.sin(doorRoot.rotation.y) * gapInward.z > 0;
  const inSide = localXInward ? 1 : -1;

  const leafW = doorW - 0.01;
  const doorGlassSpec = catalog.door_glass?.[cfg.door.glass] || catalog.door_glass?.clear;
  const doorMat = cfg.door.glass === 'wood_window'
    ? materials.wood('fichte')
    : materials.plain('roundGlass' + cfg.door.glass, { color: new THREE.Color(...(doorGlassSpec?.tint || [0.87, 0.93, 0.91])), roughness: 0.08, transparent: true, opacity: doorGlassSpec?.opacity ?? 0.3, side: THREE.DoubleSide });
  const leaf = new THREE.Mesh(box(0.008, doorH, leafW), doorMat);
  leaf.position.set(0, doorH / 2, leafW / 2);
  const handle = doorHandleMaterials(cfg, catalog, materials, benchMat);
  const handleZ = leafW - 0.08;
  const handleIn = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 12), handle.inside);
  handleIn.rotation.z = Math.PI / 2; handleIn.position.set(inSide * 0.05, doorH * 0.55, handleZ);
  const handleOut = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 12), handle.outside);
  handleOut.rotation.z = Math.PI / 2; handleOut.position.set(-inSide * 0.05, doorH * 0.55, handleZ);
  const doorName = `${isDe ? 'Rundsauna-Tuer' : 'Round cabin door'}, ${itemTitle(doorGlassSpec)}, ${isDe ? (cfg.door.hinge === 'right' ? 'Anschlag rechts' : 'Anschlag links') : `hinged ${cfg.door.hinge}`}, ${itemTitle(handle.spec)}`;
  // tag() + registry.push() directly, NOT the push() helper: push() also calls
  // group.add(), which would re-parent these off doorRoot (an Object3D has one
  // parent) and silently drop the hinge position/rotation.
  for (const m of [leaf, handleIn, handleOut]) {
    doorRoot.add(m);
    tag(m, 'door', family.sku, doorName, 0, [doorWmm, 8, doorHmm], { includedIn: 'cabin', hinge: cfg.door.hinge });
    registry.push(m);
  }
  group.add(doorRoot);
  // Rotating doorRoot by +ry swings local +Z toward local +X. applyDoor() uses
  // baseRotY - doorSign*angle, so with THIS sign the leaf swings toward local
  // -X when local +X is inward - i.e. outward, the way a sauna door has to
  // open (so someone overcome by heat can fall against it rather than needing
  // to pull it inward). Verified empirically: the leaf's far edge measured
  // 0.997 m from the room centre closed and 0.682 m open with the old sign -
  // moving IN as it opened.
  const doorSign = localXInward ? 1 : -1;

  for (const p of [polar(edgeA, radius), polar(edgeB, radius)]) {
    const post = new THREE.Mesh(box(wallT, doorH + 0.03, wallT), trimMat);
    post.position.set(p.x, (doorH + 0.03) / 2, p.z);
    push(tag(post, 'cabin', family.sku, isDe ? 'Türrahmen' : 'Door frame', 0, [mm(wallT), mm(doorH), mm(wallT)], { includedIn: 'cabin' }));
  }

  // ---- curved two-tier bench wrapping the far wall ------------------------
  // Built from individual curved slats with gaps between them, like the
  // rectangular cabins, and driven by the same interior config (depths,
  // heights, apron, backrests, headrests) so the round family is as
  // configurable as the others.
  const benchSpec = catalog.interiors[cfg.interior.material];
  const iR = radius - wallT;                       // inner wall face
  const slatT = 0.035, slatGap = 0.012;
  const ivars = cfg.interior;

  /** Lay a run of curved slats between r0..r1 at height y, spanning `arc`. */
  const slatRun = (r0, r1, y, centre, arc, thickness = slatT) => {
    const meshes = [];
    const rSpan = r1 - r0;
    if (rSpan <= 0.02 || arc <= 0.02) return meshes;
    const count = Math.max(2, Math.round(rSpan / 0.085));
    const pitch = rSpan / count;
    const aStart = ringStartFor(centre, arc);
    for (let i = 0; i < count; i++) {
      const sr0 = r0 + i * pitch, sr1 = sr0 + pitch - slatGap;
      if (sr1 <= sr0) continue;
      const m = new THREE.Mesh(sectorSolid(sr0, sr1, aStart, arc, thickness), benchMat);
      m.position.y = y - thickness;
      meshes.push(m);
    }
    return meshes;
  };

  const upperDepth = Math.min((ivars.upperDepthCm ?? 55) / 100, iR * 0.55);
  const lowerDepth = Math.min((ivars.lowerDepthCm ?? 40) / 100, iR * 0.45);
  const upperY = (ivars.upperHeightCm ?? 88) / 100;
  const lowerY = (ivars.lowerHeightCm ?? 46) / 100;

  const upR1 = iR - 0.02, upR0 = Math.max(0.12, upR1 - upperDepth);
  // A second tier only goes in if there is still a floor left to stand on.
  // In a 2 m circle a 0.52 m upper bench already reaches r=0.40, so forcing a
  // lower tier under it produced a disc covering the whole floor.
  const FLOOR_R = 0.32;
  const loR1 = upR0 - 0.015, loR0 = Math.max(FLOOR_R, loR1 - lowerDepth);
  const hasLower = loR1 - loR0 >= 0.22;
  const lowerArc = benchArc * 0.62;                // standing room by the door

  const upperSlats = slatRun(upR0, upR1, upperY, BACK, benchArc);
  for (const m of upperSlats)
    push(tag(m, 'interior', cfg.interior.material, `${isDe ? 'Rundbank oben' : 'Upper curved bench'}, ${itemTitle(benchSpec)}`, 0, [mm(iR * 2), mm(upperDepth), mm(upperY)], { includedIn: 'cabin' }));

  const lowerSlats = hasLower ? slatRun(loR0, loR1, lowerY, BACK, lowerArc) : [];
  for (const m of lowerSlats)
    push(tag(m, 'interior', cfg.interior.material, `${isDe ? 'Rundbank unten' : 'Lower curved bench'}, ${itemTitle(benchSpec)}`, benchSpec.price, [mm(iR * 2), mm(lowerDepth), mm(lowerY)]));

  // Bench fronts. Each tier gets a skirt running from its underside down to
  // whatever is beneath it - the tier below, or the floor. Real curved benches
  // are boxed in like this; exposed posts standing out in the middle of the
  // room read as scaffolding rather than joinery.
  if (ivars.apron !== false) {
    const tiers = [[upR0, upperY, benchArc, lowerSlats.length ? lowerY : 0]];
    if (lowerSlats.length) tiers.push([loR0, lowerY, lowerArc, 0]);
    for (const [r, y, arc, base] of tiers) {
      const h = y - slatT - base;
      if (h <= 0.02) continue;
      const apron = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, h, 64, 1, true, BACK - arc / 2, arc), benchMat);
      apron.position.y = base + h / 2;
      push(tag(apron, 'interior', 'BENCH-APRON', isDe ? 'Bankblende (inbegriffen)' : 'Bench apron (included)', 0, [mm(r * 2), 20, mm(h)], { includedIn: 'cabin' }));
    }
  }

  // Backrest: vertical-gap slats following the wall above the upper bench.
  if (ivars.backrests) {
    const backR = iR - 0.035;
    for (let i = 0; i < 3; i++) {
      const y = upperY + 0.20 + i * 0.145;
      if (y > H - 0.35) break;
      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(backR, backR, 0.105, 64, 1, true, BACK - benchArc * 0.94 / 2, benchArc * 0.94), benchMat);
      rail.position.y = y;
      push(tag(rail, 'interior', 'BACKREST', isDe ? 'Rückenlehne (inbegriffen)' : 'Backrest (included)', 0, [mm(backR * 2), 25, 105], { includedIn: 'cabin' }));
    }
  }

  // Headrests sit on the upper tier, clear of the heater sector.
  for (let i = 0; i < Math.min(2, ivars.headrests ?? 0); i++) {
    const a = BACK + (i === 0 ? -0.45 : 0.45);
    const hr = new THREE.Mesh(sectorSolid(upR0 + 0.06, upR1 - 0.06, ringStartFor(a, 0.34), 0.34, 0.05), benchMat);
    hr.position.y = upperY + 0.02;
    push(tag(hr, 'interior', 'HEADREST', isDe ? 'Kopfstütze (inbegriffen)' : 'Headrest (included)', 0, [400, mm(upR1 - upR0), 50], { includedIn: 'cabin' }));
  }

  // Floor grating over the open floor the benches don't cover.
  if (ivars.floorGrate) {
    const gR = Math.max(0.18, (hasLower ? loR0 : upR0) - 0.02);
    const count = 22;
    for (let i = 0; i < count; i++) {
      const a = (i + 0.5) * (Math.PI * 2 / count);
      const slat = new THREE.Mesh(sectorSolid(0.06, gR, ringStartFor(a, Math.PI * 2 / count - 0.035), Math.PI * 2 / count - 0.035, 0.028), benchMat);
      slat.position.y = 0.012;
      push(tag(slat, 'interior', 'FLOOR-GRATE', isDe ? 'Bodenrost (inbegriffen)' : 'Floor grating (included)', 0, [mm(gR * 2), mm(gR * 2), 40], { includedIn: 'cabin' }));
    }
  }

  // ---- heater (+ flue) ---------------------------------------------------
  const heaterSpec = catalog.heaters[cfg.heater.sku];
  let heaterInfo = null;
  if (heaterSpec) {
    const [hwMm, , hhMm] = heaterSpec.dims_mm;
    const hw = hwMm / 1000, hh = hhMm / 1000;
    const bodyMat = heaterSpec.color === 'black' ? materials.black : materials.steel;
    // Pull the heater in far enough that its own corners clear the wall.
    const heaterR = Math.max(0.1, radius - 0.12 - Math.hypot(hw, hw * 0.8) / 2);
    const hPos = polar(heaterAngle, heaterR);
    const hx = hPos.x, hz = hPos.z;
    const casing = new THREE.Mesh(box(hw, hh, hw * 0.8), bodyMat);
    casing.position.set(hx, hh / 2, hz);
    casing.rotation.y = heaterAngle;
    const stones = new THREE.Mesh(new THREE.CylinderGeometry(hw * 0.4, hw * 0.4, 0.05, 16), materials.stones);
    stones.position.set(hx, hh + 0.03, hz);
    for (const m of [casing, stones]) push(tag(m, 'heater', cfg.heater.sku, itemTitle(heaterSpec), heaterSpec.price, heaterSpec.dims_mm, { kw: heaterSpec.kw, control: heaterSpec.control, mount: heaterSpec.mount, approx: true }));
    heaterInfo = { cx: hx, cz: hz, hz0: hz, hz1: hz, base: 0, hh, atBack: false };

    if (heaterSpec.wood_fired && cfg.chimney && catalog.chimneys?.[cfg.chimney]) {
      const chimneySpec = catalog.chimneys[cfg.chimney];
      const flueParts = [];
      if (cfg.chimney === 'CHIMNEY-AUSSEN-130') {
        const flueTop = H + 0.55;
        const outer = polar(heaterAngle, radius + 0.09);
        const vertical = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, flueTop, 20), materials.black);
        vertical.position.set(outer.x, flueTop / 2, outer.z);
        flueParts.push(vertical);
      } else {
        const flueTop = H + roofH + 0.4;
        const vertical = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, flueTop - hh, 24), materials.black);
        vertical.position.set(hx, hh + (flueTop - hh) / 2, hz);
        flueParts.push(vertical);
      }
      for (const p of flueParts) push(tag(p, 'heater', cfg.chimney, itemTitle(chimneySpec), chimneySpec.price, chimneySpec.dims_mm, { includedIn: 'heater' }));
    }
  }

  // ---- lighting ----------------------------------------------------------
  for (const sku of (cfg.lighting || [])) {
    const spec = catalog.lighting[sku];
    if (!spec) continue;
    if (spec.kind === 'wall_lamp') {
      const lampR = radius - wallT - 0.03;
      for (const m of wallLamp(materials, spec, sku, lang, polar(lampAngle, lampR, 1.62), inward(lampAngle), group)) push(m);
    } else if (spec.kind === 'backrest_strip' || spec.kind === 'under_bench') {
      const stripR = spec.kind === 'under_bench' ? upR1 - 0.06 : radius - 0.12;
      const y = spec.kind === 'under_bench' ? 0.22 : 0.59;
      const a = polar(BACK - 0.5, stripR, y);
      const b = polar(BACK + 0.5, stripR, y);
      for (const m of ledStrip(materials, spec, sku, lang, a, b, group, spec.kind === 'under_bench' ? 'rgb' : 'warm')) push(m);
    }
  }

  // ---- control unit ------------------------------------------------------
  const controlSpec = cfg.control !== 'none' ? catalog.controls?.[cfg.control] : null;
  if (controlSpec && heaterInfo) {
    const ctrlAngle = heaterAngle + 0.35;
    const ctrlR = radius - wallT - 0.01;
    for (const m of controlUnit(materials, controlSpec, cfg.control, lang, polar(ctrlAngle, ctrlR, 1.35), inward(ctrlAngle), benchMat)) push(m);
  }

  // ---- ventilation -------------------------------------------------------
  if (cfg.ventilation && heaterInfo) {
    const supAngle = heaterAngle - 0.3;
    const exhAngle = heaterAngle + Math.PI;
    const r = radius - wallT;
    for (const m of ventSlider(materials, benchMat, lang, polar(supAngle, r, 0.15), inward(supAngle), 'supply')) push(m);
    for (const m of ventSlider(materials, benchMat, lang, polar(exhAngle, r, H - 0.30), inward(exhAngle), 'exhaust')) push(m);
  }

  // ---- accessories -------------------------------------------------------
  for (const sku of (cfg.accessories || [])) {
    const spec = catalog.accessories[sku];
    if (!spec) continue;
    if (spec.kind === 'set') {
      // Beyond the heater, away from the door. At heaterAngle - 0.55 it landed
      // 0.2 m in front of where the viewer stands and filled the frame.
      for (const m of bucketSet(materials, spec, sku, lang, polar(heaterAngle + 0.45, radius - 0.34))) push(m);
    }
  }

  const bounds = { minX: -radius - 0.08, maxX: radius + 0.08, minZ: -radius - 0.08, maxZ: radius + 0.08, minY: 0, maxY: H + roofH };
  // Stand inside on the door side, looking across at the heater - not straight
  // at the curved far wall, which fills the whole frame from this close.
  // Stand just inside the door and look straight across at the tiered bench
  // wrapping the far wall - that is what the room is. Aiming at the heater
  // instead put a 0.5 m black box 0.65 m from the lens and nothing else.
  const eyeY = Math.min(1.35, H * 0.62);
  const interiorView = {
    pos: polar(GAP_C, radius * 0.70, eyeY),
    look: polar(BACK, (upR0 + upR1) / 2, upperY),
  };

  return { group, registry, bounds, interiorView, doorRoot, doorSign, heaterInfo, familyName: itemTitle(family) };
}
