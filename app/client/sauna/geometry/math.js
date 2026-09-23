// 2D (X,Z) plan-view vector helpers and footprint/segment utilities shared
// by every builder (cabin, barrel, and future shapes).

export const vec = (x, z) => ({ x, z });
export const sub = (a, b) => vec(a.x - b.x, a.z - b.z);
export const add = (a, b) => vec(a.x + b.x, a.z + b.z);
export const scale = (a, k) => vec(a.x * k, a.z * k);
export const length = a => Math.hypot(a.x, a.z);
export const normalize = a => { const l = length(a) || 1; return scale(a, 1 / l); };
export const perp = a => vec(-a.z, a.x);

/** Build the exterior footprint polygon, counter-clockwise viewed from above. */
export function planPolygon(cfg, doorBlock, family) {
  const W = cfg.widthCm / 100, D = cfg.depthCm / 100;
  if (family?.type === 'hex') {
    // Regular-ish hexagon: flat back/front walls (the entry sits on the front
    // one) plus 4 angled corner walls, sized to fit the WxD bounding box.
    // Edge-length fraction verified against a Blender mockup before shipping.
    const half = W * 0.28, R = W / 2, pz = D / 2;
    return [vec(-half, 0), vec(-R, pz), vec(-half, D), vec(half, D), vec(R, pz), vec(half, 0)];
  }
  const chamfered = cfg.entry === 'corner' || cfg.entry === 'corner_glasfront';
  if (!chamfered) return [vec(-W / 2, 0), vec(-W / 2, D), vec(W / 2, D), vec(W / 2, 0)];
  const c = (doorBlock + 0.12) / Math.SQRT2;
  if (cfg.door.corner !== 'left') return [vec(-W / 2, 0), vec(-W / 2, D), vec(W / 2 - c, D), vec(W / 2, D - c), vec(W / 2, 0)];
  return [vec(-W / 2, 0), vec(-W / 2, D - c), vec(-W / 2 + c, D), vec(W / 2, D), vec(W / 2, 0)];
}

/** Max inner |x| at a given z inside the hex polygon, inset by wall thickness.
 *  The hex widens from ±W*0.28 at z=0 and z=D to ±W/2 at z=D/2.
 *  Returns the clamped x-extent so benches/fixtures stay inside the angled walls. */
export function hexMaxInnerX(z, W, D, wallT) {
  const half = W * 0.28, R = W / 2, pz = D / 2;
  // Interpolate along the hex boundary
  const maxX = z <= pz
    ? half + (z / pz) * (R - half)
    : R - ((z - pz) / (D - pz)) * (R - half);
  // The angled walls aren't perpendicular to X, so the X-inset is larger than
  // wallT. The angle of the wall segment from (half,0) to (R,pz) gives us the
  // correction factor.
  const segLen = Math.hypot(R - half, pz);
  const cosA = pz / segLen;   // cos of angle between wall normal and X-axis
  return maxX - wallT / Math.max(cosA, 0.3) - 0.05;
}

/** Outward unit normals for a plan polygon, one per edge. */
export function polyEdges(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cz = points.reduce((s, p) => s + p.z, 0) / points.length;
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    const ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez) || 1;
    let nx = ez / L, nz = -ex / L;
    // Flip if this normal points at the centroid, so ">0" always means outside.
    if ((cx - a.x) * nx + (cz - a.z) * nz > 0) { nx = -nx; nz = -nz; }
    return { a, nx, nz };
  });
}

/** Signed distance from (x,z) to the polygon boundary; >0 is outside. */
export function polyDist(edges, x, z) {
  let d = -Infinity;
  for (const e of edges) d = Math.max(d, (x - e.a.x) * e.nx + (z - e.a.z) * e.nz);
  return d;
}

/**
 * Smallest in-plane translation that brings every point inside the polygon
 * with `clearance` to spare, or null if it already fits.
 *
 * This is the backstop for fixture placement. Clamping only |x| at a single z
 * is not enough on a hex: the walls are angled, so a part that fits at its
 * midpoint can still punch through the wall at either end.
 */
export function shiftInside(edges, pts, clearance) {
  let dx = 0, dz = 0;
  for (let iter = 0; iter < 4; iter++) {
    let worst = null, worstD = -Infinity;
    for (const e of edges) {
      let d = -Infinity;
      for (const p of pts) d = Math.max(d, (p.x + dx - e.a.x) * e.nx + (p.z + dz - e.a.z) * e.nz);
      if (d > worstD) { worstD = d; worst = e; }
    }
    const over = worstD + clearance;
    if (over <= 1e-4) break;
    dx -= worst.nx * over; dz -= worst.nz * over;
  }
  return (dx || dz) ? { x: dx, z: dz } : null;
}

export function classifySegments(points, W, D) {
  const n = points.length, segs = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[i], p1 = points[(i + 1) % n];
    const d = normalize(sub(p1, p0));
    const nrm = scale(perp(d), -1); // inward
    let name = 'corner';
    if (Math.abs(p0.z) < 1e-6 && Math.abs(p1.z) < 1e-6) name = 'back';
    else if (Math.abs(p0.x + W / 2) < 1e-6 && Math.abs(p1.x + W / 2) < 1e-6) name = 'left';
    else if (Math.abs(p0.z - D) < 1e-6 && Math.abs(p1.z - D) < 1e-6) name = 'front';
    else if (Math.abs(p0.x - W / 2) < 1e-6 && Math.abs(p1.x - W / 2) < 1e-6) name = 'right';
    segs.push({ p0, p1, d, n: nrm, L: length(sub(p1, p0)), name, openings: [], glass: false });
  }
  return segs;
}
