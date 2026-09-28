import type { Vec2 } from '../types.ts';

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const norm = (a: Vec2): Vec2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
/** Left-hand perpendicular; for a counter-clockwise polygon this points inside. */
export const leftNormal = (d: Vec2): Vec2 => [-d[1], d[0]];

/** Even-odd point-in-polygon (works for the concave notch at the door corner). */
export function insidePolygon(poly: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a), ap = sub(p, a);
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
  return len(sub(p, add(a, mul(ab, t))));
}

export function distanceToBoundary(poly: Vec2[], p: Vec2): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distanceToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

/** Corners of a rectangle centred at `c`, long axis along unit `u`. */
export function rectCorners(c: Vec2, u: Vec2, length: number, depth: number): Vec2[] {
  const v = leftNormal(u), hl = length / 2, hd = depth / 2;
  return [add(add(c, mul(u, -hl)), mul(v, -hd)), add(add(c, mul(u, hl)), mul(v, -hd)), add(add(c, mul(u, hl)), mul(v, hd)), add(add(c, mul(u, -hl)), mul(v, hd))];
}

/** True when every corner (and edge midpoint) is inside the polygon with `margin` to spare. */
export function fitsInside(poly: Vec2[], shape: Vec2[], margin: number): boolean {
  const probes = [...shape];
  for (let i = 0; i < shape.length; i++) probes.push(mul(add(shape[i], shape[(i + 1) % shape.length]), 0.5));
  if (!probes.every(p => insidePolygon(poly, p) && distanceToBoundary(poly, p) >= margin - 1e-9)) return false;
  // A reflex polygon corner can poke into a convex shape between its probes.
  return !poly.some(p => insidePolygon(shape, p));
}

/** Separating-axis test for two convex polygons. */
export function convexOverlap(a: Vec2[], b: Vec2[], gap = 0): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const axis = norm(leftNormal(sub(poly[(i + 1) % poly.length], poly[i])));
      const pa = a.map(p => p[0] * axis[0] + p[1] * axis[1]);
      const pb = b.map(p => p[0] * axis[0] + p[1] * axis[1]);
      if (Math.max(...pa) + gap <= Math.min(...pb) || Math.max(...pb) + gap <= Math.min(...pa)) return false;
    }
  }
  return true;
}

/** Largest x where the horizontal line y meets the polygon (its right-hand boundary). */
export function rightBoundaryAt(poly: Vec2[], y: number): number {
  let best = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    if ((y1 - y) * (y2 - y) > 0 || y1 === y2) continue;
    best = Math.max(best, x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
  }
  return best;
}
