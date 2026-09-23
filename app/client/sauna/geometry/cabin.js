import * as THREE from 'three';
import { nameOf } from './names.js';
import { tag, box, subtractIntervals } from './mesh.js';
import { planPolygon, classifySegments, add, scale, hexMaxInnerX, polyEdges, shiftInside } from './math.js';
import { doorHandleMaterials } from './materials.js';

export function buildCabinSauna(cfg, catalog, materials, lang = 'en') {
  const itemTitle = spec => nameOf(spec, lang);
  const isDe = lang === 'de';
  const group = new THREE.Group();
  const registry = [];
  const push = mesh => { if (mesh.userData.info) registry.push(mesh); group.add(mesh); return mesh; };

  const family = catalog.families[cfg.family];
  const familyName = itemTitle(family);
  const W = cfg.widthCm / 100, D = cfg.depthCm / 100, H = cfg.heightCm / 100;
  const t = family.wall_mm / 1000, tc = family.ceiling_mm / 1000;
  const [doorWmm, doorHmm] = family.door_mm;
  const doorW = doorWmm / 1000, doorH = doorHmm / 1000;
  const frame = family.door_frame_mm / 1000;
  const zC = H - tc;
  const doorTop = Math.min(doorH + 0.01, zC - 0.03);
  const vertical = cfg.boardOrientation === 'vertical';
  // Bergzauber-style families let the customer pick the panel wood per visible
  // side; everything else uses the family's fixed wall_wood for both.
  const wallWoodKey = cfg.woodOutside || family.wall_wood;
  const wallMat = materials.wood(wallWoodKey, true);
  const trimMat = materials.wood(cfg.woodInside || family.wall_wood, false);
  const interiorSpec = catalog.interiors[cfg.interior.material];
  const interiorName = itemTitle(interiorSpec);
  const benchMat = materials.wood(interiorSpec.wood, false);
  const mm = v => Math.round(v * 1000);

  const doorBlock = doorW + 2 * frame;
  const points = planPolygon(cfg, doorBlock, family);
  const segments = classifySegments(points, W, D);
  const isHex = family.type === 'hex';
  const segByName = name => segments.find(s => s.name === name);

  // interior extents (rectangular part)
  const X0 = -W / 2 + t, X1 = W / 2 - t;   // left/right inner faces
  const ZB = t, ZF = D - t;                 // back inner face, front inner face
  /**
   * Usable half-width for anything spanning z0..z1. A rectangle is the same
   * everywhere; a hex narrows toward both end walls, so take the tightest
   * point over the span - evaluating only the midpoint lets the ends poke
   * out through the angled corner walls.
   */
  const innerHalfWidth = (z0, z1 = z0) => isHex
    ? Math.min(hexMaxInnerX(z0, W, D, t), hexMaxInnerX(z1, W, D, t))
    : X1;

  /**
   * Backstop for fixture placement on angled footprints: nudge a whole
   * assembly inward until none of it is buried in, or poking through, a wall.
   * Applied to the assembled parts so the pieces keep their relative layout -
   * clamping each mesh on its own would pull assemblies apart.
   *
   * Only hex needs it; rectangular walls are already handled by X0/X1/ZB/ZF.
   */
  const hullEdges = isHex ? polyEdges(points) : null;
  const keepInside = (meshes, clearance = t + 0.01) => {
    if (!hullEdges || !meshes.length) return;
    const pts = [];
    for (const m of meshes) {
      if (!m.geometry) continue;
      m.updateMatrix();
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      for (const cx of [bb.min.x, bb.max.x])
        for (const cy of [bb.min.y, bb.max.y])
          for (const cz of [bb.min.z, bb.max.z]) {
            const v = new THREE.Vector3(cx, cy, cz).applyMatrix4(m.matrix);
            pts.push({ x: v.x, z: v.z });
          }
    }
    const s = shiftInside(hullEdges, pts, clearance);
    if (!s) return;
    for (const m of meshes) { m.position.x += s.x; m.position.z += s.z; m.updateMatrix(); }
  };

  // ---- door and glass layout -----------------------------------------------
  const chamfered = cfg.entry === 'corner' || cfg.entry === 'corner_glasfront';
  const glassCorner = cfg.entry === 'glass_corner';
  const doorSeg = chamfered ? segByName('corner') : segByName('front');
  const edge = t + 0.06;
  let u0;
  if (chamfered) u0 = (doorSeg.L - doorBlock) / 2;
  else {
    let pos = cfg.door.position;
    if (glassCorner) pos = cfg.door.corner === 'left' ? 'right' : 'left'; // door away from the glass corner
    u0 = pos === 'left' ? edge : pos === 'right' ? doorSeg.L - edge - doorBlock : (doorSeg.L - doorBlock) / 2;
  }
  u0 = Math.min(Math.max(u0, edge), doorSeg.L - edge - doorBlock);
  doorSeg.openings.push({ kind: 'door', u0, u1: u0 + doorBlock, z0: 0, z1: doorTop + 0.045 });
  const doorInfo = { seg: doorSeg, u0: u0 + frame, u1: u0 + frame + doorW };

  // heater side: away from the door / glass corner unless the customer chose explicitly
  const doorCentreX = add(doorSeg.p0, scale(doorSeg.d, u0 + doorBlock / 2)).x;
  let heaterSide = chamfered || glassCorner ? (cfg.door.corner === 'left' ? 1 : -1) : (doorCentreX <= 0 ? 1 : -1);
  if (['front_left', 'back_left'].includes(cfg.heater.position)) heaterSide = -1;
  if (['front_right', 'back_right'].includes(cfg.heater.position)) heaterSide = 1;
  if ((chamfered || glassCorner) && cfg.heater.position.startsWith('front') && ((heaterSide > 0) === (cfg.door.corner !== 'left'))) heaterSide = -heaterSide;

  function layoutGlass(seg) {
    seg.glass = true;
    seg.openings = seg.openings.filter(o => o.kind === 'door');
    seg.openings.push({ kind: 'glass', u0: t + 0.03, u1: seg.L - (t + 0.03), z0: 0, z1: doorTop + 0.045 });
  }
  function layoutWindow(seg, dU0, dU1) {
    if (cfg.window === 'none') return;
    const fr = 0.05;
    let free;
    if (dU0 == null) free = [edge, seg.L - edge];
    else {
      const right2 = [dU1 + 0.02, seg.L - edge], left2 = [edge, dU0 - 0.02];
      free = (right2[1] - right2[0]) >= (left2[1] - left2[0]) ? right2 : left2;
    }
    const avail = free[1] - free[0] - 2 * fr;
    if (avail < 0.30) return;
    // Named window types (two_fixed, tilt_open, round_half/full - added for
    // Kemi/Mikkeli/Saunafass) are priced distinctly in the catalog but drawn
    // here as one appropriately-sized opening; a numeric value ("60") is a
    // width in cm, anything else (incl. "auto") fills most of the free span.
    const numeric = Number(cfg.window);
    const fraction = { round_half: 0.55, tilt_open: 0.7 }[cfg.window] ?? 0.95;
    const width = Number.isFinite(numeric) && String(cfg.window).trim() !== '' ? Math.min(numeric / 100, avail) : Math.min(fraction, avail);
    const wu0 = dU0 == null ? (seg.L - width) / 2 - fr : (free[0] > edge ? free[0] : free[1] - width - 2 * fr);
    seg.openings.push({ kind: 'window', u0: wu0, u1: wu0 + width + 2 * fr, z0: 0.10, z1: doorTop + 0.045, glass: [wu0 + fr, wu0 + fr + width, 0.15, doorTop] });
  }
  if (cfg.entry === 'glasfront') layoutGlass(doorSeg);
  else if (cfg.entry === 'corner_glasfront') { layoutGlass(segByName('front')); layoutGlass(doorSeg); }
  else if (glassCorner) { layoutGlass(doorSeg); layoutGlass(segByName(cfg.door.corner === 'left' ? 'left' : 'right')); }
  else if (cfg.entry === 'front') layoutWindow(doorSeg, u0, u0 + doorBlock);
  else layoutWindow(segByName('front'), null, null);

  // ---- walls -----------------------------------------------------------------
  // A wall panel: local X runs along the wall, local Z through its thickness,
  // placed so the exterior face sits exactly on the footprint line.
  function panel(seg, ua, ub, y0, y1, material, thickness = t, inset = 0, grain = 'auto') {
    const mesh = new THREE.Mesh(box(ub - ua, y1 - y0, thickness, 1.0, grain), material);
    const mid = add(seg.p0, scale(seg.d, (ua + ub) / 2));
    const q = add(mid, scale(seg.n, inset + thickness / 2));
    mesh.position.set(q.x, (y0 + y1) / 2, q.z);
    mesh.rotation.y = Math.atan2(-seg.d.z, seg.d.x);
    return mesh;
  }
  for (const seg of segments) {
    if (seg.glass) continue;
    const holes = seg.openings.map(o => [o.u0, o.u1, o.z0, o.z1]);
    const rows = [[0, zC]];
    const breaks = new Set([0, zC]);
    for (const h of holes) { if (h[2] > 0 && h[2] < zC) breaks.add(h[2]); if (h[3] > 0 && h[3] < zC) breaks.add(h[3]); }
    const ys = [...breaks].sort((a, b) => a - b);
    rows.length = 0;
    for (let i = 0; i < ys.length - 1; i++) rows.push([ys[i], ys[i + 1]]);
    for (const [y0, y1] of rows) {
      const rowHoles = holes.filter(h => h[2] <= y0 + 1e-6 && h[3] >= y1 - 1e-6).map(h => [h[0], h[1]]);
      for (const [a, b] of subtractIntervals([0, seg.L], rowHoles)) {
        const mesh = panel(seg, a, b, y0, y1, wallMat, t, 0, vertical ? 'y' : 'x');
        push(tag(mesh, 'cabin', family.sku, isDe ? `${itemTitle(catalog.woods[wallWoodKey])} Wand, ${family.wall_mm} mm massiv` : `${itemTitle(catalog.woods[wallWoodKey])} wall, ${family.wall_mm} mm solid`, 0, [mm(b - a), family.wall_mm, mm(y1 - y0)], { includedIn: 'cabin' }));
      }
    }
  }
  for (const seg of segments) {
    for (const o of seg.openings) {
      if (o.kind === 'door' && !seg.glass) {
        const parts = [panel(seg, o.u0, o.u0 + frame, 0, o.z1, trimMat), panel(seg, o.u1 - frame, o.u1, 0, o.z1, trimMat), panel(seg, o.u0 + frame, o.u1 - frame, doorTop, o.z1, trimMat)];
        for (const m of parts) push(tag(m, 'cabin', family.sku, isDe ? 'Türrahmen, schwellenlos' : 'Door frame, threshold-free', 0, [mm(o.u1 - o.u0), family.wall_mm, mm(o.z1)], { includedIn: 'cabin' }));
      } else if (o.kind === 'window') {
        const [gx0, gx1, gz0, gz1] = o.glass;
        const parts = [panel(seg, o.u0, o.u0 + 0.05, o.z0, o.z1, trimMat), panel(seg, o.u1 - 0.05, o.u1, o.z0, o.z1, trimMat), panel(seg, o.u0 + 0.05, o.u1 - 0.05, o.z0, gz0, trimMat), panel(seg, o.u0 + 0.05, o.u1 - 0.05, gz1, o.z1, trimMat)];
        for (const m of parts) push(tag(m, 'cabin', family.sku, isDe ? 'Fensterrahmen' : 'Window frame', 0, [mm(o.u1 - o.u0), family.wall_mm, mm(o.z1 - o.z0)], { includedIn: 'cabin' }));
        push(tag(panel(seg, gx0, gx1, gz0, gz1, materials.glass, 0.008, t / 2), 'cabin', family.sku, isDe ? 'Raumhohes Fenster, 8 mm Sicherheitsglas (ESG)' : 'Full-height window, 8 mm toughened clear glass', 0, [mm(gx1 - gx0), 8, mm(gz1 - gz0)], { includedIn: 'cabin' }));
      } else if (o.kind === 'glass') {
        const hasDoor = doorInfo.seg === seg;
        const d0 = hasDoor ? doorInfo.u0 - frame : null, d1 = hasDoor ? doorInfo.u1 + frame : null;
        const spans = hasDoor ? [[o.u0, d0], [d1, o.u1]] : [[o.u0, o.u1]];
        const profile = 0.04;
        const profileU = new Set([o.u0, o.u1]);
        if (hasDoor) { profileU.add(d0); profileU.add(d1); }
        const panes = [];
        for (const [a, b] of spans) {
          if (b - a < 0.05) continue;
          const count = Math.max(1, Math.ceil((b - a) / 1.05));
          const pw = (b - a) / count;
          for (let i = 0; i < count; i++) { panes.push([a + i * pw, a + (i + 1) * pw]); profileU.add(a + i * pw); profileU.add(a + (i + 1) * pw); }
        }
        for (const u of profileU) push(tag(panel(seg, u - profile / 2, u + profile / 2, 0, o.z1, materials.steel, t * 0.7, t * 0.15), 'cabin', family.sku, isDe ? 'Glasfront Aluminium-Einfassprofil' : 'Glass front aluminium profile', 0, [40, family.wall_mm, mm(o.z1)], { includedIn: 'cabin' }));
        push(tag(panel(seg, o.u0, o.u1, o.z1 - 0.045, o.z1, materials.steel, t * 0.7, t * 0.15), 'cabin', family.sku, isDe ? 'Glasfront Deckenabschlussprofil' : 'Glass front head profile', 0, [mm(o.u1 - o.u0), family.wall_mm, 45], { includedIn: 'cabin' }));
        for (const [a, b] of panes) push(tag(panel(seg, a + profile / 2, b - profile / 2, 0.012, o.z1 - 0.045, materials.glass, 0.008, t / 2), 'cabin', family.sku, isDe ? 'Glasfront, 8 mm Einscheibensicherheitsglas (ESG)' : 'Glass front, 8 mm clear glass', 0, [mm(b - a), 8, mm(o.z1)], { includedIn: 'cabin' }));
      }
    }
  }
  // An all-glass corner is two adjacent glazed walls, and each one's glazing
  // starts t+0.03 in from the end - so without this the corner is an empty
  // notch with the roof corner hanging over nothing. Real all-glass corners
  // are closed with a slim vertical mullion; add it at the shared vertex.
  if (glassCorner) {
    const cornerSeg = segByName(cfg.door.corner === 'left' ? 'left' : 'right');
    const frontSeg = segByName('front');
    if (cornerSeg && frontSeg) {
      const shared = [cornerSeg.p0, cornerSeg.p1].find(a =>
        [frontSeg.p0, frontSeg.p1].some(b => Math.hypot(a.x - b.x, a.z - b.z) < 1e-6));
      if (shared) {
        const postW = 0.055;
        const inX = shared.x > 0 ? -1 : 1, inZ = shared.z > D / 2 ? -1 : 1;
        const mullion = new THREE.Mesh(box(postW, doorTop + 0.045, postW), materials.steel);
        mullion.position.set(shared.x + inX * postW / 2, (doorTop + 0.045) / 2, shared.z + inZ * postW / 2);
        push(tag(mullion, 'cabin', family.sku, isDe ? 'Glasfront Eckpfosten' : 'Glass corner mullion', 0, [mm(postW), family.wall_mm, mm(doorTop)], { includedIn: 'cabin' }));
      }
    }
  }
  // roof + floor + interior ceiling trim. Any non-rectangular footprint (hex,
  // or a chamfered corner-entry cabin) gets a shape-matched cap - extruded
  // from the actual footprint outline - instead of a plain bounding-box slab,
  // which would overhang past the cut corner/angled wall into empty space.
  const usesShapeCap = isHex || chamfered;
  function capMesh(thickness, material) {
    if (usesShapeCap) {
      const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, p.z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
      const mesh = new THREE.Mesh(geo, material);
      mesh.rotation.x = Math.PI / 2;
      return mesh; // solid spans local world-Y [-thickness, 0] at position (0,0,0)
    }
    return new THREE.Mesh(box(W, thickness, D, 1.0, 'x'), material);
  }
  const roof = capMesh(tc, wallMat);
  roof.position.set(0, usesShapeCap ? zC + tc : zC + tc / 2, usesShapeCap ? 0 : D / 2);
  push(tag(roof, 'cabin', family.sku, isDe ? `Decke, ${family.ceiling_mm} mm ${itemTitle(catalog.woods[family.wall_wood])}` : `Ceiling, ${family.ceiling_mm} mm ${itemTitle(catalog.woods[family.wall_wood])}`, 0, [mm(W), mm(D), family.ceiling_mm], { includedIn: 'cabin' }));
  if (family.roof_colours?.length && catalog.roof_colours?.[cfg.roofColour]) {
    const roofColourSpec = catalog.roof_colours[cfg.roofColour];
    const shingleMat = materials.plain(`roofColour:${cfg.roofColour}`, { color: cfg.roofColour === 'red' ? 0x6b1f18 : 0x1c1d1f, roughness: 0.75, metalness: 0.05 });
    const shingles = new THREE.Mesh(box(W + 0.06, 0.03, D + 0.06, 1.0, 'x'), shingleMat);
    shingles.position.set(0, zC + tc + 0.015, D / 2);
    push(tag(shingles, 'cabin', cfg.roofColour, itemTitle(roofColourSpec), roofColourSpec.price, [mm(W + 0.06), 30, mm(D + 0.06)], { includedIn: 'cabin' }));
  }
  const floor = capMesh(0.045, trimMat);
  floor.position.set(0, usesShapeCap ? 0 : -0.0225, usesShapeCap ? 0 : D / 2);
  push(tag(floor, 'cabin', family.sku, isDe ? 'Saunaboden' : 'Floor', 0, [mm(W), mm(D), 45], { includedIn: 'cabin' }));

  if (cfg.cladding && cfg.cladding !== 'none') {
    const claddingSpec = catalog.claddings[cfg.cladding];
    const mat = cfg.cladding === 'schiefer' ? materials.slate : materials.wood('altholz', true);
    const thickness = cfg.cladding === 'schiefer' ? 0.012 : 0.02;
    for (const seg of segments) {
      if (seg.glass) continue;
      const holes = seg.openings.map(o => [o.u0 - 0.01, o.u1 + 0.01]);
      for (const [a, b] of subtractIntervals([0, seg.L], holes)) {
        const mesh = panel(seg, a, b, 0.002, zC + tc, mat, thickness, -thickness - 0.001);
        push(tag(mesh, 'cabin', `CLADDING-${cfg.cladding.toUpperCase()}`, itemTitle(claddingSpec), claddingSpec.price, [mm(seg.L), mm(thickness), mm(zC)]));
      }
    }
  }

  // ---- door leaf (pivots around the hinge) -------------------------------------
  const hinge = cfg.door.hinge;
  const sign = hinge === 'left' ? 1 : -1;               // leaf extends from the hinge along +d (left) or -d (right)
  const hingeU = hinge === 'left' ? doorInfo.u0 : doorInfo.u1;
  const hingePoint = add(doorSeg.p0, scale(doorSeg.d, hingeU));
  const doorRoot = new THREE.Group();
  const leafInset = t * 0.35;                           // inside the wall thickness, toward the outer face
  const hingeQ = add(hingePoint, scale(doorSeg.n, leafInset));
  doorRoot.position.set(hingeQ.x, 0, hingeQ.z);
  doorRoot.rotation.y = Math.atan2(-doorSeg.d.z, doorSeg.d.x);
  const leafW = doorW - 0.008, leafH = doorTop - 0.02;
  const leafGlass = new THREE.Mesh(box(leafW, leafH, 0.008), materials.glass);
  leafGlass.position.set(sign * leafW / 2, 0.012 + leafH / 2, 0);
  const handle = doorHandleMaterials(cfg, catalog, materials, benchMat);
  const handleX = sign * (leafW - 0.09);
  const handleIn = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.30, 14), handle.inside);
  handleIn.position.set(handleX, 1.01, -0.055);        // local +Z points outward, so the inside grip sits inside
  const handleOut = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.30, 14), handle.outside);
  handleOut.position.set(handleX, 1.01, 0.055);
  const doorParts = [leafGlass, handleIn, handleOut];
  for (const y of [0.91, 1.11]) {
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.12, 10), handle.mountMat);
    mount.rotation.x = Math.PI / 2; mount.position.set(handleX, y, 0);
    doorParts.push(mount);
  }
  for (const y of [0.32, leafH - 0.25]) {
    const clamp = new THREE.Mesh(box(0.05, 0.06, 0.024), handle.mountMat);
    clamp.position.set(sign * 0.03, y, 0);
    doorParts.push(clamp);
  }
  const doorName = isDe
    ? `Glastür 8 mm ESG, ${doorWmm} × ${doorHmm} mm, ${hinge === 'right' ? 'Rechtsanschlag' : 'Linksanschlag'}, ${itemTitle(handle.spec)}`
    : `Toughened glass door 8 mm, ${doorWmm} x ${doorHmm} mm, hinged ${hinge}, ${itemTitle(handle.spec)}`;
  for (const m of doorParts) { tag(m, 'door', family.sku, doorName, 0, [doorWmm, 8, doorHmm], { includedIn: 'cabin', hinge }); doorRoot.add(m); registry.push(m); }
  group.add(doorRoot);

  // ---- heater -------------------------------------------------------------------
  const heaterSpec = catalog.heaters[cfg.heater.sku];
  let heaterInfo = null, heaterZone = null;
  if (heaterSpec) {
    const [hwMm, hdMm, hhMm] = heaterSpec.dims_mm;
    const hw = hwMm / 1000, hd = hdMm / 1000, hh = hhMm / 1000;
    const position = cfg.heater.position;
    const atBack = position.startsWith('back') || position === 'centre_back';
    const clearance = 0.05;
    const wallZ = atBack ? ZB : ZF;
    const r = atBack ? 1 : -1;                          // into the room
    const gap = heaterSpec.mount === 'wall' ? 0 : 0.05;
    const zNear = wallZ + r * gap, zFar = wallZ + r * (gap + hd);
    const hz0 = Math.min(zNear, zFar), hz1 = Math.max(zNear, zFar);
    let hx0, hx1;
    if (position === 'centre_back') { hx0 = -hw / 2; hx1 = hw / 2; }
    else if (heaterSide > 0) { hx1 = X1 - clearance; hx0 = hx1 - hw; }
    else { hx0 = X0 + clearance; hx1 = hx0 + hw; }
    // Hex: clamp heater X to the TIGHTEST point over its whole depth. The hex
    // is narrowest at the wall the heater backs onto, so clamping at the
    // heater's mid-depth lets the wall-side end punch through the angled wall.
    if (isHex) {
      const maxX = innerHalfWidth(hz0, hz1);
      if (hx1 > maxX) { hx1 = maxX; hx0 = hx1 - hw; }
      if (hx0 < -maxX) { hx0 = -maxX; hx1 = hx0 + hw; }
    }
    const cx = (hx0 + hx1) / 2, cz = (hz0 + hz1) / 2;
    const base = heaterSpec.mount === 'wall' ? 0.15 : (cfg.accessories.includes('FLOOR-PLATE') ? 0.006 : 0);
    const bodyMat = heaterSpec.color === 'black' ? materials.black : materials.steel;
    const parts = [];
    let stonesY, stoneArea;
    if (heaterSpec.shape === 'cylinder') {
      const mantle = new THREE.Mesh(new THREE.CylinderGeometry(hw / 2, hw / 2, hh - 0.02, 40, 1, true), bodyMat);
      mantle.material = materials.plain('mantle' + heaterSpec.color, { color: heaterSpec.color === 'black' ? 0x15181b : 0x9aa3a8, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide });
      mantle.position.set(cx, base + 0.02 + (hh - 0.02) / 2, cz);
      parts.push(mantle);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(hw / 2 - 0.03, hw / 2 - 0.03, hh - 0.06, 24), materials.stones);
      inner.position.set(cx, base + hh / 2, cz);
      parts.push(inner);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(hw / 2 - 0.01, hw / 2 - 0.01, 0.02, 32), materials.black);
      foot.position.set(cx, base + 0.01, cz);
      parts.push(foot);
      stonesY = base + hh;
      stoneArea = [cx - hw / 2 + 0.05, cx + hw / 2 - 0.05, cz - hw / 2 + 0.05, cz + hw / 2 - 0.05];
    } else {
      const casing = new THREE.Mesh(box(hw, hh, hd), bodyMat);
      casing.position.set(cx, base + hh / 2, cz);
      parts.push(casing);
      const faceZ = cz + r * (hd / 2 + 0.004);
      const inset = new THREE.Mesh(box(hw * 0.86, hh * 0.66, 0.008), materials.darkGrille);
      inset.position.set(cx, base + hh * 0.42, faceZ);
      parts.push(inset);
      for (let i = 0; i < 6; i++) {
        const slot = new THREE.Mesh(box(hw * 0.7, 0.008, 0.004), materials.steel);
        slot.position.set(cx, base + hh * 0.15 + i * hh * 0.1, faceZ + r * 0.004);
        parts.push(slot);
      }
      const tray = new THREE.Mesh(box(hw - 0.015, 0.014, hd - 0.015), materials.black);
      tray.position.set(cx, base + hh + 0.007, cz);
      parts.push(tray);
      for (const y of [base + hh + 0.03, base + hh + 0.08]) {
        for (const z of [hz0 + 0.012, hz1 - 0.012]) {
          const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, hw - 0.012, 8), materials.steel);
          rail.rotation.z = Math.PI / 2; rail.position.set(cx, y, z); parts.push(rail);
        }
        for (const x of [hx0 + 0.006, hx1 - 0.006]) {
          const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, hd - 0.024, 8), materials.steel);
          rail.rotation.x = Math.PI / 2; rail.position.set(x, y, cz); parts.push(rail);
        }
      }
      stonesY = base + hh + 0.014;
      stoneArea = [hx0 + 0.03, hx1 - 0.03, hz0 + 0.03, hz1 - 0.03];
    }
    // stones
    const [sx0, sx1, sz0, sz1] = stoneArea;
    const cols = Math.max(2, Math.floor((sx1 - sx0) / 0.066)), rows = Math.max(2, Math.floor((sz1 - sz0) / 0.07));
    let seed = 49;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const stoneGeom = new THREE.IcosahedronGeometry(0.034, 1);
    for (let rI = 0; rI < rows; rI++) for (let c = 0; c < cols; c++) {
      const stone = new THREE.Mesh(stoneGeom, materials.stones);
      stone.position.set(sx0 + (c + 0.5) * (sx1 - sx0) / cols + (rnd() - 0.5) * 0.012, stonesY + 0.03 + rnd() * 0.02, sz0 + (rI + 0.5) * (sz1 - sz0) / rows + (rnd() - 0.5) * 0.012);
      stone.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      stone.scale.set(0.9 + rnd() * 0.3, 0.8 + rnd() * 0.3, 0.9 + rnd() * 0.3);
      parts.push(stone);
    }
    if (heaterSpec.control === 'integrated') {
      const ctrlX = cx - heaterSide * (hw / 2 + 0.016);
      const housing = new THREE.Mesh(box(0.032, 0.14, Math.min(0.157, hd * 0.7)), materials.black);
      housing.position.set(ctrlX, base + 0.12, cz);
      parts.push(housing);
      for (const dz of [-0.04, 0.04]) {
        const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.016, 20), materials.seal);
        dial.rotation.z = Math.PI / 2; dial.position.set(ctrlX - heaterSide * 0.024, base + 0.12, cz + dz);
        parts.push(dial);
      }
    }
    if (heaterSpec.combi) {
      const tank = new THREE.Mesh(box(0.09, hh * 0.6, hd * 0.8), bodyMat);
      tank.position.set(cx - heaterSide * (hw / 2 + 0.05), base + hh * 0.35, cz);
      parts.push(tank);
    }
    keepInside(parts);
    for (const p of parts) push(tag(p, 'heater', cfg.heater.sku, itemTitle(heaterSpec), heaterSpec.price, heaterSpec.dims_mm, { kw: heaterSpec.kw, control: heaterSpec.control, mount: heaterSpec.mount, approx: !!heaterSpec.approx }));
    if (heaterSpec.wood_fired && cfg.chimney && catalog.chimneys?.[cfg.chimney]) {
      const chimneySpec = catalog.chimneys[cfg.chimney];
      const flueParts = [];
      if (cfg.chimney === 'CHIMNEY-AUSSEN-130') {
        // External kit: routed up the outside of the heater-side wall, past the eaves.
        const flueX = heaterSide * (W / 2 + 0.09);
        const flueTop = H + 0.55;
        const vertical = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, flueTop - 0.1, 20), materials.black);
        vertical.position.set(flueX, 0.1 + (flueTop - 0.1) / 2, cz);
        flueParts.push(vertical);
        const elbow = new THREE.Mesh(box(Math.abs(flueX - cx) + 0.13, 0.13, 0.13), materials.black);
        elbow.position.set((flueX + cx) / 2, 0.16, cz);
        flueParts.push(elbow);
      } else {
        const flueTop = zC + tc + 0.5;
        const vertical = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, flueTop - (base + hh), 24), materials.black);
        vertical.position.set(cx, base + hh + (flueTop - (base + hh)) / 2, cz);
        flueParts.push(vertical);
      }
      for (const p of flueParts) push(tag(p, 'heater', cfg.chimney, itemTitle(chimneySpec), chimneySpec.price, chimneySpec.dims_mm, { includedIn: 'heater' }));
    }
    heaterInfo = { cx, cz, hz0, hz1, base, hh, atBack, stonesTop: stonesY + 0.08, hw, hd };
    const gz0 = Math.max(hz0 - clearance, ZB), gz1 = Math.min(hz1 + clearance, ZF);
    // Clamp the guard zone to the real inner width over its own z-span so the
    // rails/posts don't run out through a hex's angled wall.
    const guardLim = innerHalfWidth(gz0, gz1);
    const gx0 = Math.max(hx0 - clearance, -guardLim), gx1 = Math.min(hx1 + clearance, guardLim);
    heaterZone = { x0: gx0 - 0.02, x1: gx1 + 0.02, z0: gz0 - 0.02, z1: gz1 + 0.02 };
    if (heaterSpec.guard) {
      const guardY = heaterSpec.mount === 'wall' ? 0.72 : Math.min(0.9, base + hh * 0.85);
      const rails = [];
      if (gx0 > X0 + 0.02) rails.push([gx0, (gz0 + gz1) / 2, 0.035, gz1 - gz0 + 0.035]);
      if (gx1 < X1 - 0.02) rails.push([gx1, (gz0 + gz1) / 2, 0.035, gz1 - gz0 + 0.035]);
      if (atBack ? gz1 < ZF - 0.02 : gz0 > ZB + 0.02) rails.push([(gx0 + gx1) / 2, atBack ? gz1 : gz0, gx1 - gx0 + 0.035, 0.035]);
      const guardParts = [];
      for (const [px, pz, sx, sz] of rails) { const rail = new THREE.Mesh(box(sx, 0.038, sz), benchMat); rail.position.set(px, guardY - 0.019, pz); guardParts.push(rail); }
      for (const [px, pz] of [[gx0, gz0], [gx0, gz1], [gx1, gz0], [gx1, gz1]]) {
        if ((px <= X0 + 0.02 || px >= X1 - 0.02) && (pz <= ZB + 0.02 || pz >= ZF - 0.02)) continue;
        const post = new THREE.Mesh(box(0.028, guardY - 0.04, 0.028), benchMat);
        post.position.set(px, (guardY - 0.04) / 2, pz); guardParts.push(post);
      }
      keepInside(guardParts);
      for (const p of guardParts) push(tag(p, 'interior', 'GUARD', 'Heater guard (included)', 0, [mm(gx1 - gx0), mm(gz1 - gz0), mm(guardY)], { includedIn: 'cabin' }));
    }
  }

  // ---- wall control unit ---------------------------------------------------------
  const controlSpec = cfg.control !== 'none' ? catalog.controls[cfg.control] : null;
  if (controlSpec && heaterInfo) {
    const [cwMm, cdMm, chMm] = controlSpec.dims_mm;
    const cw = cwMm / 1000, cd = cdMm / 1000, ch = chMm / 1000;
    const z = heaterInfo.atBack ? ZB + 0.25 : ZF - 0.25;
    // Mounted on the exterior face of the heater-side wall. On a hex that wall
    // is angled and sits well inside W/2 at this depth, so anchor to the real
    // inner width there instead of the bounding box.
    const x = heaterSide * ((isHex ? innerHalfWidth(z) + t : W / 2) + cd / 2);
    const y = 1.35;
    const isGlass = controlSpec.series === 'glass';
    const body = controlSpec.color === 'white' ? materials.white : controlSpec.color === 'wood' ? benchMat : materials.black;
    const faceMat = isGlass ? (controlSpec.color === 'mirror' ? materials.mirror : controlSpec.color === 'gold' ? materials.gold : materials.black) : body;
    const unit = new THREE.Mesh(box(cd, ch, cw), body);
    unit.position.set(x, y, z);
    const face = new THREE.Mesh(box(0.002, ch - 0.006, cw - 0.006), faceMat);
    face.position.set(x + heaterSide * (cd / 2 + 0.001), y, z);
    const screen = new THREE.Mesh(box(0.002, ch * 0.28, cw * 0.6), materials.screen);
    screen.position.set(x + heaterSide * (cd / 2 + 0.0025), y + ch * 0.12, z);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.006, 20), materials.steel);
    dial.rotation.z = Math.PI / 2; dial.position.set(x + heaterSide * (cd / 2 + 0.004), y - ch * 0.25, z);
    for (const m of [unit, face, screen, dial]) push(tag(m, 'control', cfg.control, itemTitle(controlSpec), controlSpec.price, controlSpec.dims_mm, { wifi: !!controlSpec.wifi, series: controlSpec.series || '' }));
    const sensor = new THREE.Mesh(box(0.03, 0.06, 0.02), materials.white);
    sensor.position.set(heaterInfo.cx, Math.min(zC - 0.12, heaterInfo.base + heaterInfo.hh + 0.35), heaterInfo.atBack ? ZB + 0.011 : ZF - 0.011);
    push(tag(sensor, 'control', cfg.control, `Temperature sensor for ${itemTitle(controlSpec)}`, 0, [30, 20, 60], { includedIn: cfg.control }));
  }

  // ---- benches ------------------------------------------------------------------
  const upperD = cfg.interior.upperDepthCm / 100, lowerD = cfg.interior.lowerDepthCm / 100;
  const upperY = cfg.interior.upperHeightCm / 100, lowerY = cfg.interior.lowerHeightCm / 100;
  const layout = cfg.interior.layout;
  const slatT = interiorSpec.slat_mm / 1000;
  const benches = [];
  const benchLabel = `${interiorName}`;

  /** Slatted bench top on a support frame. along: 'x' slats run across X, 'z' along Z. */
  function bench(x0, x1, z0, z1, yTop, along, apron) {
    const parts = [];
    const slatW = 0.078, gap = 0.008;
    if (along === 'x') {
      const depth = z1 - z0, count = Math.max(1, Math.floor((depth + gap) / (slatW + gap))), pitch = depth / count;
      for (let i = 0; i < count; i++) { const s = new THREE.Mesh(box(x1 - x0, slatT, pitch - gap, 1, 'x'), benchMat); s.position.set((x0 + x1) / 2, yTop - slatT / 2, z0 + (i + 0.5) * pitch); parts.push(s); }
      const supports = [x0 + 0.04, x1 - 0.04];
      const extra = Math.floor((x1 - x0) / 0.85);
      for (let i = 1; i <= extra; i++) supports.push(x0 + (x1 - x0) * i / (extra + 1));
      for (const x of supports) {
        const sup = new THREE.Mesh(box(0.045, 0.048, depth - 0.02), benchMat); sup.position.set(x, yTop - slatT - 0.024, (z0 + z1) / 2); parts.push(sup);
        for (const z of [z0 + 0.035, z1 - 0.035]) { const leg = new THREE.Mesh(box(0.045, yTop - slatT - 0.048, 0.045), benchMat); leg.position.set(x, (yTop - slatT - 0.048) / 2, z); parts.push(leg); }
      }
      if (apron) { const a = new THREE.Mesh(box(x1 - x0, 0.10, 0.028, 1, 'x'), benchMat); a.position.set((x0 + x1) / 2, yTop - slatT - 0.05, z1 - 0.014); parts.push(a); }
    } else {
      const width = x1 - x0, count = Math.max(1, Math.floor((width + gap) / (slatW + gap))), pitch = width / count;
      for (let i = 0; i < count; i++) { const s = new THREE.Mesh(box(pitch - gap, slatT, z1 - z0, 1, 'y'), benchMat); s.position.set(x0 + (i + 0.5) * pitch, yTop - slatT / 2, (z0 + z1) / 2); parts.push(s); }
      const supports = [z0 + 0.04, z1 - 0.04];
      const extra = Math.floor((z1 - z0) / 0.85);
      for (let i = 1; i <= extra; i++) supports.push(z0 + (z1 - z0) * i / (extra + 1));
      for (const z of supports) {
        const sup = new THREE.Mesh(box(width - 0.02, 0.048, 0.045), benchMat); sup.position.set((x0 + x1) / 2, yTop - slatT - 0.024, z); parts.push(sup);
        for (const x of [x0 + 0.035, x1 - 0.035]) { const leg = new THREE.Mesh(box(0.045, yTop - slatT - 0.048, 0.045), benchMat); leg.position.set(x, (yTop - slatT - 0.048) / 2, z); parts.push(leg); }
      }
      if (apron) { const innerX = x0 > 0 ? x0 + 0.014 : x1 - 0.014; const a = new THREE.Mesh(box(0.028, 0.10, z1 - z0), benchMat); a.position.set(innerX, yTop - slatT - 0.05, (z0 + z1) / 2); parts.push(a); }
    }
    return parts;
  }
  function cladding(a, b, fixed, y0, y1, along) {
    const parts = [], slatW = 0.07, gap = 0.009;
    const count = Math.max(1, Math.floor((b - a + gap) / (slatW + gap))), pitch = (b - a) / count;
    for (let i = 0; i < count; i++) {
      const p = a + (i + 0.5) * pitch;
      const s = along === 'x' ? new THREE.Mesh(box(pitch - gap, y1 - y0, 0.014), benchMat) : new THREE.Mesh(box(0.014, y1 - y0, pitch - gap), benchMat);
      if (along === 'x') s.position.set(p, (y0 + y1) / 2, fixed); else s.position.set(fixed, (y0 + y1) / 2, p);
      parts.push(s);
    }
    return parts;
  }
  function backrest(a, b, wall, y = 1.04) {
    const parts = [];
    // Side rails run along z from a to b against the left/right wall. On a hex
    // that wall is angled, so anchor them to the narrowest inner width over
    // the span rather than to the bounding box edge (X0/X1), which only
    // touches the wall at the hex's widest point (z = D/2).
    const sideX = innerHalfWidth(a, b);
    for (const yy of [y, y + 0.13]) {
      let s;
      if (wall === 'back') { s = new THREE.Mesh(box(b - a, 0.095, 0.027, 1, 'x'), benchMat); s.position.set((a + b) / 2, yy + 0.0475, ZB + 0.045 + 0.0135); }
      else { s = new THREE.Mesh(box(0.027, 0.095, b - a, 1, 'y'), benchMat); s.position.set(wall === 'left' ? -sideX + 0.045 + 0.0135 : sideX - 0.045 - 0.0135, yy + 0.0475, (a + b) / 2); }
      parts.push(s);
    }
    for (const p of [a + 0.06, b - 0.06]) {
      const st = new THREE.Mesh(box(0.045, 0.265, 0.045), benchMat);
      if (wall === 'back') st.position.set(p, y + 0.11, ZB + 0.0225); else st.position.set(wall === 'left' ? -sideX + 0.0225 : sideX - 0.0225, y + 0.11, p);
      parts.push(st);
    }
    return parts;
  }
  function headrest(x, z, y, along) {
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const rise = 0.03 + i * 0.015;
      const s = along === 'x' ? new THREE.Mesh(box(0.40, 0.016, 0.05), benchMat) : new THREE.Mesh(box(0.05, 0.016, 0.40), benchMat);
      if (along === 'x') s.position.set(x, y + rise / 2 + 0.008, z + 0.12 - i * 0.06); else s.position.set(x - 0.12 + i * 0.06, y + rise / 2 + 0.008, z);
      parts.push(s);
    }
    for (const p of [-0.17, 0.17]) {
      const side = along === 'x' ? new THREE.Mesh(box(0.02, 0.06, 0.30), benchMat) : new THREE.Mesh(box(0.30, 0.06, 0.02), benchMat);
      if (along === 'x') side.position.set(x + p, y + 0.03, z); else side.position.set(x, y + 0.03, z + p);
      parts.push(side);
    }
    return parts;
  }

  const tagInterior = (parts, name, dims, price = 0) => { for (const m of parts) push(tag(m, 'interior', cfg.interior.material, name, price, dims, price ? {} : { includedIn: 'cabin' })); };

  // side benches (L / U)
  const sideBenches = [];
  if (layout === 'L' || layout === 'U') {
    const sides = layout === 'L' ? [-heaterSide] : [-1, 1];
    for (const s of sides) {
      let zBack = ZB + upperD, zFront = ZF - 0.30;
      // Hex: the side walls are angled, so pull the bench's outer edge in to the
      // narrowest inner width over its z-span rather than sitting it on the
      // bounding box edge, which only touches the wall at the hex's widest point.
      const outerX = innerHalfWidth(zBack, zFront);
      let x0 = s < 0 ? -outerX : outerX - upperD;
      let x1 = s < 0 ? -outerX + upperD : outerX;
      if (x1 - x0 < 0.3) continue;   // no usable width left against this wall
      if (heaterZone && heaterZone.x0 < x1 && heaterZone.x1 > x0) {
        if ((heaterZone.z0 + heaterZone.z1) / 2 > (zBack + zFront) / 2) zFront = Math.min(zFront, heaterZone.z0 - 0.03);
        else zBack = Math.max(zBack, heaterZone.z1 + 0.03);
      }
      if (zFront - zBack < 0.45) continue;
      tagInterior(bench(x0, x1, zBack, zFront, upperY, 'z', cfg.interior.apron), isDe ? `Seitenbank, ${benchLabel}` : `Side bench, ${benchLabel}`, [mm(x1 - x0), mm(zFront - zBack), mm(upperY)]);
      sideBenches.push({ s, x0, x1, zBack, zFront });
      if (cfg.interior.backrests) tagInterior(backrest(zBack + 0.02, zFront - 0.02, s < 0 ? 'left' : 'right'), isDe ? `Seitliche Rückenlehne, ${benchLabel}` : `Side backrest, ${benchLabel}`, [27, 220, mm(zFront - zBack)]);
      if (cfg.interior.apron) tagInterior(cladding(zBack, zFront, s < 0 ? x1 + 0.007 : x0 - 0.007, 0.10, upperY - slatT - 0.10, 'z'), isDe ? 'Zwischenbankblende (inbegriffen)' : 'Under-bench cladding (included)', [14, mm(upperY - 0.2), mm(zFront - zBack)]);
    }
  }
  // main upper bench along the back wall
  let bx0 = X0 + (sideBenches.some(b => b.s < 0) ? upperD : 0);
  let bx1 = X1 - (sideBenches.some(b => b.s > 0) ? upperD : 0);
  if (heaterZone && heaterZone.z0 < ZB + upperD + 0.03) { if (heaterZone.x0 > 0) bx1 = Math.min(bx1, heaterZone.x0); else bx0 = Math.max(bx0, heaterZone.x1); }
  // Hex: clamp bench width to fit inside the angled walls. The hex narrows
  // toward z=0 (the back wall), so the bench's back edge (uz0=ZB) is the
  // tightest constraint, not the midpoint of its depth - using the midpoint
  // let the bench poke through the angled corner walls near the back.
  if (isHex) {
    const maxX = Math.min(hexMaxInnerX(ZB, W, D, t), hexMaxInnerX(ZB + upperD, W, D, t));
    bx0 = Math.max(bx0, -maxX);
    bx1 = Math.min(bx1, maxX);
  }
  const uz0 = ZB, uz1 = ZB + upperD;
  tagInterior(bench(bx0, bx1, uz0, uz1, upperY, 'x', cfg.interior.apron), isDe ? `Obere Liegebank ${cfg.interior.upperDepthCm} cm, ${benchLabel}` : `Upper bench ${cfg.interior.upperDepthCm} cm, ${benchLabel}`, [mm(bx1 - bx0), mm(upperD), mm(upperY)], interiorSpec.price);
  benches.push({ x0: bx0, x1: bx1, z0: uz0, z1: uz1, y: upperY });
  if (cfg.interior.backrests) {
    tagInterior(backrest(bx0 + 0.02, bx1 - 0.02, 'back'), isDe ? `Rückenlehne, ${benchLabel}` : `Backrest, ${benchLabel}`, [mm(bx1 - bx0), 220, 27]);
    if (cfg.interior.sideBackrests && layout === 'straight') {
      for (const s of [-1, 1]) {
        if (heaterZone && ((s > 0 && heaterZone.x1 > X1 - 0.1 && heaterZone.z0 < ZB + upperD) || (s < 0 && heaterZone.x0 < X0 + 0.1 && heaterZone.z0 < ZB + upperD))) continue;
        tagInterior(backrest(ZB + 0.05, ZB + upperD, s < 0 ? 'left' : 'right'), isDe ? `Seitliche Rückenlehne, ${benchLabel}` : `Side backrest, ${benchLabel}`, [27, 220, mm(upperD)]);
      }
    }
  }
  // lower bench / sliding stool in front of the upper bench
  let lz0 = uz1, lz1 = uz1 + lowerD, lx0 = bx0, lx1 = bx1;
  if (heaterZone && heaterZone.z1 > lz0 - 0.03 && heaterZone.z0 < lz1 + 0.03) { if (heaterZone.x0 > 0) lx1 = Math.min(lx1, heaterZone.x0); else lx0 = Math.max(lx0, heaterZone.x1); }
  if (isHex) {
    const maxX = Math.min(hexMaxInnerX(lz0, W, D, t), hexMaxInnerX(lz1, W, D, t));
    lx0 = Math.max(lx0, -maxX); lx1 = Math.min(lx1, maxX);
  }
  let lowerBench = null;
  if (lx1 - lx0 > 0.5 && lz1 < ZF - 0.45) {
    tagInterior(bench(lx0 + 0.01, lx1 - 0.01, lz0, lz1, lowerY, 'x', true), isDe ? `Untere Bank${cfg.interior.slidingStool ? ' (Vorrückbank)' : ''} ${cfg.interior.lowerDepthCm} cm, ${benchLabel}` : `Lower bench${cfg.interior.slidingStool ? ' (sliding stool)' : ''} ${cfg.interior.lowerDepthCm} cm, ${benchLabel}`, [mm(lx1 - lx0), mm(lowerD), mm(lowerY)]);
    lowerBench = { x0: lx0, x1: lx1, z0: lz0, z1: lz1, y: lowerY };
  }
  if (cfg.interior.apron) {
    const spans = [];
    if (lowerBench) {
      if (lowerBench.x0 - bx0 > 0.05) spans.push([bx0, lowerBench.x0 - 0.01, 0.10]);
      spans.push([lowerBench.x0, lowerBench.x1, lowerY + 0.01]);
      if (bx1 - lowerBench.x1 > 0.05) spans.push([lowerBench.x1 + 0.01, bx1, 0.10]);
    } else spans.push([bx0, bx1, 0.10]);
    for (const [a, b, y0] of spans) tagInterior(cladding(a, b, uz1 - 0.007, y0, upperY - slatT - 0.10, 'x'), isDe ? 'Zwischenbankblende (inbegriffen)' : 'Under-bench cladding (included)', [mm(b - a), mm(upperY - 0.2), 14]);
  }
  // headrests
  const headrests = Number(cfg.interior.headrests) || 0;
  let placed = 0;
  if (headrests && sideBenches.length) {
    const sb = sideBenches[0];
    const hz = sb.zFront - 0.25;
    // The headrest is ~0.3 wide and spans +/-0.2 in z; keep it inside the
    // narrowest wall position over that span (matters on a hex).
    const lim = innerHalfWidth(hz - 0.2, hz + 0.2) - 0.17;
    const hx = Math.max(-lim, Math.min(lim, (sb.x0 + sb.x1) / 2));
    tagInterior(headrest(hx, hz, upperY, 'z'), isDe ? 'Kopfstütze (inbegriffen)' : 'Headrest (included)', [400, 60, 300]);
    placed++;
  }
  if (headrests > placed) {
    const x = (sideBenches.length && sideBenches[0].s > 0) || !sideBenches.length ? bx0 + 0.30 : bx1 - 0.30;
    tagInterior(headrest(x, uz0 + upperD / 2, upperY, 'x'), isDe ? 'Kopfstütze (inbegriffen)' : 'Headrest (included)', [400, 60, 300]); placed++;
    if (headrests > placed && bx1 - bx0 > 1.2) tagInterior(headrest(x < 0 ? bx1 - 0.30 : bx0 + 0.30, uz0 + upperD / 2, upperY, 'x'), isDe ? 'Kopfstütze (inbegriffen)' : 'Headrest (included)', [400, 60, 300]);
  }
  // floor grating
  if (cfg.interior.floorGrate) {
    const gzBack = (lowerBench ? lowerBench.z1 : uz1) + 0.02, gzFront = ZF - 0.02;
    let gx0 = X0 + 0.02 + (sideBenches.some(b => b.s < 0) ? upperD : 0), gx1 = X1 - 0.02 - (sideBenches.some(b => b.s > 0) ? upperD : 0);
    if (heaterZone && heaterZone.z1 > gzBack && heaterZone.z0 < gzFront) { if (heaterZone.x0 > 0) gx1 = Math.min(gx1, heaterZone.x0 - 0.02); else gx0 = Math.max(gx0, heaterZone.x1 + 0.02); }
    if (isHex) { const maxX = Math.min(hexMaxInnerX(gzBack, W, D, t), hexMaxInnerX(gzFront, W, D, t)); gx0 = Math.max(gx0, -maxX); gx1 = Math.min(gx1, maxX); }
    if (gzFront - gzBack > 0.2 && gx1 - gx0 > 0.3) {
      const parts = [];
      for (const x of [gx0 + 0.05, gx1 - 0.05, (gx0 + gx1) / 2]) { const r = new THREE.Mesh(box(0.045, 0.028, gzFront - gzBack), benchMat); r.position.set(x, 0.014, (gzBack + gzFront) / 2); parts.push(r); }
      const count = Math.floor((gzFront - gzBack) / 0.075);
      for (let i = 0; i < count; i++) { const s = new THREE.Mesh(box(gx1 - gx0, 0.022, 0.06, 1, 'x'), benchMat); s.position.set((gx0 + gx1) / 2, 0.028 + 0.011, gzBack + (i + 0.5) * (gzFront - gzBack) / count); parts.push(s); }
      for (const m of parts) push(tag(m, 'interior', 'FLOOR-GRATE', isDe ? 'Bodenrost (inbegriffen)' : 'Floor grating (included)', 0, [mm(gx1 - gx0), mm(gzFront - gzBack), 50], { includedIn: 'cabin' }));
    }
  }

  // ---- lighting ------------------------------------------------------------------
  const lampSide = -heaterSide;
  for (const sku of cfg.lighting) {
    const spec = catalog.lighting[sku];
    if (!spec) continue;
    const parts = [];
    if (spec.kind === 'wall_lamp') {
      let wallX = lampSide < 0 ? X0 : X1, z = ZF - 0.42, y = 1.62;
      if (isHex) { const maxX = hexMaxInnerX(z, W, D, t); wallX = lampSide < 0 ? Math.max(wallX, -maxX) : Math.min(wallX, maxX); }
      const espe = materials.wood('espe');
      const mount = new THREE.Mesh(box(0.026, 0.315, 0.235), espe); mount.position.set(wallX - lampSide * 0.013, y, z); parts.push(mount);
      const diffuser = new THREE.Mesh(box(0.05, 0.25, 0.19), materials.opal); diffuser.position.set(wallX - lampSide * 0.055, y, z); parts.push(diffuser);
      for (let i = 0; i < 7; i++) { const s = new THREE.Mesh(box(0.012, 0.30, 0.022), espe); s.position.set(wallX - lampSide * 0.104, y, z - 0.105 + i * 0.035); parts.push(s); }
      const light = new THREE.PointLight(0xffb066, 7, 2.6, 2); light.position.set(wallX - lampSide * 0.07, y, z); group.add(light);
    } else if (spec.kind === 'backrest_strip' && benches.length) {
      const b = benches[0], len = Math.min(spec.length_m, b.x1 - b.x0 - 0.1);
      const strip = new THREE.Mesh(box(len, 0.004, 0.012), materials.ledWarm); strip.position.set((b.x0 + b.x1) / 2, 1.04 + 0.13 + 0.095 + 0.006, ZB + 0.03); parts.push(strip);
      const light = new THREE.PointLight(0xffb066, 5, 2.2, 2);
      light.position.set((b.x0 + b.x1) / 2, 1.3, ZB + 0.06);
      group.add(light);
    } else if (spec.kind === 'under_bench' && benches.length) {
      const b = benches[0], n = spec.strips, span = b.x1 - b.x0 - 0.2, pitch = span / n;
      for (let i = 0; i < n; i++) { const s = new THREE.Mesh(box(Math.min(0.67, pitch - 0.02), 0.005, 0.012), materials.ledRgb); s.position.set(b.x0 + 0.1 + (i + 0.5) * pitch, upperY - slatT - 0.11, uz1 - 0.03); parts.push(s); }
      const light = new THREE.PointLight(0xb28cff, 4, 1.8, 2); light.position.set((b.x0 + b.x1) / 2, upperY - 0.2, uz1 + 0.05); group.add(light);
    } else continue;
    keepInside(parts);
    for (const m of parts) push(tag(m, 'lighting', sku, itemTitle(spec), spec.price, spec.dims_mm));
  }

  // ---- infrared emitter add-on (wall-mounted panel behind the backrest) ------------
  if (cfg.infrared && catalog.infrared?.[cfg.infrared] && benches.length) {
    const irSpec = catalog.infrared[cfg.infrared];
    const [iwMm, idMm, ihMm] = irSpec.dims_mm;
    const iw = iwMm / 1000, id = idMm / 1000, ih = ihMm / 1000;
    const count = irSpec.count || 1;
    const b = benches[0];
    const glowMat = irSpec.color === 'red' ? materials.plain('irRed', { color: 0x3a0c08, roughness: 0.5, emissive: 0xff3a1a, emissiveIntensity: 1.8 }) : materials.plain('irBlack', { color: 0x0c0c0d, roughness: 0.35, metalness: 0.3, emissive: 0xb23a1a, emissiveIntensity: 0.9 });
    const centres = count > 1 ? [(b.x0 + b.x1) / 2 - iw * 0.7, (b.x0 + b.x1) / 2 + iw * 0.7] : [(b.x0 + b.x1) / 2];
    for (const x of centres) {
      const panelMesh = new THREE.Mesh(box(iw, ih, id), glowMat);
      panelMesh.position.set(Math.min(Math.max(x, X0 + iw / 2 + 0.05), X1 - iw / 2 - 0.05), 1.0 + ih / 2, ZB + id / 2 + 0.006);
      push(tag(panelMesh, 'heater', cfg.infrared, itemTitle(irSpec), irSpec.price, irSpec.dims_mm, { watts: irSpec.watts }));
    }
  }

  // ---- accessories -----------------------------------------------------------------
  for (const sku of cfg.accessories) {
    const spec = catalog.accessories[sku];
    if (!spec) continue;
    const parts = [];
    if (spec.kind === 'set') {
      const r = spec.bucket_l >= 5 ? 0.11 : 0.095;
      let x = heaterZone ? (heaterSide > 0 ? heaterZone.x0 - 0.22 : heaterZone.x1 + 0.22) : 0.3, z = ZF - 0.30;
      if (isHex) { const maxX = hexMaxInnerX(z, W, D, t); x = Math.max(-maxX + 0.15, Math.min(maxX - 0.15, x)); }
      const bucket = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.88, 0.20, 24), spec.bucket === 'black' ? materials.black : materials.wood('fichte')); bucket.position.set(x, 0.10 + 0.05, z); parts.push(bucket);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(r, 0.005, 8, 24, Math.PI), materials.steel); handle.position.set(x, 0.24, z); parts.push(handle);
      const ladle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.42, 10), materials.wood('fichte')); ladle.position.set(x - 0.05, 0.28, z - 0.03); ladle.rotation.z = 0.5; ladle.rotation.x = 0.3; parts.push(ladle);
      if (!spec.no_wall) {
        let wx = -heaterSide * (W / 2 - t - 0.3);
        if (isHex) { const maxX = hexMaxInnerX(ZB + 0.02, W, D, t); wx = Math.max(-maxX + 0.10, Math.min(maxX - 0.10, wx)); }
        const station = new THREE.Mesh(box(0.14, 0.20, 0.024), materials.wood('espe')); station.position.set(wx, 1.58, ZB + 0.012); parts.push(station);
        const dials = new THREE.Mesh(box(0.10, 0.16, 0.004), materials.white); dials.position.set(wx, 1.58, ZB + 0.026); parts.push(dials);
        const hourglass = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 12), materials.glass); hourglass.position.set(wx + heaterSide * 0.25, 1.52, ZB + 0.024); parts.push(hourglass);
      }
    } else if (spec.kind === 'evaporator' && heaterInfo) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.09, 0.10, 24), materials.ceramic); pot.position.set(heaterInfo.cx, heaterInfo.stonesTop + 0.05, heaterInfo.cz); parts.push(pot);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 10), materials.steel); stand.position.set(heaterInfo.cx, heaterInfo.stonesTop - 0.02, heaterInfo.cz); parts.push(stand);
    } else if (spec.kind === 'speakers') {
      let spX0 = X0 + 0.25, spX1 = X1 - 0.25;
      if (isHex) { const maxX = hexMaxInnerX(ZB + 0.04, W, D, t); spX0 = Math.max(spX0, -maxX + 0.15); spX1 = Math.min(spX1, maxX - 0.15); }
      for (const x of [spX0, spX1]) {
        const frame2 = new THREE.Mesh(box(0.20, 0.20, 0.07), materials.wood('erle')); frame2.position.set(x, zC - 0.16, ZB + 0.035); parts.push(frame2);
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.006, 24), materials.white); cone.rotation.x = Math.PI / 2; cone.position.set(x, zC - 0.16, ZB + 0.073); parts.push(cone);
      }
    } else if (spec.kind === 'ergo_backrest' && benches.length) {
      const b = benches[0], x = heaterSide > 0 ? b.x0 + 0.45 : b.x1 - 0.45;
      for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(box(0.52, 0.02, 0.05), materials.wood('pappel')); s.position.set(x, b.y + 0.02 + i * 0.011, b.z1 - 0.08 - i * 0.062); parts.push(s); }
    } else if (spec.kind === 'foot_mat' && lowerBench) {
      const mat = new THREE.Mesh(box(0.61, 0.008, 0.41), materials.darkGrille); mat.position.set((lowerBench.x0 + lowerBench.x1) / 2, 0.055, lowerBench.z1 + 0.35); parts.push(mat);
    } else if (spec.kind === 'plunge_tub') {
      const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.55, 1.0, 32), materials.wood('laerche')); tub.scale.z = 0.7; tub.position.set(-heaterSide * (W / 2 + 0.9), 0.5, D / 2); parts.push(tub);
    } else if (spec.kind === 'plunge_lid') {
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.61, 0.61, 0.03, 32), materials.wood('laerche')); lid.scale.z = 0.7; lid.position.set(-heaterSide * (W / 2 + 0.9), 1.015, D / 2); parts.push(lid);
    } else continue;
    keepInside(parts);
    for (const m of parts) push(tag(m, 'accessory', sku, itemTitle(spec), spec.price, spec.dims_mm, { approx: !!spec.approx }));
  }

  // ---- ventilation -------------------------------------------------------------------
  if (cfg.ventilation && heaterInfo) {
    const supplyZ = heaterInfo.atBack ? ZB + 0.011 : ZF - 0.011;
    const supply = new THREE.Mesh(box(0.15, 0.10, 0.022), benchMat); supply.position.set(heaterInfo.cx, 0.15, supplyZ);
    push(tag(supply, 'cabin', 'VENT', isDe ? 'Zuluftschieber (inbegriffen)' : 'Supply air vent (included)', 0, [150, 24, 100], { includedIn: 'cabin' }));
    const exhaustZ = heaterInfo.atBack ? ZF - 0.011 : ZB + 0.011;
    const exhaust = new THREE.Mesh(box(0.20, 0.10, 0.022), benchMat); exhaust.position.set(-heaterSide * (W / 2 - t - 0.25), zC - 0.20, exhaustZ);
    push(tag(exhaust, 'cabin', 'VENT', isDe ? 'Abluftschieber (inbegriffen)' : 'Exhaust air vent (included)', 0, [200, 24, 100], { includedIn: 'cabin' }));
  }

  const bounds = { minX: -W / 2, maxX: W / 2, minZ: 0, maxZ: D, minY: 0, maxY: H };
  // Hex families narrow toward the front/back walls (see hexMaxInnerX) - the
  // generic entrance-at-+Z formula below assumes the full bounding width is
  // usable right up to the front wall, which for a hex puts the camera close
  // to or past the angled corner walls. Anchor it to the hex's actual usable
  // width at that depth instead.
  const interiorView = isHex ? (() => {
    // A straight shot down the centreline points the camera at the narrow
    // back wall from close range, filling the frame with one flat surface
    // (the same issue fixed for the barrel's back cap) - look diagonally
    // across the room at the bench/heater instead.
    const camZ = ZF - 0.35, lookZ = ZB + 0.5;
    const camMaxX = hexMaxInnerX(camZ, W, D, t) - 0.25;
    const lookMaxX = hexMaxInnerX(lookZ, W, D, t) - 0.2;
    return {
      pos: new THREE.Vector3(Math.min(camMaxX, 0.55) * heaterSide, 1.4, camZ),
      look: new THREE.Vector3(-Math.min(lookMaxX, 0.5) * heaterSide, 0.95, lookZ),
    };
  })() : undefined;
  return { group, registry, bounds, doorRoot, doorSign: sign, heaterInfo, familyName, interiorView };
}
