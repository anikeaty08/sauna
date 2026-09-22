import * as THREE from 'three';
import { nameOf } from './names.js';
import { tag, box, cylindricalUVs } from './mesh.js';
import { doorHandleMaterials } from './materials.js';
import { wallLamp, ledStrip, bucketSet, controlUnit, ventSlider } from './fixtures.js';
/**
 * Round sauna: a free-standing vertical cylinder with a conical roof and a
 * flat door insert cut into the curved wall (the wall is built as a partial
 * cylinder - CylinderGeometry's thetaStart/thetaLength - leaving an angular
 * gap that a flat door frame bridges, matching how real round cabin doors
 * are built rather than trying to curve a door into the shell).
 */
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
  // view) - see the identical fix in barrel.js for why single-sided culling
  // made the barrel's shell/caps disappear from some camera angles.
  const wallMat = materials.wood(cfg.woodOutside || family.wall_wood, true, true);
  const trimMat = materials.wood(cfg.woodInside || family.wall_wood, false, true);
  const interiorSpec = catalog.interiors[cfg.interior.material];
  const benchMat = materials.wood(interiorSpec.wood, false);

  // Door gap: an angular sector centred on +Z (the entry faces the camera's
  // default view direction, matching the other shapes' front-facing door).
  const [doorWmm, doorHmm] = family.door_mm;
  const doorW = doorWmm / 1000, doorH = doorHmm / 1000;
  const doorHalfAngle = Math.asin(Math.min(0.95, doorW / (2 * radius)));
  const thetaStart = Math.PI / 2 + doorHalfAngle;
  const thetaLength = Math.PI * 2 - doorHalfAngle * 2;

  const shell = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, H, 32, 1, true, thetaStart, thetaLength), wallMat);
  shell.position.set(0, H / 2, 0);
  cylindricalUVs(shell.geometry, radius, 1.0);
  push(tag(shell, 'cabin', family.sku, isDe ? `${itemTitle(catalog.woods[family.wall_wood])} Rundwand, ${family.wall_mm} mm` : `${itemTitle(catalog.woods[family.wall_wood])} round wall, ${family.wall_mm} mm`, 0, [mm(radius * 2), mm(radius * 2), mm(H)], { includedIn: 'cabin' }));

  // Flat floor + conical roof.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), trimMat);
  floor.rotation.x = -Math.PI / 2;
  push(tag(floor, 'cabin', family.sku, isDe ? 'Saunaboden' : 'Floor', 0, [mm(radius * 2), mm(radius * 2), 45], { includedIn: 'cabin' }));

  const roofH = Math.max(0.35, radius * 0.55);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(radius + 0.08, roofH, 32), wallMat);
  roof.position.set(0, H + roofH / 2, 0);
  push(tag(roof, 'cabin', family.sku, isDe ? `Kegeldach, ${itemTitle(catalog.woods[family.wall_wood])}` : `Conical roof, ${itemTitle(catalog.woods[family.wall_wood])}`, 0, [mm((radius + 0.08) * 2), mm((radius + 0.08) * 2), mm(roofH)], { includedIn: 'cabin' }));

  // Door: flat leaf bridging the angular gap, hinged at one edge of the gap.
  const gapLeft = new THREE.Vector3(Math.cos(thetaStart) * radius, 0, -Math.sin(thetaStart) * radius);
  const gapRight = new THREE.Vector3(Math.cos(thetaStart + thetaLength) * radius, 0, -Math.sin(thetaStart + thetaLength) * radius);
  const sign = cfg.door.hinge === 'right' ? -1 : 1;
  const hingePoint = sign > 0 ? gapRight : gapLeft;
  const otherPoint = sign > 0 ? gapLeft : gapRight;
  const doorRoot = new THREE.Group();
  doorRoot.position.set(hingePoint.x, 0, hingePoint.z);
  doorRoot.rotation.y = Math.atan2(otherPoint.x - hingePoint.x, otherPoint.z - hingePoint.z) - Math.PI / 2;
  const leafParts = [];
  const doorGlassSpec = catalog.door_glass?.[cfg.door.glass] || catalog.door_glass?.clear;
  const doorMat = cfg.door.glass === 'wood_window' ? materials.wood('fichte') : materials.plain('roundGlass' + cfg.door.glass, { color: new THREE.Color(...(doorGlassSpec?.tint || [0.87, 0.93, 0.91])), roughness: 0.08, transparent: true, opacity: doorGlassSpec?.opacity ?? 0.3, side: THREE.DoubleSide });
  const leaf = new THREE.Mesh(box(0.008, doorH, doorW - 0.01), doorMat);
  leaf.position.set(0, doorH / 2, sign * (doorW - 0.01) / 2);
  leafParts.push(leaf);
  const handle = doorHandleMaterials(cfg, catalog, materials, benchMat);
  const handleZ = sign * (doorW - 0.09);
  const handleIn = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 12), handle.inside);
  handleIn.rotation.z = Math.PI / 2; handleIn.position.set(-0.05, doorH * 0.55, handleZ);
  const handleOut = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 12), handle.outside);
  handleOut.rotation.z = Math.PI / 2; handleOut.position.set(0.05, doorH * 0.55, handleZ);
  leafParts.push(handleIn, handleOut);
  const doorName = `${isDe ? 'Rundsauna-Tuer' : 'Round cabin door'}, ${itemTitle(doorGlassSpec)}, ${isDe ? (cfg.door.hinge === 'right' ? 'Anschlag rechts' : 'Anschlag links') : `hinged ${cfg.door.hinge}`}, ${itemTitle(handle.spec)}`;
  for (const m of leafParts) { doorRoot.add(m); push(tag(m, 'door', family.sku, doorName, 0, [doorWmm, 8, doorHmm], { includedIn: 'cabin', hinge: cfg.door.hinge })); }
  group.add(doorRoot);
  // Frame posts either side of the gap.
  for (const p of [gapLeft, gapRight]) {
    const post = new THREE.Mesh(box(wallT, doorH + 0.03, wallT), trimMat);
    post.position.set(p.x, (doorH + 0.03) / 2, p.z);
    push(tag(post, 'cabin', family.sku, isDe ? 'Türrahmen' : 'Door frame', 0, [mm(wallT), mm(doorH), mm(wallT)], { includedIn: 'cabin' }));
  }

  // Curved bench along the back half of the circumference, opposite the door.
  const benchSpec = catalog.interiors[cfg.interior.material];
  const benchR0 = radius - 0.55, benchR1 = radius - 0.08;
  const benchArc = Math.PI * 1.1;
  const benchStart = -Math.PI / 2 - benchArc / 2;
  const benchRing = new THREE.Mesh(new THREE.RingGeometry(benchR0, benchR1, 24, 1, benchStart, benchArc), benchMat);
  benchRing.rotation.x = -Math.PI / 2;
  benchRing.position.y = 0.46;
  push(tag(benchRing, 'interior', cfg.interior.material, `${isDe ? 'Rundbank' : 'Curved bench'}, ${itemTitle(benchSpec)}`, benchSpec.price, [mm(radius * 2), mm(benchR1 - benchR0), 460]));
  const apron = new THREE.Mesh(new THREE.RingGeometry(benchR0, benchR1, 24, 1, benchStart, benchArc), benchMat);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.10;
  push(tag(apron, 'interior', 'BENCH-APRON', isDe ? 'Bankblende (inbegriffen)' : 'Bench apron (included)', 0, [mm(radius * 2), mm(benchR1 - benchR0), 100], { includedIn: 'cabin' }));

  // Heater against the wall, offset from the door.
  const heaterSpec = catalog.heaters[cfg.heater.sku];
  const heaterAngle = Math.PI / 2 + Math.PI * 0.55;
  let heaterInfo = null;
  if (heaterSpec) {
    const [hwMm, , hhMm] = heaterSpec.dims_mm;
    const hw = hwMm / 1000, hh = hhMm / 1000;
    const bodyMat = heaterSpec.color === 'black' ? materials.black : materials.steel;
    const hx = Math.cos(heaterAngle) * (radius - 0.35), hz = -Math.sin(heaterAngle) * (radius - 0.35);
    const casing = new THREE.Mesh(box(hw, hh, hw * 0.8), bodyMat);
    casing.position.set(hx, hh / 2, hz);
    const stones = new THREE.Mesh(new THREE.CylinderGeometry(hw * 0.4, hw * 0.4, 0.05, 16), materials.stones);
    stones.position.set(hx, hh + 0.03, hz);
    for (const m of [casing, stones]) push(tag(m, 'heater', cfg.heater.sku, itemTitle(heaterSpec), heaterSpec.price, heaterSpec.dims_mm, { kw: heaterSpec.kw, control: heaterSpec.control, mount: heaterSpec.mount, approx: true }));
    heaterInfo = { cx: hx, cz: hz, hz0: hz, hz1: hz, base: 0, hh, atBack: false };

    if (heaterSpec.wood_fired && cfg.chimney && catalog.chimneys?.[cfg.chimney]) {
      const chimneySpec = catalog.chimneys[cfg.chimney];
      const flueParts = [];
      if (cfg.chimney === 'CHIMNEY-AUSSEN-130') {
        const flueTop = H + 0.55;
        const vertical = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, flueTop, 20), materials.black);
        vertical.position.set(hx, flueTop / 2, hz + 0.09);
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

  for (const sku of (cfg.lighting || [])) {
    const spec = catalog.lighting[sku];
    if (!spec) continue;
    if (spec.kind === 'wall_lamp') {
      const lampAngle = -Math.PI / 2;
      const lampR = radius - wallT - 0.03;
      const lampPos = new THREE.Vector3(Math.cos(lampAngle) * lampR, 1.62, -Math.sin(lampAngle) * lampR);
      const lampDir = new THREE.Vector3(-Math.cos(lampAngle), 0, Math.sin(lampAngle));
      for (const m of wallLamp(materials, spec, sku, lang, lampPos, lampDir, group)) push(m);
    } else if (spec.kind === 'backrest_strip') {
      const stripR = radius - 0.12;
      const a = new THREE.Vector3(Math.cos(-Math.PI/2 - 0.5) * stripR, 0.59, -Math.sin(-Math.PI/2 - 0.5) * stripR);
      const b = new THREE.Vector3(Math.cos(-Math.PI/2 + 0.5) * stripR, 0.59, -Math.sin(-Math.PI/2 + 0.5) * stripR);
      for (const m of ledStrip(materials, spec, sku, lang, a, b, group)) push(m);
    }
  }

  const controlSpec = cfg.control !== 'none' ? catalog.controls?.[cfg.control] : null;
  if (controlSpec && heaterInfo) {
    const ctrlAngle = heaterAngle + 0.4;
    const ctrlR = radius - wallT - 0.01;
    const ctrlPos = new THREE.Vector3(Math.cos(ctrlAngle) * ctrlR, 1.35, -Math.sin(ctrlAngle) * ctrlR);
    const ctrlDir = new THREE.Vector3(-Math.cos(ctrlAngle), 0, Math.sin(ctrlAngle));
    for (const m of controlUnit(materials, controlSpec, cfg.control, lang, ctrlPos, ctrlDir, benchMat)) push(m);
  }

  if (cfg.ventilation && heaterInfo) {
    const supAngle = heaterAngle - 0.3;
    const supR = radius - wallT;
    const supPos = new THREE.Vector3(Math.cos(supAngle) * supR, 0.15, -Math.sin(supAngle) * supR);
    const supDir = new THREE.Vector3(-Math.cos(supAngle), 0, Math.sin(supAngle));
    for (const m of ventSlider(materials, benchMat, lang, supPos, supDir, 'supply')) push(m);
    const exhAngle = heaterAngle + Math.PI;
    const exhR = radius - wallT;
    const exhPos = new THREE.Vector3(Math.cos(exhAngle) * exhR, H - 0.30, -Math.sin(exhAngle) * exhR);
    const exhDir = new THREE.Vector3(-Math.cos(exhAngle), 0, Math.sin(exhAngle));
    for (const m of ventSlider(materials, benchMat, lang, exhPos, exhDir, 'exhaust')) push(m);
  }

  for (const sku of (cfg.accessories || [])) {
    const spec = catalog.accessories[sku];
    if (!spec) continue;
    if (spec.kind === 'set') {
      const bucketAngle = heaterAngle - 0.6;
      const bucketR = radius - 0.30;
      const bucketPos = new THREE.Vector3(Math.cos(bucketAngle) * bucketR, 0, -Math.sin(bucketAngle) * bucketR);
      for (const m of bucketSet(materials, spec, sku, lang, bucketPos)) push(m);
    }
  }

  const bounds = { minX: -radius - 0.08, maxX: radius + 0.08, minZ: -radius - 0.08, maxZ: radius + 0.08, minY: 0, maxY: H + roofH };
  
  const interiorView = {
    pos: new THREE.Vector3(0, 1.5, radius - wallT - 0.4),
    look: new THREE.Vector3(0, H * 0.45, -radius * 0.5),
  };

  return { group, registry, bounds, interiorView, doorRoot, doorSign: sign, heaterInfo, familyName: itemTitle(family) };
}
