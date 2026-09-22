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
