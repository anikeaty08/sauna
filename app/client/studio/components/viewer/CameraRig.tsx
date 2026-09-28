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

/** Camera preset per configurator section - the stage follows what the customer is editing. */
export function viewFor(section: Section, layout: Layout): View {
  const f = new PlanFrame(layout.width, layout.depth);
  const size = Math.max(layout.width, layout.depth);
  const centre: Vec2 = [layout.width / 2, layout.depth / 2];
  const d = layout.door;
  // Standing inside, just behind the glass door, looking into the room: the
  // viewpoint of HolzSauna's interior photos, with the door closed.
  const doorMid: Vec2 = [d.hinge[0] + d.closedDir[0] * d.width * 0.5, d.hinge[1] + d.closedDir[1] * d.width * 0.5];
  const eye = insidePoint(layout, [doorMid[0] - d.outward[0] * 0.7, doorMid[1] - d.outward[1] * 0.7]);
  const benchCorner: Vec2 = [layout.wall + layout.benches.long.depth * 0.6, layout.wall + layout.benches.short.depth * 0.8];
  const heater = layout.placements.find(p => p.key === 'heater');
  const exterior = (dir: Vec2, dist: number, height: number, look = 0.85): View => {
    const n = Math.hypot(dir[0], dir[1]);
    return { pos: f.point([centre[0] + (dir[0] / n) * dist, centre[1] + (dir[1] / n) * dist], height), target: f.point(centre, look), fov: 36 };
  };
  switch (section) {
    case 'size': return exterior([1, 0.62], size * 2.15, 2.3);
    case 'door': {
      const mid: Vec2 = [d.hinge[0] + d.closedDir[0] * d.width / 2, d.hinge[1] + d.closedDir[1] * d.width / 2];
      return { pos: f.point([mid[0] + d.outward[0] * 2.6 + d.closedDir[0] * 0.8, mid[1] + d.outward[1] * 2.6 + d.closedDir[1] * 0.8], 1.55), target: f.point(mid, 1.0), fov: 40 };
    }
    case 'heater': if (heater) {
      const p = heater.position, fc = heater.facing;
      return { pos: f.point(insidePoint(layout, [p[0] + fc[0] * 1.15 - 0.2, p[1] + fc[1] * 1.15 + 0.35]), 1.45), target: f.point(p, 0.62), fov: 58 };
    }
    // falls through to the interior overview when there is no heater
    case 'wood':
    case 'extras': {
      const back: Vec2 = [layout.wall + 0.35, layout.wall + 0.35];
      return { pos: f.point(eye, 1.55), target: f.point(back, 0.95), fov: 66 };
    }
    case 'layout': {
      const lb = layout.benches.lower;
      const c: Vec2 = lb ? [(lb[0][0] + lb[1][0] + lb[2][0]) / 3, (lb[0][1] + lb[1][1] + lb[2][1]) / 3] : benchCorner;
      return { pos: f.point(eye, 1.7), target: f.point(c, 0.3), fov: 64 };
    }
  }
}

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
  const width = useStudio(s => s.layout.width), depth = useStudio(s => s.layout.depth);
  const anim = useRef<{ from: View; to: View; t: number } | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const to = viewFor(section, useStudio.getState().layout);
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
  }, [section, nonce, width, depth, camera, invalidate]);

  // Interior: the camera stays inside the cabin while people look around -
  // orbit and zoom never take it through the walls or glass to the outside.
  const interior = SECTION_TAB[section] === 'interior';
  useEffect(() => {
    const ctl = controls.current;
    if (!ctl) return;
    const clamp = () => {
      if (!interior || anim.current) return;
      const L = useStudio.getState().layout;
      const toPlan = (v: THREE.Vector3): Vec2 => [v.x + L.width / 2, L.depth / 2 - v.z];
      const ceiling = L.height - L.fascia - 0.12;
      const ok = (v: THREE.Vector3) => { const q = toPlan(v); return v.y > 0.35 && v.y < ceiling && insidePolygon(L.outline, q) && distanceToBoundary(L.outline, q) >= 0.12; };
      if (ok(camera.position) || !ok(ctl.target)) return;
      // pull the camera back towards what it looks at until it is inside again
      const t = ctl.target, p = camera.position.clone();
      let lo = 0, hi = 1;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; ok(new THREE.Vector3().lerpVectors(t, p, mid)) ? (lo = mid) : (hi = mid); }
      camera.position.lerpVectors(t, p, lo);
    };
    ctl.addEventListener('change', clamp);
    return () => ctl.removeEventListener('change', clamp);
  }, [interior, camera]);

  useFrame((_, dt) => {
    const a = anim.current, ctl = controls.current;
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
      minDistance={interior ? 0.2 : 0.4} maxDistance={interior ? 3 : 14}
      minPolarAngle={interior ? Math.PI * 0.2 : 0} maxPolarAngle={interior ? Math.PI * 0.8 : Math.PI * 0.495}
      enablePan={!interior} />
  );
}
