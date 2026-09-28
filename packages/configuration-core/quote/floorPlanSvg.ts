import type { Layout } from '../geometry/zirbe6eckLayout.ts';
import type { Vec2 } from '../types.ts';

/**
 * Dimensioned top-view drawing in the style of HolzSauna's "Beispiel
 * Saunagrundriss": wall outline, slatted benches, the hatched movable lower
 * bench, heater, door with swing arc, control box and mm dimension lines.
 * Generated from the live layout, so it always matches the configured size.
 */
/** Inline presentation attributes (PDF renderers do not all apply CSS classes). */
const ST: Record<string, string> = {
  wall: 'fill="#f3e9c9" stroke="#333333" stroke-width="1"',
  glass: 'stroke="#333333" stroke-width="0.8"',
  bench: 'fill="#fbf6d8" stroke="#444444" stroke-width="1"',
  slat: 'stroke="#444444" stroke-width="0.8"',
  lower: 'fill="#fdfae6" stroke="#444444" stroke-width="1"',
  heater: 'fill="#7a7572" stroke="#222222" stroke-width="4"',
  ctrl: 'fill="#222222"',
  door: 'stroke="#333333" stroke-width="2"',
  arc: 'fill="none" stroke="#333333" stroke-width="0.8"',
  ext: 'stroke="#777777" stroke-width="0.6"',
  dim: 'stroke="#555555" stroke-width="0.8"',
  dimtxt: 'font-size="11" fill="#333333" text-anchor="middle"',
};

export function floorPlanSvg(layout: Layout, opts: { heater: boolean; control: boolean }): string {
  const S = 170;                       // px per metre
  const M = 90;                        // margin for dimension lines
  const W = layout.width, D = layout.depth, t = layout.wall;
  const X = (x: number) => M + x * S;
  const Y = (y: number) => M + (D - y) * S; // plan y up -> svg down
  const P = (p: Vec2) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`;
  const mm = (m: number) => `${Math.round(m * 1000)} mm`;
  const out: string[] = [];
  const line = (a: Vec2, b: Vec2, cls: string) => out.push(`<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}" ${ST[cls]}/>`);

  // walls: solid segments as filled strips, glass as thin double lines
  for (const s of layout.segments) {
    const inA: Vec2 = [s.a[0] + s.inward[0] * t, s.a[1] + s.inward[1] * t];
    const inB: Vec2 = [s.b[0] + s.inward[0] * t, s.b[1] + s.inward[1] * t];
    if (s.kind === 'solid') out.push(`<polygon points="${P(s.a)} ${P(s.b)} ${P(inB)} ${P(inA)}" ${ST.wall}/>`);
    else {
      const g = (k: number): [Vec2, Vec2] => [[s.a[0] + s.inward[0] * k, s.a[1] + s.inward[1] * k], [s.b[0] + s.inward[0] * k, s.b[1] + s.inward[1] * k]];
      for (const k of [t / 2 - 0.006, t / 2 + 0.006]) { const [a, b] = g(k); line(a, b, 'glass'); }
    }
  }
  // benches with slats
  const b = layout.benches;
  const rect = (x0: number, y0: number, x1: number, y1: number) => out.push(`<rect x="${X(x0)}" y="${Y(y1)}" width="${(x1 - x0) * S}" height="${(y1 - y0) * S}" ${ST.bench}/>`);
  const lx0 = t, lx1 = t + b.long.depth, ly0 = t, ly1 = b.long.to[1];
  rect(lx0, ly0, lx1, ly1);
  for (let x = lx0 + 0.1; x < lx1 - 0.02; x += 0.1) line([x, ly0], [x, ly1], 'slat');
  const sx0 = lx1, sx1 = b.short.to[0], sy1 = t + b.short.depth;
  rect(sx0, t, sx1, sy1);
  for (let y = t + 0.1; y < sy1 - 0.02; y += 0.1) line([sx0, y], [sx1, y], 'slat');
  if (b.lower) {
    out.push(`<polygon points="${b.lower.map(P).join(' ')}" ${ST.lower}/>`);
    const [O, A, B] = b.lower;
    for (let k = 0.12; k < 1; k += 0.12) line([A[0] + (O[0] - A[0]) * k, A[1] + (O[1] - A[1]) * k], [B[0] + (O[0] - B[0]) * k, B[1] + (O[1] - B[1]) * k], 'slat');
  }
  // heater and control
  const heater = layout.placements.find(p => p.key === 'heater');
  if (opts.heater && heater) {
    const h = 0.45 / 2;
    out.push(`<rect x="${X(heater.position[0] - h)}" y="${Y(heater.position[1] + h)}" width="${2 * h * S}" height="${2 * h * S}" ${ST.heater}/>`);
  }
  const ctrl = layout.placements.find(p => p.key === 'control');
  if (opts.control && ctrl) out.push(`<rect x="${X(ctrl.position[0]) - 3}" y="${Y(ctrl.position[1]) - 9}" width="7" height="18" ${ST.ctrl}/>`);
  // door: leaf drawn open ~65 deg outward with the swing arc
  const d = layout.door, open = 65 * Math.PI / 180;
  const c = d.closedDir, o = d.outward;
  const leafEnd: Vec2 = [d.hinge[0] + (c[0] * Math.cos(open) + o[0] * Math.sin(open)) * d.width, d.hinge[1] + (c[1] * Math.cos(open) + o[1] * Math.sin(open)) * d.width];
  const closedEnd: Vec2 = [d.hinge[0] + c[0] * d.width, d.hinge[1] + c[1] * d.width];
  line(d.hinge, leafEnd, 'door');
  out.push(`<path d="M ${P(leafEnd)} A ${d.width * S} ${d.width * S} 0 0 ${c[0] * o[1] - c[1] * o[0] > 0 ? 1 : 0} ${P(closedEnd)}" ${ST.arc}/>`);

  // dimension lines (outer)
  const dim = (a: Vec2, bb: Vec2, off: Vec2, label: string) => {
    const A2: Vec2 = [a[0] + off[0], a[1] + off[1]], B2: Vec2 = [bb[0] + off[0], bb[1] + off[1]];
    line(a, A2, 'ext'); line(bb, B2, 'ext'); line(A2, B2, 'dim');
    const mx = (X(A2[0]) + X(B2[0])) / 2, my = (Y(A2[1]) + Y(B2[1])) / 2;
    const vertical = Math.abs(A2[0] - B2[0]) < 1e-6;
    out.push(`<text x="${mx}" y="${my}" ${ST.dimtxt} ${vertical ? `transform="rotate(-90 ${mx} ${my})" ` : ''}dy="-4">${label}</text>`);
  };
  const seg = Object.fromEntries(layout.segments.map(s => [s.id, s]));
  dim([0, 0], [W, 0], [0, -0.28], mm(W));
  dim([0, 0], [0, D], [-0.28, 0], mm(D));
  dim(seg.top.b, seg.top.a, [0, 0.22], mm(seg.top.length));
  dim(seg.right.a, seg.right.b, [0.28, 0], mm(seg.right.length));
  dim(seg.control.a, seg.control.b, [0.2, 0], mm(seg.control.length));

  const w = W * S + 2 * M, h = D * S + 2 * M;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial, sans-serif">
${out.join('')}</svg>`;
}
