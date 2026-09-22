import * as THREE from 'three';

// Low-level mesh-building utilities shared by every builder: interval math
// for cutting holes in wall spans, priced-part tagging, and physically-scaled
// UVs so wood grain reads the same size on every part.

export function subtractIntervals(span, holes) {
  let pieces = [[...span]];
  for (const [h0, h1] of holes) {
    const next = [];
    for (const [a, b] of pieces) {
      if (h1 <= a || h0 >= b) next.push([a, b]);
      else { if (h0 > a) next.push([a, h0]); if (h1 < b) next.push([h1, b]); }
    }
    pieces = next;
  }
  return pieces.filter(([a, b]) => b - a > 0.004);
}

export function tag(mesh, category, sku, name, price, dimsMm, extra = {}) {
  mesh.userData.info = { category, sku, name, price, dims: dimsMm, ...extra };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Planar per-face UVs at a physical scale so grain reads the same size on every part. */
export function physicalUVs(geometry, tile = 1.0, grainAlong = 'auto') {
  const pos = geometry.attributes.position, nor = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const bb = new THREE.Box3().setFromBufferAttribute(pos);
  const ext = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
  for (let i = 0; i < pos.count; i++) {
    const n = [Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i))];
    const normalAxis = n.indexOf(Math.max(...n));
    const axes = [0, 1, 2].filter(a => a !== normalAxis);
    let uAxis = axes[0], vAxis = axes[1];
    if (grainAlong === 'auto' ? ext[axes[1]] > ext[axes[0]] : grainAlong === 'y') { uAxis = axes[1]; vAxis = axes[0]; }
    if (grainAlong === 'x' && axes.includes(0)) { uAxis = 0; vAxis = axes.find(a => a !== 0); }
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    uv.setXY(i, p[uAxis] / tile, p[vAxis] / tile);
  }
  uv.needsUpdate = true;
  return geometry;
}

export function box(w, h, d, tile = 1.0, grainAlong = 'auto') {
  const g = new THREE.BoxGeometry(Math.max(w, 0.003), Math.max(h, 0.003), Math.max(d, 0.003));
  return physicalUVs(g, tile, grainAlong);
}

/**
 * Physically-scaled UVs for a curved cylindrical surface (barrel/round shell),
 * unwrapped by local angle * radius (circumference) and local axial position -
 * NOT physicalUVs, whose per-vertex normal-axis projection only makes sense
 * on flat box faces: on a cylinder the normal rotates continuously around the
 * circumference, so that projection scrambles into a warped-looking surface.
 * Reads CylinderGeometry's own local axis (Y) - any mesh.rotation applied
 * afterwards to lay the cylinder on its side is a render-time transform and
 * doesn't touch these local vertex coordinates.
 */
export function cylindricalUVs(geometry, radius, tile = 1.0) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    uv.setXY(i, (a * radius) / tile, y / tile);
  }
  uv.needsUpdate = true;
  return geometry;
}
