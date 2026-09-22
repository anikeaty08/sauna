import * as THREE from 'three';
import { nameOf } from './names.js';
import { tag, box, cylindricalUVs } from './mesh.js';
import { doorHandleMaterials } from './materials.js';
import { wallLamp, ledStrip, bucketSet, controlUnit, ventSlider } from './fixtures.js';

/**
 * Barrel sauna (Saunafass): a horizontal cylinder, axis along X (=width in the
 * catalog), diameter = depth. This is a pilot geometry - round staves are
 * approximated as a smooth shell, and the door sits on the flat front cap
 * rather than following the curve, which real barrel doors do.
 */
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
  const cy = radius;

  const shell = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 40, 1, true), wallMat);
  shell.rotation.z = Math.PI / 2;
  shell.position.set(length / 2, cy, radius);
  cylindricalUVs(shell.geometry, radius, 1.0);
  push(tag(shell, 'cabin', family.sku, `${itemTitle(catalog.woods[family.wall_wood])} ${isDe ? 'Fassdauben' : 'barrel staves'}, ${family.wall_mm} mm`, 0, [mm(length), mm(radius * 2), mm(radius * 2)], { includedIn: 'cabin' }));

  const backCap = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), wallMat);
  backCap.rotation.y = -Math.PI / 2;
  backCap.position.set(0.01, cy, radius);
  push(tag(backCap, 'cabin', family.sku, isDe ? 'Rueckwand' : 'Back cap', 0, [mm(radius * 2), mm(radius * 2), family.wall_mm], { includedIn: 'cabin' }));

  const doorW = family.door_mm[0] / 1000, doorH = family.door_mm[1] / 1000;
  const frontShape = new THREE.Shape();
  frontShape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  const hx0 = -doorW / 2, hx1 = doorW / 2, hy0 = -radius + 0.02, hy1 = hy0 + doorH;
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
  const leaf = new THREE.Mesh(box(doorH, doorW - 0.01, 0.008), doorMat);
  leaf.rotation.x = Math.PI / 2; leaf.rotation.z = Math.PI / 2;
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
  for (const m of leafParts) { doorRoot.add(m); push(tag(m, 'door', family.sku, doorName, 0, [family.door_mm[0], 8, family.door_mm[1]], { includedIn: 'cabin', hinge: cfg.door.hinge })); }
  group.add(doorRoot);

  const benchZ0 = radius + 0.15, benchZ1 = radius * 2 - wallT - 0.02;
  const benchY = radius * 0.55;
  const benchTop = new THREE.Mesh(box(length - 0.6, 0.035, benchZ1 - benchZ0, 1, 'x'), benchMat);
  benchTop.position.set(length / 2, benchY, benchZ0 + (benchZ1 - benchZ0) / 2);
  push(tag(benchTop, 'interior', cfg.interior.material, `${isDe ? 'Liege' : 'Bench'}, ${itemTitle(benchSpec)}`, benchSpec.price, [mm(length - 0.6), mm(benchZ1 - benchZ0), 35]));

  const heaterSpec = catalog.heaters[cfg.heater.sku];
  let heaterInfo = null;
  if (heaterSpec) {
    const [hwMm, , hhMm] = heaterSpec.dims_mm;
    const hw = hwMm / 1000, hh = hhMm / 1000;
    const bodyMat = heaterSpec.color === 'black' ? materials.black : materials.steel;
    const hx = 0.35, hz = radius * 2 - wallT - 0.3;
    const casing = new THREE.Mesh(box(hw, hh, hw * 0.8), bodyMat);
    casing.position.set(hx, hh / 2, hz);
    const stones = new THREE.Mesh(new THREE.CylinderGeometry(hw * 0.4, hw * 0.4, 0.05, 16), materials.stones);
    stones.position.set(hx, hh + 0.03, hz);
    for (const m of [casing, stones]) push(tag(m, 'heater', cfg.heater.sku, itemTitle(heaterSpec), heaterSpec.price, heaterSpec.dims_mm, { kw: heaterSpec.kw, control: heaterSpec.control, mount: heaterSpec.mount, approx: true }));
    heaterInfo = { cx: hx, cz: hz, hz0: hz, hz1: hz, base: 0, hh, atBack: false };
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
        elbow.position.set(hx, 0.07, radius * 2 - wallT / 2);
        flueParts.push(elbow);
      } else {
        const flueTop = shellTop + 0.4;
        const vertical = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, flueTop - hh, 24), materials.black);
        vertical.position.set(hx, hh + (flueTop - hh) / 2, hz);
        flueParts.push(vertical);
      }
      for (const p of flueParts) push(tag(p, 'heater', cfg.chimney, itemTitle(chimneySpec), chimneySpec.price, chimneySpec.dims_mm, { includedIn: 'heater' }));
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
      const lampPos = new THREE.Vector3(length / 2 + 0.3, cy + radius * 0.6, radius + radius * 0.5);
      const lampDir = new THREE.Vector3(0, -0.5, -1).normalize();
      for (const m of wallLamp(materials, spec, sku, lang, lampPos, lampDir, group)) push(m);
    } else if (spec.kind === 'backrest_strip') {
      const a = new THREE.Vector3(length * 0.25, benchY + 0.22, benchZ1 - 0.02);
      const b = new THREE.Vector3(length * 0.75, benchY + 0.22, benchZ1 - 0.02);
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
    const supPos = new THREE.Vector3(wallT + 0.01, 0.15, radius + radius * 0.5);
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
      const bucketPos = new THREE.Vector3(0.6, 0, radius + radius * 0.5);
      for (const m of bucketSet(materials, spec, sku, lang, bucketPos)) push(m);
    }
  }

  const bounds = { minX: 0, maxX: length, minZ: 0, maxZ: radius * 2, minY: 0, maxY: radius * 2 + 0.05 };
  // The door is on the end cap (max X), not a +Z wall like the rectangular
  // cabins - stand just inside it looking down the barrel toward the back cap.
  const eyeY = Math.min(1.5, cy * 1.5);
  const interiorView = {
    pos: new THREE.Vector3(length - wallT - 0.5, eyeY, radius),
    look: new THREE.Vector3(0.3, cy * 0.9, radius),
  };
  return { group, registry, bounds, doorRoot, doorSign: sign, heaterInfo, familyName: itemTitle(family), interiorView };
}
