/**
 * Parametric layout of the Zirbe 6-Eck: turns a configuration into the plan
 * footprint, the wall/glass runs, and a placement for every module. Pure
 * math (no three.js) so the browser assembler, the server validator and the
 * tests all share it.
 *
 * Plan frame (metres): origin at the outer back-left corner, x along the back
 * wall (short bench), y along the left wall (long bench). The outline is
 * counter-clockwise, so the left-hand normal of every segment points inside.
 *
 *   P5 ─────────── P4                 P5-P0  left wall   (solid, long bench)
 *   │  long bench   │ control 400     P0-P1  back wall   (solid, short bench)
 *   │               Q                 P1-P2  right glass
 *   │               │ glass return    P2-P3  diagonal glass + door (hinge at P3)
 *   │   lower   ┌───P3                P3-Q   glass return
 *   │   bench ╱      ╲  diagonal      Q-P4   control segment (solid, control outside)
 *   │       ╱  heater  P2             P4-P5  top wall    (solid)
 *   │ short bench      │ right glass
 *   P0 ───────────────P1
 */
import type { Issue, ModelDefinition, SaunaConfiguration, Vec2 } from '../types.ts';
import { MODULES } from '../modules/registry.ts';
import { add, convexOverlap, fitsInside, insidePolygon, leftNormal, len, mul, norm, rectCorners, rightBoundaryAt, sub } from './planMath.ts';

export type SegmentKind = 'solid' | 'glass' | 'door-glass';

export interface Segment {
  id: 'back' | 'right' | 'diagonal' | 'return' | 'control' | 'top' | 'left';
  kind: SegmentKind;
  a: Vec2;
  b: Vec2;
  length: number;
  dir: Vec2;     // unit a -> b
  inward: Vec2;  // unit, into the cabin
  /** Signed turn (rad) at `a` from the previous segment and at `b` into the next; > 0 = convex corner. */
  turnA: number;
  turnB: number;
}

const GLASS_END_GAP = 0.004; // glass that stops at a wall sits 4 mm clear of it

/**
 * Where a glass pane on the wall's centre plane must start and end so that
 * glass meets glass at the corners (mitred, both faces closed) and stops 4 mm
 * short of solid walls.
 */
export function paneSpan(layout: Pick<Layout, 'segments' | 'wall' | 'glass'>, seg: Segment): [number, number] {
  const i = layout.segments.indexOf(seg), n = layout.segments.length;
  const prev = layout.segments[(i + n - 1) % n], next = layout.segments[(i + 1) % n];
  const k = layout.wall / 2, h = layout.glass / 2;
  const miter = (turn: number) => k * Math.tan(turn / 2) - h * Math.tan(Math.abs(turn) / 2);
  const u0 = prev.kind !== 'solid' ? miter(seg.turnA) : GLASS_END_GAP;
  const u1 = next.kind !== 'solid' ? seg.length - miter(seg.turnB) : seg.length - GLASS_END_GAP;
  return [u0, u1];
}

/** A module placed in plan space. `facing` = where the module's +Z points. */
export interface Placement {
  key: string;
  module: string;
  position: Vec2;
  elevation: number;
  facing: Vec2;
  /** Profiles: run length along the module's length axis (metres). */
  length?: number;
}

export interface Run {
  key: string;
  module: string;
  from: Vec2;
  to: Vec2;
  elevation: number;
  facing: Vec2;
}

export interface Layout {
  width: number;
  depth: number;
  height: number;
  wall: number;
  glass: number;
  ceiling: number;
  fascia: number;
  slate: number;
  outline: Vec2[];
  segments: Segment[];
  door: { segment: 'diagonal'; hinge: Vec2; closedDir: Vec2; outward: Vec2; width: number; height: number; fixedPane: [number, number] };
  benches: {
    long: { from: Vec2; to: Vec2; depth: number };
    short: { from: Vec2; to: Vec2; depth: number };
    /** Movable lower bench outline (triangle), or null when it does not fit. */
    lower: Vec2[] | null;
    upperHeight: number;
    lowerHeight: number;
  };
  placements: Placement[];
  runs: Run[];
  issues: Issue[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Floor square reserved for any offered heater (largest footprint + margin). */
const HEATER_ZONE = Math.max(...['heater-harvia-virta', 'heater-harvia-virta-combi', 'heater-eos-mythos'].map(id => Math.max(MODULES[id].size[0], MODULES[id].size[2]))) + 0.02;
const pt = (p: Vec2): Vec2 => [r3(p[0]), r3(p[1])];

export function computeLayout(model: ModelDefinition, config: SaunaConfiguration): Layout {
  const c = model.construction;
  const issues: Issue[] = [];
  const W = config.dimensions.widthCm / 100;
  const D = config.dimensions.depthCm / 100;
  const H = model.dimensions.heightMm / 1000;
  const t = c.wallMm / 1000, g = c.glassMm / 1000, ctrl = c.controlSegmentMm / 1000;
  const doorW = c.door.widthMm / 1000, doorH = c.door.heightMm / 1000;

  // ── footprint ────────────────────────────────────────────────────────────
  // The drawing is component-driven: its 1458 mm right glass run is exactly
  // wall + short bench + heater gap + heater zone + 50 mm. So that run follows
  // the components, not the overall depth. Depths too small for the heater in
  // front of the short bench use the compact arrangement: heater in the back
  // corner, short bench ending beside it (its slatted end panel is visible next
  // to the heater in the renders).
  const shortDepth = c.benches.shortDepthMm / 1000;
  const heaterGap = c.plan.heaterGapMm / 1000;
  const heaterZone = HEATER_ZONE;
  const minReturn = 0.15, minRise = 0.15;
  const gRReference = t + shortDepth + heaterGap + heaterZone + 0.05;
  const arrangement: 'reference' | 'compact' = D >= gRReference + ctrl + minReturn + minRise ? 'reference' : 'compact';
  const gR = arrangement === 'reference' ? gRReference : Math.max(t + heaterZone + 0.14, D * c.plan.rightGlassRatio);
  const dy = Math.max(0.05, Math.min(D * (1 - c.plan.rightGlassRatio - c.plan.upperSideRatio), D - gR - ctrl - minReturn));
  const vU = D - gR - dy;
  // The diagonal always carries the real door plus a minimum fixed pane: on
  // narrow cabins the solid block gives way (the door never shrinks).
  const profile = 0.03, minPane = 0.2;
  const diagMin = profile + minPane + 0.008 + doorW + profile;
  const dxDrawing = W * (1 - c.plan.solidBlockWidthRatio);
  const dx = Math.max(dxDrawing, Math.sqrt(Math.max(0, diagMin ** 2 - dy ** 2)));
  const tW = W - dx;
  if (dx > dxDrawing + 1e-9) issues.push({ level: 'info', path: 'dimensions.widthCm', message: 'At this width the solid slate block is narrowed so the full-size glass door still fits the diagonal front.' });
  if (arrangement === 'compact') issues.push({ level: 'info', path: 'dimensions.depthCm', message: 'At this depth the heater stands in the back corner and the short bench ends beside it (compact arrangement).' });
  const P0: Vec2 = [0, 0], P1: Vec2 = [W, 0], P2: Vec2 = [W, gR], P3: Vec2 = [tW, D - vU], Q: Vec2 = [tW, D - ctrl], P4: Vec2 = [tW, D], P5: Vec2 = [0, D];
  const outline = [P0, P1, P2, P3, P4, P5];
  const seg = (id: Segment['id'], kind: SegmentKind, a: Vec2, b: Vec2): Segment => {
    const d = norm(sub(b, a));
    return { id, kind, a: pt(a), b: pt(b), length: r3(len(sub(b, a))), dir: d, inward: leftNormal(d), turnA: 0, turnB: 0 };
  };
  const segments: Segment[] = [
    seg('back', 'solid', P0, P1),
    seg('right', 'glass', P1, P2),
    seg('diagonal', 'door-glass', P2, P3),
    seg('return', 'glass', P3, Q),
    seg('control', 'solid', Q, P4),
    seg('top', 'solid', P4, P5),
    seg('left', 'solid', P5, P0),
  ];
  segments.forEach((s, i) => {
    const nx = segments[(i + 1) % segments.length];
    const turn = Math.atan2(s.dir[0] * nx.dir[1] - s.dir[1] * nx.dir[0], s.dir[0] * nx.dir[0] + s.dir[1] * nx.dir[1]);
    s.turnB = turn; nx.turnA = turn;
  });
  const segById = Object.fromEntries(segments.map(s => [s.id, s])) as Record<Segment['id'], Segment>;

  if (segById.return.length < 0.15) issues.push({ level: 'error', path: 'dimensions.depthCm', message: 'The glass return beside the door is shorter than 15 cm at this depth.' });

  // ── door on the diagonal, hinged at its upper end (P3) ─────────────────────
  const diag = segById.diagonal;
  // Frameless glass meets glass: the leaf's hinge edge (4 mm off the hinge
  // axis) sits exactly on the mitre with the return glass at P3, and the fixed
  // pane runs from its mitre at P2 to a 2 mm seal gap at the handle edge.
  const span = paneSpan({ segments, wall: t, glass: g }, diag);
  const hingeU = span[1] - 0.004;
  const fixedPane: [number, number] = [span[0], hingeU - doorW + 0.002];
  if (fixedPane[1] - fixedPane[0] < 0.15) {
    issues.push({ level: 'error', path: 'dimensions', message: `The ${Math.round(doorW * 1000)} mm glass door does not fit the diagonal front at this size (needs a longer diagonal).` });
  }
  const glassInset = t / 2;
  const onDiag = (u: number): Vec2 => add(add(diag.a, mul(diag.dir, u)), mul(diag.inward, glassInset));
  const door = {
    segment: 'diagonal' as const,
    hinge: pt(onDiag(hingeU)),
    closedDir: mul(diag.dir, -1) as Vec2, // from the hinge back toward P2
    outward: mul(diag.inward, -1) as Vec2,
    width: doorW,
    height: doorH,
    fixedPane,
  };

  // ── interior ────────────────────────────────────────────────────────────
  const upperY = c.benches.upperHeightMm / 1000, lowerY = c.benches.lowerHeightMm / 1000;
  let longDepth = c.benches.longDepthMm / 1000;
  const maxLong = tW - 2 * t - 0.02; // must pass under the solid block at the top
  if (longDepth > maxLong) {
    issues.push({ level: 'warning', path: 'dimensions.widthCm', message: `The long upper bench is reduced from ${c.benches.longDepthMm / 10} cm to ${Math.round(maxLong * 100)} cm deep to fit this width.` });
    longDepth = maxLong;
  }
  const long = { from: pt([t, t]) as Vec2, to: pt([t, D - t]) as Vec2, depth: r3(longDepth) };
  const shortFrontY = t + shortDepth;

  // Heater zone, reserved from the dimensions alone (changing the heater never
  // reshapes the cabin): against the right glass, in front of the short bench
  // (reference) or in the back corner (compact).
  const zoneCx = W - glassInset - g - 0.06 - heaterZone / 2;
  const zoneCy = arrangement === 'reference' ? shortFrontY + heaterGap + heaterZone / 2 : t + 0.08 + heaterZone / 2;
  const zone = rectCorners([zoneCx, zoneCy], [0, 1], heaterZone, heaterZone);
  if (!fitsInside(outline, zone, glassInset + g + 0.02)) issues.push({ level: 'error', path: 'dimensions', message: 'There is no room for the heater at this size.' });

  const shortEndX = arrangement === 'reference'
    ? Math.min(rightBoundaryAt(outline, shortFrontY), W) - glassInset - g - 0.02
    : zoneCx - heaterZone / 2 - 0.06;
  const short = { from: pt([t + longDepth, t]) as Vec2, to: pt([shortEndX, t]) as Vec2, depth: r3(shortDepth) };
  if (shortEndX - (t + longDepth) < 0.45) issues.push({ level: 'warning', path: 'dimensions.widthCm', message: 'The short upper bench is less than 45 cm long at this width.' });

  // Movable lower bench: the diagonally slatted triangle in the inner corner of
  // the drawing (and the top-view render). It stands on feet at lower-bench
  // height; `lowerBenchOffsetMm` slides it out of the corner along the diagonal.
  const inCorner: Vec2 = [t + longDepth, shortFrontY];
  const slide = Math.max(0, Math.min(0.4, config.interior.lowerBenchOffsetMm / 1000));
  let legLong = Math.min(D * c.plan.cornerSeatLegLongRatio, D - t - inCorner[1] - 0.3);
  let legShort = Math.min(W * c.plan.cornerSeatLegShortRatio, shortEndX - inCorner[0] - 0.05);
  const tri = (): Vec2[] => {
    const o: Vec2 = add(inCorner, mul(norm([1, 1]), slide + 0.02));
    return [pt(o), pt([o[0], o[1] + legLong]), pt([o[0] + legShort, o[1]])];
  };
  while ((convexOverlap(tri(), zone, 0.08) || !fitsInside(outline, tri(), t + 0.01)) && legShort > 0.25) { legShort *= 0.92; legLong *= 0.92; }
  const lowerBench = tri();
  const lowerFits = fitsInside(outline, lowerBench, t + 0.01) && !convexOverlap(lowerBench, zone, 0.05);
  if (!lowerFits) issues.push({ level: 'warning', path: 'interior.lowerBenchOffsetMm', message: 'The lower bench does not fit at this position.' });
  else if (legShort < W * c.plan.cornerSeatLegShortRatio - 0.01) issues.push({ level: 'info', path: 'interior', message: 'The lower bench is shown smaller to keep clear of the heater.' });

  const placements: Placement[] = [];
  const runs: Run[] = [];

  // ── heater (from the chosen set) in its zone, front facing into the room ───
  const set = model.options.heaterSet.find(s => s.id === config.heaterSet);
  const heaterRect: Vec2[] | null = set?.heater ? zone : null;
  if (set?.heater) placements.push({ key: 'heater', module: set.heater, position: pt([zoneCx, zoneCy]), elevation: 0, facing: [-1, 0] });
  if (set?.control) {
    const cs = segById.control;
    const mid = mul(add(cs.a, cs.b), 0.5);
    const outward = mul(cs.inward, -1) as Vec2;
    placements.push({ key: 'control', module: set.control, position: pt(add(mid, mul(outward, c.slateMm / 1000))), elevation: 1.45, facing: outward });
  }

  // ── ceiling lights (shown in every product render) ──────────────────────────
  const lights: Vec2[] = [[t + longDepth * 0.55, D * 0.62], [(inCorner[0] + shortEndX) / 2, t + shortDepth * 0.6]];
  lights.forEach((p, i) => { if (insidePolygon(outline, p)) placements.push({ key: `downlight-${i}`, module: 'downlight', position: pt(p), elevation: H - c.fasciaMm / 1000 + 0.0, facing: [0, 1] }); });

  // ── optional accessories ────────────────────────────────────────────────────
  const shortMidX = (inCorner[0] + shortEndX) / 2;
  if (config.accessories.includes('nova-set-4')) {
    placements.push({ key: 'climate-station', module: 'climate-station', position: pt([Math.max(t + 0.3, t + longDepth - 0.25), t]), elevation: 1.5, facing: [0, 1] });
    // On the free floor beside the heater zone (first spot that fits).
    const spots: Vec2[] = [[zoneCx - heaterZone / 2 - 0.2, zoneCy], [zoneCx - 0.05, zoneCy + heaterZone / 2 + 0.2], [shortMidX, shortFrontY + 0.25]];
    const bucket = spots.find(p => fitsInside(outline, rectCorners(p, [1, 0], 0.3, 0.25), t + 0.02) && !convexOverlap(rectCorners(p, [1, 0], 0.3, 0.25), lowerBench, 0.02) && !(heaterRect && convexOverlap(rectCorners(p, [1, 0], 0.3, 0.25), heaterRect, 0.05)));
    if (bucket) placements.push({ key: 'nova-bucket-set', module: 'nova-bucket-set', position: pt(bucket), elevation: 0, facing: [-1, 0] });
  }
  const benchLip = upperY - c.benches.slatMm / 1000 - 0.03;
  if (config.accessories.includes('led-5m')) {
    // Indirect light under the upper bench lip: along the long bench, the corner
    // seat and the short bench (~5 m on the reference layout).
    runs.push({ key: 'led-long', module: 'led-strip', from: pt([t + longDepth - 0.03, D - t - 0.05]), to: pt([t + longDepth - 0.03, shortFrontY - 0.03]), elevation: benchLip, facing: [1, 0] });
    runs.push({ key: 'led-short', module: 'led-strip', from: pt([t + longDepth - 0.03, shortFrontY - 0.03]), to: pt([shortEndX, shortFrontY - 0.03]), elevation: benchLip, facing: [0, 1] });
    const total = runs.filter(r => r.module === 'led-strip').reduce((s, r) => s + len(sub(r.to, r.from)), 0);
    if (total > 5.05) issues.push({ level: 'info', path: 'accessories', message: `The bench fronts measure ${total.toFixed(1)} m; one 5 m set covers ${Math.round((5 / total) * 100)} %.` });
  }

  return {
    width: W, depth: D, height: H, wall: t, glass: g, ceiling: c.ceilingMm / 1000, fascia: c.fasciaMm / 1000, slate: c.slateMm / 1000,
    outline: outline.map(pt), segments, door,
    benches: { long, short, lower: lowerFits ? lowerBench : null, upperHeight: upperY, lowerHeight: lowerY },
    placements, runs, issues,
  };
}
