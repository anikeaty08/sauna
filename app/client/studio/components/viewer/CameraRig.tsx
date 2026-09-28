import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Layout, Vec2 } from '../../../../../packages/configuration-core/index.ts';
import { useStudio, type Section } from '../../store/configurationStore.ts';
import { PlanFrame } from '../../features/sauna/geometry/placement.ts';

interface View { pos: THREE.Vector3; target: THREE.Vector3; fov: number }

/** Camera preset per configurator section - the stage follows what the customer is editing. */
export function viewFor(section: Section, layout: Layout): View {
  const f = new PlanFrame(layout.width, layout.depth);
  const size = Math.max(layout.width, layout.depth);
  const centre: Vec2 = [layout.width / 2, layout.depth / 2];
  const d = layout.door;
  // Just outside the door opening (the door swings out of the way for interior views).
  const doorway: Vec2 = [d.hinge[0] + d.closedDir[0] * d.width * 0.5 + d.outward[0] * 0.35, d.hinge[1] + d.closedDir[1] * d.width * 0.5 + d.outward[1] * 0.35];
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
      return { pos: f.point([p[0] + fc[0] * 1.15 - 0.2, p[1] + fc[1] * 1.15 + 0.35], 1.45), target: f.point(p, 0.62), fov: 55 };
    }
    // falls through to the interior overview when there is no heater
    case 'wood':
    case 'extras': {
      // Standing in the open doorway looking into the bench corner - the same
      // viewpoint as HolzSauna's interior photos.
      const back: Vec2 = [layout.wall + 0.35, layout.wall + 0.35];
      return { pos: f.point(doorway, 1.6), target: f.point(back, 0.95), fov: 58 };
    }
    case 'layout': {
      const lb = layout.benches.lower;
      const c: Vec2 = lb ? [(lb[0][0] + lb[1][0] + lb[2][0]) / 3, (lb[0][1] + lb[1][1] + lb[2][1]) / 3] : benchCorner;
      return { pos: f.point(doorway, 1.75), target: f.point(c, 0.3), fov: 56 };
    }
  }
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

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={0.4} maxDistance={14} maxPolarAngle={Math.PI * 0.495} enablePan />;
}
