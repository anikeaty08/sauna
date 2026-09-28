/**
 * Automatic placement planner: "where does this sauna fit?"
 *
 * Pure geometry in the floor plane (metres, x/z), no three.js and no DOM, so the
 * same code drives both the live AR session (observations come from WebXR
 * hit-tests) and the 2D room-fit check (observations come from the room size the
 * customer typed in) - and so it can be unit-tested against synthetic rooms.
 *
 * Conventions match three.js: a pose { x, z, rot } places a local point (lx, lz)
 * at  x + lx*cos(rot) + lz*sin(rot),  z - lx*sin(rot) + lz*cos(rot).
 * Locally the cabin is centred on the origin and its ENTRANCE FACES +Z, so the
 * entrance direction of a pose is (sin rot, cos rot).
 */

export const FREE = 0;
export const BLOCKED = 1;
export const UNKNOWN = 2;

/** Floor-plane map of what has been observed: seen-as-floor vs something-there. */
export class OccupancyGrid {
  constructor(cell = 0.1) {
    this.cell = cell;
    this.cells = new Map();
  }

  key(ix, iz) { return (ix + 50000) * 100000 + (iz + 50000); }
  index(v) { return Math.floor(v / this.cell); }

  entry(x, z) {
    const k = this.key(this.index(x), this.index(z));
    let e = this.cells.get(k);
    if (!e) { e = { f: 0, b: 0, x: (this.index(x) + 0.5) * this.cell, z: (this.index(z) + 0.5) * this.cell }; this.cells.set(k, e); }
    return e;
  }

  /** Floor seen at (x, z). `spread` also credits neighbouring cells (in cells). */
  addFloor(x, z, spread = 0) {
    for (let dx = -spread; dx <= spread; dx++) {
      for (let dz = -spread; dz <= spread; dz++) this.entry(x + dx * this.cell, z + dz * this.cell).f++;
    }
  }

  /** Something above floor level (furniture, a wall) at (x, z). */
  addBlocked(x, z) { this.entry(x, z).b++; }

  state(x, z) {
    const e = this.cells.get(this.key(this.index(x), this.index(z)));
    if (!e) return UNKNOWN;
    // One stray obstacle hit on a well-seen floor cell is noise; two is real.
    // A wall usually shows up as obstacle hits with no floor under them at all.
    if (e.b >= 2 || (e.b >= 1 && e.f < 2)) return BLOCKED;
    if (e.b === 0 && e.f >= 1) return FREE;
    return UNKNOWN;
  }

  /** Cells currently classified as blocked, as {x, z} centres. */
  blockedCells() {
    const out = [];
    for (const e of this.cells.values()) if (e.b >= 2 || (e.b >= 1 && e.f < 2)) out.push(e);
    return out;
  }

  freeCells() {
    const out = [];
    for (const e of this.cells.values()) if (e.b === 0 && e.f >= 1) out.push(e);
    return out;
  }
}

/**
 * The area a sauna needs: its body plus a small wall gap, and the zone its
 * door sweeps as it opens (sauna doors open OUTWARD, so that floor must be
 * clear too - the part customers most often forget).
 *
 * spec = { width, depth, margin, swing: { width, depth, offsetX } | null }
 */
export function footprintSamples(spec, step = 0.1) {
  const body = [];
  const swing = [];
  const back = [];
  const hw = spec.width / 2 + spec.margin;
  const hd = spec.depth / 2 + spec.margin;
  for (let lx = -hw + step / 2; lx < hw; lx += step) {
    for (let lz = -hd + step / 2; lz < hd; lz += step) body.push([lx, lz]);
  }
  if (spec.swing) {
    const s = spec.swing;
    const z0 = spec.depth / 2 + spec.margin;
    for (let lx = s.offsetX - s.width / 2 + step / 2; lx < s.offsetX + s.width / 2; lx += step) {
      for (let lz = z0 + step / 2; lz < z0 + s.depth; lz += step) swing.push([lx, lz]);
    }
  }
  // Columns just behind the cabin: something blocked in a column means that
  // slice of the cabin backs onto a wall. Per-column rather than a raw area
  // fraction because hit-tests see a real wall as a ~1-cell-thick line, which
  // would only ever fill a third of a 30 cm strip.
  for (let lx = -spec.width / 2 + step / 2; lx < spec.width / 2; lx += step) {
    const col = [];
    for (let lz = -hd - 0.35; lz < -hd - 0.02; lz += step / 2) col.push([lx, lz]);
    back.push(col);
  }
  return { body, swing, back };
}

const toWorld = (lx, lz, pose) => {
  const c = Math.cos(pose.rot), s = Math.sin(pose.rot);
  return [pose.x + lx * c + lz * s, pose.z - lx * s + lz * c];
};

/** How well a pose fits the observed floor. */
export function evaluatePose(grid, samples, pose) {
  let blocked = 0, unknown = 0, total = 0;
  for (const [lx, lz] of samples.body.concat(samples.swing)) {
    const [x, z] = toWorld(lx, lz, pose);
    const st = grid.state(x, z);
    if (st === BLOCKED) blocked++;
    else if (st === UNKNOWN) unknown++;
    total++;
  }
  let wall = 0;
  for (const col of samples.back) {
    if (col.some(([lx, lz]) => { const [x, z] = toWorld(lx, lz, pose); return grid.state(x, z) === BLOCKED; })) wall++;
  }
  return {
    blocked,
    blockedFrac: total ? blocked / total : 0,
    unknownFrac: total ? unknown / total : 1,
    wallFrac: samples.back.length ? wall / samples.back.length : 0,
  };
}

/** Outline polygons (world x/z) for drawing the footprint and door-swing zone. */
export function footprintOutline(spec, pose) {
  const hw = spec.width / 2, hd = spec.depth / 2;
  const body = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => toWorld(lx, lz, pose));
  let swing = null;
  if (spec.swing) {
    const s = spec.swing, z0 = hd;
    swing = [[s.offsetX - s.width / 2, z0], [s.offsetX + s.width / 2, z0], [s.offsetX + s.width / 2, z0 + s.depth], [s.offsetX - s.width / 2, z0 + s.depth]]
      .map(([lx, lz]) => toWorld(lx, lz, pose));
  }
  return { body, swing };
}

/**
 * Dominant wall direction from the blocked cells, via a small Hough vote:
 * for each candidate angle, bin the cells' distances along that normal; a
 * straight wall piles many cells into one bin. Returns the angle (radians) of
 * the wall's NORMAL, or null when there is not enough wall seen.
 */
export function dominantWallAngle(grid) {
  const cells = grid.blockedCells();
  if (cells.length < 8) return null;
  let best = null, bestScore = 0;
  for (let deg = 0; deg < 180; deg += 3) {
    const a = (deg * Math.PI) / 180, nx = Math.cos(a), nz = Math.sin(a);
    const bins = new Map();
    for (const c of cells) {
      const b = Math.round((c.x * nx + c.z * nz) / grid.cell);
      bins.set(b, (bins.get(b) || 0) + 1);
    }
    let peak = 0;
    for (const v of bins.values()) if (v > peak) peak = v;
    if (peak > bestScore) { bestScore = peak; best = a; }
  }
  return bestScore >= 6 ? best : null;
}

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Search positions x rotations for the best pose.
 *
 * opts:
 *   viewer    {x, z, yaw}  where the person stands and faces; yaw such that the
 *                          view direction is (sin yaw, cos yaw). Optional.
 *   face      {x, z}       point the entrance should face if there is no viewer
 *                          (e.g. the room centre in the 2D check).
 *   radius    search radius around the viewer/face point (m)
 *   minDist   keep at least this far from the viewer (m)
 *   viewCone  only consider spots within this half-angle of where the viewer looks
 *   maxUnknown  fraction of the footprint allowed to be unseen and still "fit"
 */
export function planPlacement(grid, spec, opts = {}) {
  const {
    viewer = null, face = null, radius = 5, minDist = 0.8, step = 0.2,
    viewCone = (70 * Math.PI) / 180, maxUnknown = 0.2,
  } = opts;
  // Sample the footprint a little coarser than the grid: ~2x fewer lookups,
  // which matters on a phone re-planning every half second mid-session.
  const samples = footprintSamples(spec, opts.sampleStep ?? Math.max(grid.cell, 0.15));
  const origin = viewer || face || { x: 0, z: 0 };
  const target = viewer || face;
  const wallNormal = dominantWallAngle(grid);

  // Candidate centres: clear floor cells on a coarse lattice.
  const centres = [];
  const seen = new Set();
  for (const c of grid.freeCells()) {
    const d = Math.hypot(c.x - origin.x, c.z - origin.z);
    if (d > radius || (viewer && d < minDist)) continue;
    if (viewer) {
      const bearing = Math.atan2(c.x - viewer.x, c.z - viewer.z);
      if (Math.abs(wrap(bearing - viewer.yaw)) > viewCone) continue;
    }
    const kx = Math.round(c.x / step), kz = Math.round(c.z / step);
    const k = `${kx},${kz}`;
    if (seen.has(k)) continue;
    seen.add(k);
    centres.push({ x: kx * step, z: kz * step });
  }

  let best = null;
  let bestAny = null;
  for (const p of centres) {
    const rots = [];
    const facing = target ? Math.atan2(target.x - p.x, target.z - p.z) : 0;
    for (let k = 0; k < 8; k++) rots.push(facing + (k * Math.PI) / 4);
    if (wallNormal !== null) for (let k = 0; k < 4; k++) rots.push(wallNormal + (k * Math.PI) / 2);

    for (const rot of rots) {
      const pose = { x: p.x, z: p.z, rot };
      const ev = evaluatePose(grid, samples, pose);
      let score = 3 * (1 - ev.unknownFrac) + 2 * ev.wallFrac;
      if (target) {
        // Entrance pointing at the viewer (or into the room): cos of the miss angle.
        const entrance = Math.atan2(Math.sin(rot), Math.cos(rot));
        score += 1.5 * Math.max(0, Math.cos(wrap(entrance - facing)));
      }
      if (viewer) {
        const d = Math.hypot(p.x - viewer.x, p.z - viewer.z);
        score -= 0.4 * Math.abs(d - 2.5);
        score -= 0.8 * Math.abs(wrap(Math.atan2(p.x - viewer.x, p.z - viewer.z) - viewer.yaw));
      }
      if (wallNormal !== null) {
        // Square to the wall looks built-in; 20 degrees off looks dropped there.
        // Aligned means rot == wallNormal modulo 90 deg: cos(4*delta) is 1 there
        // and -1 at the worst (45 deg) misalignment.
        score += 0.6 * Math.cos(4 * (rot - wallNormal));
      }
      const fits = ev.blocked === 0 && ev.unknownFrac <= maxUnknown;
      const cand = { ...pose, score, fits, ...ev };
      if (fits && (!best || score > best.score)) best = cand;
      // Fallback ranking when nothing fits: fewest obstacles, then most seen.
      const rank = -ev.blockedFrac * 10 - ev.unknownFrac + score * 0.01;
      if (!bestAny || rank > bestAny.rank) bestAny = { ...cand, rank };
    }
  }

  if (best) return { ...best, reason: 'fits' };
  if (!bestAny) return { fits: false, reason: 'no-floor', x: origin.x, z: origin.z, rot: 0, score: -Infinity };
  const reason = bestAny.blockedFrac > 0 ? 'obstacles' : 'not-enough-seen';
  const { rank, ...rest } = bestAny;
  return { ...rest, reason };
}

/**
 * Observations for a rectangular room of known size (the "Room fit check"):
 * the floor is clear, and a band just outside it is wall. Origin at one corner,
 * x along the width, z along the depth.
 */
export function gridFromRoom(widthM, depthM, cell = 0.1) {
  const grid = new OccupancyGrid(cell);
  for (let x = cell / 2; x < widthM; x += cell) {
    for (let z = cell / 2; z < depthM; z += cell) grid.addFloor(x, z);
  }
  const band = 0.4;
  for (let x = -band; x < widthM + band; x += cell) {
    for (let z = -band; z < depthM + band; z += cell) {
      const inside = x > 0 && x < widthM && z > 0 && z < depthM;
      if (!inside) { grid.addBlocked(x, z); grid.addBlocked(x, z); }
    }
  }
  return grid;
}
