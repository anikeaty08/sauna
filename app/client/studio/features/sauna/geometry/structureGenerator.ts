import * as THREE from 'three';
import type { Layout, Segment, Vec2 } from '../../../../../../packages/configuration-core/index.ts';
import { TEXTURE_METRES } from '../materials/materialLibrary.ts';
import { PlanFrame, facingMatrix } from './placement.ts';

/**
 * Procedural parts: everything whose shape is a direct function of the
 * footprint (walls, glass panes, fascia, roof, ceiling, floor). Built as plain
 * BufferGeometry in a segment-local frame (X along the segment, Y up, +Z
 * outward), then placed with the segment's matrix.
 */

/** World-scale box-projected UVs, divided by the texture's real size. */
export function boxUV(geo: THREE.BufferGeometry, uMetres: number, vMetres: number, grain: 'x' | 'y' = 'x') {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const n = [Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i))];
    const axis = n.indexOf(Math.max(...n));
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    // in-plane axes of this face; grain axis first where possible
    let [a, b] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
    if (grain === 'y' && (a === 1 || b === 1)) [a, b] = a === 1 ? [a, b] : [b, a];
    uv[i * 2] = p[a] / uMetres;
    uv[i * 2 + 1] = p[b] / vMetres;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Axis-aligned box geometry spanning [x0,x1] x [y0,y1] x [z0,z1]. */
export function boxGeometry(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const g = new THREE.BoxGeometry(Math.max(x1 - x0, 1e-4), Math.max(y1 - y0, 1e-4), Math.max(z1 - z0, 1e-4));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

export function segmentMatrix(frame: PlanFrame, seg: Segment, along = 0, inset = 0): THREE.Matrix4 {
  const p: Vec2 = [seg.a[0] + seg.dir[0] * along + seg.inward[0] * inset, seg.a[1] + seg.dir[1] * along + seg.inward[1] * inset];
  return facingMatrix(frame.point(p), frame.dir([-seg.inward[0], -seg.inward[1]]));
}

export interface StructureMaterials { zirbe: THREE.Material; slate: THREE.Material; glass: THREE.Material; floor: THREE.Material }

/** Solid wall: 40 mm Zirbe, outer face on the footprint line, boards inside. */
export function solidWall(frame: PlanFrame, seg: Segment, layout: Layout, mats: StructureMaterials): THREE.Mesh {
  const [bu, bv] = TEXTURE_METRES.zirbe;
  const geo = boxUV(boxGeometry(0, seg.length, 0, layout.height - layout.fascia, -layout.wall, 0), bu, bv);
  const mesh = new THREE.Mesh(geo, mats.zirbe);
  mesh.applyMatrix4(segmentMatrix(frame, seg));
  mesh.name = `wall_${seg.id}`;
  return mesh;
}

/** Glass pane on the wall's centre plane, between u0 and u1 along the segment. */
export function glassPane(frame: PlanFrame, seg: Segment, layout: Layout, u0: number, u1: number, mats: StructureMaterials): THREE.Mesh {
  const g = layout.glass;
  const geo = boxGeometry(u0, u1, 0.03, layout.height - layout.fascia - 0.002, -layout.wall / 2 - g / 2, -layout.wall / 2 + g / 2);
  const mesh = new THREE.Mesh(geo, mats.glass);
  mesh.applyMatrix4(segmentMatrix(frame, seg));
  mesh.name = `glass_${seg.id}`;
  mesh.renderOrder = 2;
  return mesh;
}

/** Slate-wrapped fascia band around the top, closing the corners. */
export function fascia(frame: PlanFrame, seg: Segment, layout: Layout, mats: StructureMaterials): THREE.Mesh {
  const [su, sv] = TEXTURE_METRES.slate;
  const s = layout.slate;
  const geo = boxUV(boxGeometry(-s, seg.length + s, layout.height - layout.fascia, layout.height, -layout.wall, s), su, sv);
  const mesh = new THREE.Mesh(geo, mats.slate);
  mesh.applyMatrix4(segmentMatrix(frame, seg));
  mesh.name = `fascia_${seg.id}`;
  return mesh;
}

/** Flat cap from the footprint outline: roof top (slate), ceiling (Zirbe), inner floor. */
export function footprintCap(frame: PlanFrame, layout: Layout, kind: 'roof' | 'ceiling' | 'floor', mats: StructureMaterials): THREE.Mesh {
  const W = layout.width, D = layout.depth;
  const facingDown = kind === 'ceiling';
  // Shape space -> world: roof/floor rotateX(-90deg): (x, y) -> (x, 0, -y); ceiling rotateX(+90deg): (x, y) -> (x, 0, y)
  const shape = new THREE.Shape(layout.outline.map(([x, y]) => new THREE.Vector2(x - W / 2, facingDown ? D / 2 - y : y - D / 2)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(facingDown ? Math.PI / 2 : -Math.PI / 2);
  const [tu, tv] = kind === 'roof' ? TEXTURE_METRES.slate : kind === 'floor' ? TEXTURE_METRES.floor : TEXTURE_METRES.zirbe;
  const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) / tu; uv[i * 2 + 1] = pos.getZ(i) / tv; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const y = kind === 'roof' ? layout.height : kind === 'ceiling' ? layout.height - layout.fascia : 0.002;
  geo.translate(0, y, 0);
  const mesh = new THREE.Mesh(geo, kind === 'roof' ? mats.slate : kind === 'ceiling' ? mats.zirbe : mats.floor);
  mesh.name = kind;
  return mesh;
}
