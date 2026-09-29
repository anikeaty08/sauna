import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Layout, Vec2 } from '../../../../../packages/configuration-core/index.ts';
import { useStudio, SECTION_TAB, type Section } from '../../store/configurationStore.ts';
import { distanceToBoundary, insidePolygon } from '../../../../../packages/configuration-core/geometry/planMath.ts';
import { PlanFrame } from '../../features/sauna/geometry/placement.ts';

interface View { pos: THREE.Vector3; target: THREE.Vector3; fov: number }

/**
 * Camera preset per configurator section - the stage follows what the customer
 * is editing. `aspect` = canvas width / height: tall phone screens get a wider
 * interior view and a more distant exterior view so the whole sauna fits.
 */
export function viewFor(section: Section, layout: Layout, aspect = 1.1): View {
  const f = new PlanFrame(layout.width, layout.depth);
  const size = Math.max(layout.width, layout.depth);
  const centre: Vec2 = [layout.width / 2, layout.depth / 2];
  const d = layout.door;
  // Standing inside, just behind the glass door, looking into the room: the
  // viewpoint of HolzSauna's interior photos, with the door closed.
  const doorMid: Vec2 = [d.hinge[0] + d.closedDir[0] * d.width * 0.5, d.hinge[1] + d.closedDir[1] * d.width * 0.5];
  const eye = insidePoint(layout, [doorMid[0] - d.outward[0] * 0.35, doorMid[1] - d.outward[1] * 0.35], 0.25);
  const narrow = Math.max(1, 1.1 / aspect); // > 1 on portrait screens
  // Interior = first person: stand at `from` and look towards `at`; the orbit
  // pivot is just in front of the eyes, so dragging turns the head in place.
  const firstPerson = (from: Vec2, fromH: number, at: Vec2, atH: number, fov: number): View => {
    const pos = f.point(from, fromH), look = f.point(at, atH);
    const hfov = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * narrow) * (180 / Math.PI);
    return { pos, target: pos.clone().add(look.sub(pos).setLength(0.6)), fov: Math.min(95, hfov) };
  };
  const benchCorner: Vec2 = [layout.wall + layout.benches.long.depth * 0.6, layout.wall + layout.benches.short.depth * 0.8];
  const heater = layout.placements.find(p => p.key === 'heater');
  const exterior = (dir: Vec2, dist: number, height: number, look = 0.85): View => {
    const n = Math.hypot(dir[0], dir[1]);
    // Narrow screens: back off just enough to fit the width, and aim at the
    // model's true middle so it is centred instead of riding high.
    const k = Math.pow(narrow, 0.75);
    const aim = narrow > 1 ? look + Math.min(0.3, (narrow - 1) * 0.6) : look;
    return { pos: f.point([centre[0] + (dir[0] / n) * dist * k, centre[1] + (dir[1] / n) * dist * k], height * (1 + (k - 1) * 0.4)), target: f.point(centre, aim), fov: 36 };
  };
  switch (section) {
    case 'size': return exterior([1, 0.62], size * 2.15, 2.3);
    case 'door': {
      const mid: Vec2 = [d.hinge[0] + d.closedDir[0] * d.width / 2, d.hinge[1] + d.closedDir[1] * d.width / 2];
      return { pos: f.point([mid[0] + d.outward[0] * 2.6 + d.closedDir[0] * 0.8, mid[1] + d.outward[1] * 2.6 + d.closedDir[1] * 0.8], 1.55), target: f.point(mid, 1.0), fov: 40 };
    }
    case 'heater': if (heater) {
      const p = heater.position, fc = heater.facing;
      return firstPerson(insidePoint(layout, [p[0] + fc[0] * 1.15 - 0.2, p[1] + fc[1] * 1.15 + 0.35], 0.25), 1.45, p, 0.62, 64);
    }
    // falls through to the interior overview when there is no heater
    case 'wood':
    case 'extras': {
      const back: Vec2 = [layout.wall + 0.35, layout.wall + 0.35];
      return firstPerson(eye, 1.6, back, 1.05, 74);
    }
    case 'layout': {
      const lb = layout.benches.lower;
      const c: Vec2 = lb ? [(lb[0][0] + lb[1][0] + lb[2][0]) / 3, (lb[0][1] + lb[1][1] + lb[2][1]) / 3] : benchCorner;
      return firstPerson(eye, 1.7, c, 0.35, 72);
    }
  }
}

/** Whether a world-space point is inside the cabin, `margin` metres clear of walls and glass. */
function insideCabin(L: Layout, v: THREE.Vector3, margin: number): boolean {
  const q: Vec2 = [v.x + L.width / 2, L.depth / 2 - v.z];
  return v.y > 0.3 && v.y < L.height - L.fascia - 0.12 && insidePolygon(L.outline, q) && distanceToBoundary(L.outline, q) >= margin;
}

// Keyboard walking inside (laptops): W/S or arrow up/down = forward/back, A/D = sideways, arrow left/right = turn.
const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Nearest point to `p` that is inside the cabin with room to stand (plan coords). */
function insidePoint(layout: Layout, p: Vec2, margin = 0.3): Vec2 {
  const ok = (q: Vec2) => insidePolygon(layout.outline, q) && distanceToBoundary(layout.outline, q) >= margin;
  if (ok(p)) return p;
  const c: Vec2 = [layout.width * 0.55, layout.depth * 0.5];
  for (let k = 0.1; k <= 1; k += 0.1) {
    const q: Vec2 = [p[0] + (c[0] - p[0]) * k, p[1] + (c[1] - p[1]) * k];
    if (ok(q)) return q;
  }
  return c;
}

export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, invalidate } = useThree() as unknown as { camera: THREE.PerspectiveCamera; invalidate: () => void };
  const section = useStudio(s => s.section);
  const nonce = useStudio(s => s.viewNonce);
  const aspect = useThree(s => s.size.width / Math.max(1, s.size.height));
  const width = useStudio(s => s.layout.width), depth = useStudio(s => s.layout.depth);
  const anim = useRef<{ from: View; to: View; t: number } | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const to = viewFor(section, useStudio.getState().layout, aspect);
    const ctl = controls.current;
    if (!ctl) return;
    if (first.current) {
      first.current = false;
      camera.position.copy(to.pos); ctl.target.copy(to.target); camera.fov = to.fov; camera.updateProjectionMatrix(); ctl.update();
      invalidate();
      return;
    }
    anim.current = { from: { pos: camera.position.clone(), target: ctl.target.clone(), fov: camera.fov }, to, t: 0 };
    invalidate();
    // re-frame when the canvas shape changes a lot (rotating a phone)
  }, [section, nonce, width, depth, camera, invalidate, Math.round(aspect * 4)]);

  // Interior: the camera stays inside the cabin while people look around -
  // orbit and zoom never take it through the walls or glass to the outside.
  const interior = SECTION_TAB[section] === 'interior';
  useEffect(() => {
    const ctl = controls.current;
    if (!ctl) return;
    let lastTarget = ctl.target.clone();
    let busy = false;
    const clamp = () => {
      if (!interior || anim.current || busy) return;
      busy = true;
      try { keepInside(); } finally { busy = false; }
    };
    const keepInside = () => {
      const L = useStudio.getState().layout;
      const toPlan = (v: THREE.Vector3): Vec2 => [v.x + L.width / 2, L.depth / 2 - v.z];
      const ceiling = L.height - L.fascia - 0.12;
      const inside = (v: THREE.Vector3, margin: number) => { const q = toPlan(v); return v.y > 0.3 && v.y < ceiling && insidePolygon(L.outline, q) && distanceToBoundary(L.outline, q) >= margin; };
      const ok = (v: THREE.Vector3) => inside(v, 0.12);
      // Walking: panning moves the look-at point; it may not leave the cabin.
      if (!inside(ctl.target, 0.2)) {
        const back = lastTarget.clone().sub(ctl.target);
        ctl.target.add(back); camera.position.add(back);
      }
      // Zooming in past the pivot keeps walking forward instead of stopping.
      const dist = camera.position.distanceTo(ctl.target);
      if (dist < 0.25) {
        const step = new THREE.Vector3().subVectors(ctl.target, camera.position).setY(0);
        if (step.lengthSq() > 1e-6) {
          step.setLength(0.35);
          const next = ctl.target.clone().add(step);
          if (inside(next, 0.2)) { ctl.target.copy(next); camera.position.add(step); }
        }
      }
      lastTarget = ctl.target.clone();
      if (ok(camera.position)) return;
      // pull the camera back towards what it looks at until it is inside again
      const t = ctl.target, p = camera.position.clone();
      let lo = 0, hi = 1;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; ok(new THREE.Vector3().lerpVectors(t, p, mid)) ? (lo = mid) : (hi = mid); }
      camera.position.lerpVectors(t, p, lo);
    };
    ctl.addEventListener('change', clamp);
    return () => ctl.removeEventListener('change', clamp);
  }, [interior, camera]);

  const keys = useRef(new Set<string>());
  useEffect(() => {
    if (!interior) { keys.current.clear(); return; }
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
    const down = (e: KeyboardEvent) => {
      if (!WALK_KEYS.has(e.code) || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault(); // arrows would otherwise scroll the page
      keys.current.add(e.code);
      invalidate();
    };
    const up = (e: KeyboardEvent) => { keys.current.delete(e.code); };
    const clear = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); };
  }, [interior, invalidate]);

  useFrame((_, dt) => {
    const ctl = controls.current;
    const k = keys.current;
    if (ctl && interior && !anim.current && k.size) {
      const L = useStudio.getState().layout;
      const fwd = new THREE.Vector3().subVectors(ctl.target, camera.position).setY(0);
      if (fwd.lengthSq() > 1e-8) {
        fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const step = Math.min(dt, 0.05);
        const turn = ((k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0)) * 1.6 * step;
        if (turn) {
          // turn the head: swing the look-at point around the eyes
          const off = new THREE.Vector3().subVectors(ctl.target, camera.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
          ctl.target.copy(camera.position).add(off);
        }
        const move = new THREE.Vector3()
          .addScaledVector(fwd, (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0))
          .addScaledVector(right, (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0));
        if (move.lengthSq() > 0) {
          move.setLength(1.1 * step); // ~1.1 m/s, a slow walk
          // slide along walls: try the full step, then each axis on its own
          for (const m of [move, new THREE.Vector3(move.x, 0, 0), new THREE.Vector3(0, 0, move.z)]) {
            if (insideCabin(L, camera.position.clone().add(m), 0.15) && insideCabin(L, ctl.target.clone().add(m), 0.15)) {
              camera.position.add(m); ctl.target.add(m); break;
            }
          }
        }
        ctl.update();
      }
      invalidate(); // keep frames coming while a key is held (frameloop="demand")
    }
    const a = anim.current;
    if (!a || !ctl) return;
    a.t = Math.min(1, a.t + dt / 0.9);
    const e = 1 - Math.pow(1 - a.t, 3);
    camera.position.lerpVectors(a.from.pos, a.to.pos, e);
    ctl.target.lerpVectors(a.from.target, a.to.target, e);
    camera.fov = a.from.fov + (a.to.fov - a.from.fov) * e;
    camera.updateProjectionMatrix();
    ctl.update();
    if (a.t >= 1) anim.current = null;
    invalidate();
  });

  return (
    <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08}
      minDistance={interior ? 0.15 : 0.4} maxDistance={interior ? 1.6 : 14}
      minPolarAngle={interior ? Math.PI * 0.2 : 0} maxPolarAngle={interior ? Math.PI * 0.8 : Math.PI * 0.495}
      // inside, panning walks along the floor (kept within the walls)
      enablePan screenSpacePanning={!interior} />
  );
}
