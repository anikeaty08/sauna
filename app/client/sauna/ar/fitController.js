/**
 * The AR session's "brain": turns a stream of raw world-space hits into a
 * placement decision, with no camera, three.js or DOM involved - so it can be
 * driven by WebXR on a phone and by synthetic rooms in unit tests alike.
 *
 *   scanning  -> no floor found yet
 *   searching -> floor known, looking for clear space big enough
 *   placed    -> a fitting pose is shown, still refining as more floor is seen
 *   locked    -> held still: stable fit, manual placement, or gave up
 *
 * Samples are { x, y, z, ny } in metres: ny is the Y component of the surface
 * normal (1 = floor-like, 0 = wall-like, -1 = ceiling), or null when unknown.
 */
import { OccupancyGrid, planPlacement, evaluatePose, footprintSamples } from './fitPlanner.js';

const percentile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};

export class FitController {
  /**
   * spec: { width, depth, height, margin, swing }  (see fitPlanner)
   */
  constructor(spec, opts = {}) {
    this.spec = spec;
    this.opts = {
      cell: 0.1, planEveryMs: 600, lockAfterMs: 2500, giveUpMs: 12000, minFloorSamples: 20,
      floorTolerance: 0.06, obstacleAbove: 0.1, ...opts,
    };
    this.grid = new OccupancyGrid(this.opts.cell);
    this.upYs = [];
    this.ceilingYs = [];
    this.pending = [];           // hits seen before the floor height was known
    this.floorY = null;
    this.phase = 'scanning';
    this.pose = null;            // { x, z, rot, fits, reason, ... }
    this.manual = false;
    this.lastPlanAt = -Infinity;
    this.searchStartedAt = null;
    this.stableSince = null;
    this.hitCount = 0;
    this.evalSamples = footprintSamples(spec, this.opts.cell);
  }

  ingest(samples) {
    for (const s of samples) {
      this.hitCount++;
      if (s.ny !== null && s.ny !== undefined && s.ny > 0.85) this.upYs.push(s.y);
      if (s.ny !== null && s.ny !== undefined && s.ny < -0.85) { this.ceilingYs.push(s.y); continue; }
      if (this.floorY === null) this.pending.push(s);
      else this.classify(s);
    }
    // The floor is the LOWEST large horizontal surface - tables and bench tops
    // are horizontal too, so take a low percentile rather than the average.
    if (this.upYs.length >= this.opts.minFloorSamples) {
      const prev = this.floorY;
      this.floorY = percentile(this.upYs, 0.15);
      if (prev === null) {
        for (const s of this.pending) this.classify(s);
        this.pending = [];
      }
    }
  }

  classify(s) {
    const { floorTolerance, obstacleAbove } = this.opts;
    const h = s.y - this.floorY;
    const floorLike = s.ny === null || s.ny === undefined || s.ny > 0.85;
    if (Math.abs(h) < floorTolerance && floorLike) this.grid.addFloor(s.x, s.z, 1);
    // Anything standing between the floor and the top of the cabin blocks it;
    // a shelf or lamp above cabin height does not.
    else if (h > obstacleAbove && h < (this.spec.height || 2.2) + 0.05) this.grid.addBlocked(s.x, s.z);
  }

  get ceilingY() {
    return this.ceilingYs.length >= 5 ? percentile(this.ceilingYs, 0.5) : null;
  }

  warnings() {
    const w = [];
    const c = this.ceilingY;
    if (c !== null && this.floorY !== null && c - this.floorY < (this.spec.height || 0) + 0.05) w.push('ceiling-low');
    return w;
  }

  /** Is it time to run the (expensive) planner? Lets the caller run it in a worker. */
  wantsPlan(now) {
    if (this.floorY === null) return false;
    if (this.phase === 'locked' && !this.manual) return false;
    return now - this.lastPlanAt >= this.opts.planEveryMs;
  }

  /** Serializable planner input - grid cells, spec, options - for a Web Worker. */
  planInput(viewer) {
    return {
      cell: this.grid.cell,
      cells: [...this.grid.cells.values()],
      spec: this.spec,
      opts: { viewer },
    };
  }

  /** Feed a planner result back in (from a worker, or computed inline). */
  applyPlan(result, now) {
    this.lastPlanAt = now;
    if (this.searchStartedAt === null) this.searchStartedAt = now;

    if (this.manual) {
      // Held where the person put it; only the fit verdict tracks new floor.
      this.reevaluate();
      return;
    }
    const cur = this.pose;
    const better = !cur
      || (result.fits && !cur.fits)
      || (result.fits === cur.fits && result.score > cur.score + 0.3);
    if (better) {
      const moved = !cur || Math.hypot(result.x - cur.x, result.z - cur.z) > 0.15 || Math.abs(result.rot - cur.rot) > 0.1;
      this.pose = result;
      if (moved) this.stableSince = now;
    }

    if (this.pose.fits) {
      this.phase = 'placed';
      if (now - this.stableSince >= this.opts.lockAfterMs) this.phase = 'locked';
    } else {
      this.phase = 'searching';
      if (now - this.searchStartedAt >= this.opts.giveUpMs) this.phase = 'locked';   // show best effort, red
    }
  }

  /** Convenience for single-threaded use (and tests): plan inline if due. */
  update(viewer, now) {
    if (this.wantsPlan(now)) this.applyPlan(planPlacement(this.grid, this.spec, { viewer }), now);
    return this.state();
  }

  reevaluate() {
    if (!this.pose) return;
    const ev = evaluatePose(this.grid, this.evalSamples, this.pose);
    const fits = ev.blocked === 0 && ev.unknownFrac <= 0.2;
    this.pose = { ...this.pose, ...ev, fits, reason: fits ? 'fits' : ev.blocked ? 'obstacles' : 'not-enough-seen' };
  }

  /** Person tapped a spot: put it there, keep its rotation, hold it. */
  placeManually(x, z, viewer) {
    const rot = this.pose ? this.pose.rot : (viewer ? Math.atan2(viewer.x - x, viewer.z - z) : 0);
    this.pose = { x, z, rot, score: 0 };
    this.manual = true;
    this.phase = 'locked';
    this.reevaluate();
  }

  rotateBy(delta) {
    if (!this.pose) return;
    this.pose = { ...this.pose, rot: this.pose.rot + delta };
    this.manual = true;
    this.phase = 'locked';
    this.reevaluate();
  }

  /** Let the planner choose again. */
  refit(now) {
    this.manual = false;
    this.phase = this.floorY === null ? 'scanning' : 'searching';
    this.searchStartedAt = now;
    this.stableSince = now;
    this.lastPlanAt = -Infinity;
  }

  state() {
    return {
      phase: this.phase,
      pose: this.pose,
      floorY: this.floorY,
      manual: this.manual,
      hits: this.hitCount,
      seenArea: this.grid.freeCells().length * this.grid.cell * this.grid.cell,
      warnings: this.warnings(),
    };
  }
}

/** Rebuild a grid from planInput() cells (worker side). */
export function gridFromCells(cell, cells) {
  const g = new OccupancyGrid(cell);
  for (const e of cells) g.cells.set(g.key(g.index(e.x), g.index(e.z)), { ...e });
  return g;
}
