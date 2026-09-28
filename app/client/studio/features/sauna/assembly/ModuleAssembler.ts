import * as THREE from 'three';
import { MODULES, type Layout, type ModuleGroup, type SaunaConfiguration, type Vec2 } from '../../../../../../packages/configuration-core/index.ts';
import { loadModules, type LoadedModule } from '../modules/moduleLoader.ts';
import { MaterialLibrary } from '../materials/materialLibrary.ts';
import { PlanFrame, facingMatrix, runMatrix } from '../geometry/placement.ts';
import { boxUV, fascia, footprintCap, glassPane, segmentMatrix, solidWall } from '../geometry/structureGenerator.ts';

const GROUPS: ModuleGroup[] = ['structure', 'exterior', 'glass', 'door', 'benches', 'heater', 'lighting', 'accessories'];
/** Texture size of the bench wood strip (grain along u). */
const WOOD_UV: [number, number] = [1.0, 0.147];

interface Instance { matrix: THREE.Matrix4; length?: number; stretch?: [number, number] }

/**
 * Module resolver: the modules this configuration needs. Only these are
 * downloaded - e.g. a heater GLB is fetched only once its set is chosen.
 */
export function resolveModules(layout: Layout): string[] {
  const ids = new Set(['slate-panel', 'glass-profile', 'glass-door', 'bench-slat', 'bench-bearer', 'backrest-rail', 'skirt-slat']);
  for (const p of layout.placements) ids.add(p.module);
  for (const r of layout.runs) ids.add(r.module);
  return [...ids];
}

/**
 * Runtime assembly engine. Builds the sauna as independent groups (one per
 * ModuleGroup); `update` rebuilds only the groups the dependency graph marks
 * dirty and disposes exactly the geometry those groups created.
 */
export class ModuleAssembler {
  readonly root = new THREE.Group();
  readonly materials: MaterialLibrary;
  doorPivot: THREE.Group | null = null;
  doorOpenSign = 1;
  private groups = new Map<ModuleGroup, THREE.Group>();
  private owned = new Map<ModuleGroup, THREE.BufferGeometry[]>();
  private modules = new Map<string, LoadedModule>();

  constructor(materials?: MaterialLibrary) {
    this.materials = materials ?? new MaterialLibrary();
    this.root.name = 'zirbe_6eck';
    for (const g of GROUPS) { const grp = new THREE.Group(); grp.name = g; this.groups.set(g, grp); this.root.add(grp); this.owned.set(g, []); }
  }

  async update(config: SaunaConfiguration, layout: Layout, dirty: Set<ModuleGroup>) {
    const needed = resolveModules(layout).filter(id => !this.modules.has(id));
    if (needed.length) for (const [id, m] of await loadModules(needed)) this.modules.set(id, m);
    if (dirty.has('materials') || dirty.size === 0) this.materials.setBenchWood(config.materials.benchWood);
    const frame = new PlanFrame(layout.width, layout.depth);
    for (const g of GROUPS) if (dirty.has(g)) this.rebuild(g, frame, layout);
  }

  private rebuild(group: ModuleGroup, frame: PlanFrame, layout: Layout) {
    const grp = this.groups.get(group)!;
    for (const child of [...grp.children]) grp.remove(child);
    for (const geo of this.owned.get(group)!) geo.dispose();
    this.owned.set(group, []);
    const own = (g: THREE.BufferGeometry) => { this.owned.get(group)!.push(g); return g; };
    // Only large parts cast shadows: hundreds of slat/tile instances in the
    // shadow pass cost far more than they add visually (matters on phones).
    const casts = group === 'structure' || group === 'heater' || group === 'door';
    const add = (o: THREE.Object3D) => { o.traverse(c => { const mesh = (c as THREE.Mesh).isMesh ?? false; c.receiveShadow = mesh; c.castShadow = mesh && casts; }); grp.add(o); };
    const m = this.materials.slots;
    const smats = { zirbe: m.zirbe, slate: m.slate, glass: m.glass, floor: m.floor };

    switch (group) {
      case 'structure': {
        for (const seg of layout.segments) if (seg.kind === 'solid') { const w = solidWall(frame, seg, layout, smats); own(w.geometry); add(w); }
        for (const kind of ['roof', 'ceiling', 'floor'] as const) { const c = footprintCap(frame, layout, kind, smats); own(c.geometry); add(c); }
        break;
      }
      case 'exterior': {
        // Real 400 x 570 slate tiles, fitted to each solid face (rectified joints).
        const panels: Instance[] = [];
        const clearH = layout.height - layout.fascia;
        for (const seg of layout.segments) {
          if (seg.kind !== 'solid') continue;
          const cols = Math.max(1, Math.round(seg.length / 0.4)), rows = Math.max(1, Math.round(clearH / 0.57));
          const pw = seg.length / cols, ph = clearH / rows;
          const base = segmentMatrix(frame, seg);
          for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
            const local = new THREE.Matrix4().makeTranslation(i * pw, j * ph, 0).multiply(new THREE.Matrix4().makeScale(pw / 0.4, ph / 0.57, 1));
            panels.push({ matrix: base.clone().multiply(local) });
          }
        }
        add(this.instances('slate-panel', panels, own));
        for (const seg of layout.segments) { const f = fascia(frame, seg, layout, smats); own(f.geometry); add(f); }
        break;
      }
      case 'glass': {
        const profiles: Instance[] = [];
        for (const seg of layout.segments) {
          if (seg.kind === 'solid') continue;
          const spans: [number, number][] = seg.kind === 'door-glass' ? [layout.door.fixedPane] : [[0.004, seg.length - 0.004]];
          for (const [u0, u1] of spans) {
            const pane = glassPane(frame, seg, layout, u0, u1, smats); own(pane.geometry); add(pane);
            // aluminium profile at the floor (no threshold under the door itself)
            profiles.push({ matrix: segmentMatrix(frame, seg, u0, layout.wall / 2), length: u1 - u0 });
          }
        }
        add(this.instances('glass-profile', profiles, own));
        break;
      }
      case 'door': {
        const d = layout.door;
        const hinge = frame.point(d.hinge);
        const outward = frame.dir(d.outward);
        // Module leaf runs along +X from the hinge; mirror when the leaf must
        // run the other way (a left- vs right-hinged door is a mirror image).
        const plain = facingMatrix(hinge, outward);
        const x = new THREE.Vector3().setFromMatrixColumn(plain, 0);
        const mirror = x.dot(frame.dir(d.closedDir)) < 0;
        const pivot = new THREE.Group();
        pivot.name = 'door_pivot';
        pivot.applyMatrix4(facingMatrix(hinge, outward, mirror));
        pivot.add(this.moduleObject('glass-door'));
        this.doorPivot = pivot;
        // Opening outward = rotating the leaf's free end towards +Z (outside).
        this.doorOpenSign = mirror ? 1 : -1;
        add(pivot);
        break;
      }
      case 'benches': this.buildBenches(frame, layout, add, own); break;
      case 'heater':
      case 'accessories': {
        for (const p of layout.placements) {
          const cat = MODULES[p.module]?.category;
          const mine = group === 'heater' ? (cat === 'heater' || cat === 'control') : cat === 'accessory';
          if (!mine) continue;
          const obj = this.moduleObject(p.module);
          obj.applyMatrix4(facingMatrix(frame.point(p.position, p.elevation), frame.dir(p.facing)));
          obj.name = p.key;
          add(obj);
        }
        break;
      }
      case 'lighting': {
        const lights: Instance[] = [];
        for (const p of layout.placements.filter(q => q.module === 'downlight')) {
          const pos = frame.point(p.position, p.elevation);
          lights.push({ matrix: facingMatrix(pos, new THREE.Vector3(0, 0, 1)) });
          const lamp = new THREE.PointLight(0xffc98f, 3.2, 4.5, 1.5);
          lamp.position.copy(pos).add(new THREE.Vector3(0, -0.12, 0));
          grp.add(lamp);
        }
        if (lights.length) add(this.instances('downlight', lights, own));
        const strips: Instance[] = [];
        for (const r of layout.runs.filter(q => q.module === 'led-strip')) {
          const { matrix, length } = runMatrix(frame.point(r.from, r.elevation), frame.point(r.to, r.elevation), frame.dir(r.facing));
          strips.push({ matrix, length });
          const glow = new THREE.PointLight(0xffa860, 1.6, 2.2, 1.6);
          glow.position.copy(frame.point(r.from, r.elevation - 0.15)).lerp(frame.point(r.to, r.elevation - 0.15), 0.5);
          grp.add(glow);
        }
        if (strips.length) add(this.instances('led-strip', strips, own));
        break;
      }
    }
  }

  /** Upper benches (slats on bearers, skirts, backrests) and the lower bench, from profile modules. */
  private buildBenches(frame: PlanFrame, layout: Layout, add: (o: THREE.Object3D) => void, own: (g: THREE.BufferGeometry) => THREE.BufferGeometry) {
    const b = layout.benches, t = layout.wall;
    const slat = 0.09, gap = 0.012, pitch = slat + gap;
    const slats: Instance[] = [], bearers: Instance[] = [], skirts: Instance[] = [], rails: Instance[] = [];
    const F = (p: Vec2, y: number) => frame.point(p, y);
    const along = (from: Vec2, to: Vec2, y: number, facing: Vec2, list: Instance[]) => { const r = runMatrix(F(from, y), F(to, y), frame.dir(facing)); list.push({ matrix: r.matrix, length: r.length }); };

    // long bench: slats run along the left wall
    const x0 = t, x1 = t + b.long.depth, y0 = t, y1 = b.long.to[1];
    for (let x = x0 + slat / 2; x <= x1 - slat / 2 + 1e-6; x += pitch) along([x, y0], [x, y1], b.upperHeight, [1, 0], slats);
    for (let y = y0 + 0.05; y < y1; y += 0.8) along([x0, y], [x1, y], b.upperHeight - 0.028, [0, 1], bearers);
    // short bench: slats run along the back wall
    const sx0 = x1, sx1 = b.short.to[0], sy1 = t + b.short.depth;
    for (let y = t + slat / 2; y <= sy1 - slat / 2 + 1e-6; y += pitch) along([sx0, y], [sx1, y], b.upperHeight, [0, 1], slats);
    for (let x = sx1 - 0.05; x > sx0; x -= 0.8) along([x, t], [x, sy1], b.upperHeight - 0.028, [1, 0], bearers);
    // under-bench cladding on both upper benches, and the short bench's end panel
    const skirtH = b.upperHeight - 0.028;
    const skirtRun = (from: Vec2, to: Vec2, facing: Vec2) => {
      const len = Math.hypot(to[0] - from[0], to[1] - from[1]), n = Math.max(1, Math.floor(len / 0.078));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        const p: Vec2 = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
        skirts.push({ matrix: facingMatrix(F(p, 0), frame.dir(facing)), length: skirtH });
      }
    };
    skirtRun([x1, sy1], [x1, y1], [1, 0]);
    skirtRun([sx0, sy1], [sx1, sy1], [0, 1]);
    skirtRun([sx1, t], [sx1, sy1], [1, 0]);
    // backrests: two rails per wall, slightly rounded top
    for (const dy of [0.22, 0.36]) {
      along([t, y0], [t, y1], b.upperHeight + dy, [1, 0], rails);
      along([t, t], [sx1, t], b.upperHeight + dy, [0, 1], rails);
    }
    // movable lower bench: diagonally slatted triangle on feet
    if (b.lower) {
      const [O, A, B] = b.lower;
      const hypLen = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const u: Vec2 = [(B[0] - A[0]) / hypLen, (B[1] - A[1]) / hypLen];
      let nIn: Vec2 = [-u[1], u[0]];
      if ((O[0] - A[0]) * nIn[0] + (O[1] - A[1]) * nIn[1] < 0) nIn = [-nIn[0], -nIn[1]]; // towards the corner O
      const h = (O[0] - A[0]) * nIn[0] + (O[1] - A[1]) * nIn[1];
      // Slats parallel to the hypotenuse; each spans the triangle at its offset.
      for (let s = slat / 2 + 0.01; s < h - 0.06; s += pitch) {
        const k = s / h;
        const P: Vec2 = [A[0] + (O[0] - A[0]) * k + u[0] * 0.03, A[1] + (O[1] - A[1]) * k + u[1] * 0.03];
        const Q: Vec2 = [B[0] + (O[0] - B[0]) * k - u[0] * 0.03, B[1] + (O[1] - B[1]) * k - u[1] * 0.03];
        along(P, Q, b.lowerHeight, [-nIn[0], -nIn[1]], slats);
      }
      const feetH = b.lowerHeight - 0.028;
      const inset = (p: Vec2): Vec2 => [p[0] + ((O[0] + A[0] + B[0]) / 3 - p[0]) * 0.18, p[1] + ((O[1] + A[1] + B[1]) / 3 - p[1]) * 0.18];
      for (const p of [inset(O), inset(A), inset(B)]) skirts.push({ matrix: facingMatrix(F(p, 0), frame.dir(nIn)), length: feetH });
    }
    for (const [id, list] of [['bench-slat', slats], ['bench-bearer', bearers], ['skirt-slat', skirts], ['backrest-rail', rails]] as const) {
      if (list.length) add(this.instances(id, list, own));
    }
  }

  /** A placed (fixed-size) module as a group of meshes with library materials. */
  private moduleObject(id: string): THREE.Group {
    const mod = this.modules.get(id);
    const g = new THREE.Group();
    g.name = id;
    if (!mod) return g;
    for (const part of mod.parts) {
      const mesh = new THREE.Mesh(part.geometry, this.materials.forModuleMaterial(part.material));
      mesh.applyMatrix4(part.matrix);
      g.add(mesh);
    }
    return g;
  }

  /**
   * Instanced placement of a module. Profiles are stretched along their
   * length axis only (one geometry per distinct length, UVs re-projected at
   * world scale so the grain is never stretched); everything else is instanced
   * as authored.
   */
  private instances(id: string, list: Instance[], own: (g: THREE.BufferGeometry) => THREE.BufferGeometry): THREE.Group {
    const mod = this.modules.get(id), spec = MODULES[id];
    const out = new THREE.Group();
    out.name = id;
    if (!mod || !list.length) return out;
    const axis = spec.lengthAxis === 'y' ? 1 : 0;
    const byLength = new Map<number, Instance[]>();
    for (const inst of list) {
      const key = spec.kind === 'profile' ? Math.round((inst.length ?? 1) * 1000) : 0;
      (byLength.get(key) ?? byLength.set(key, []).get(key)!).push(inst);
    }
    for (const [lenMm, insts] of byLength) {
      for (const part of mod.parts) {
        let geo = part.geometry;
        let partMatrix = part.matrix;
        if (spec.kind === 'profile') {
          geo = own(part.geometry.clone().applyMatrix4(part.matrix));
          const s = lenMm / 1000, pos = geo.attributes.position;
          for (let i = 0; i < pos.count; i++) axis === 0 ? pos.setX(i, pos.getX(i) * s) : pos.setY(i, pos.getY(i) * s);
          geo.computeVertexNormals();
          if (part.material.name === 'slot:bench_wood') boxUV(geo, WOOD_UV[0], WOOD_UV[1], axis === 1 ? 'y' : 'x');
          partMatrix = new THREE.Matrix4();
        }
        const mesh = new THREE.InstancedMesh(geo, this.materials.forModuleMaterial(part.material), insts.length);
        insts.forEach((inst, i) => mesh.setMatrixAt(i, inst.matrix.clone().multiply(partMatrix)));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        out.add(mesh);
      }
    }
    return out;
  }

  dispose() {
    for (const list of this.owned.values()) for (const g of list) g.dispose();
    this.materials.dispose();
  }
}
