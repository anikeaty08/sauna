import * as THREE from 'three';
import type { Vec2 } from '../../../../../../packages/configuration-core/index.ts';

/**
 * Plan (x, y) -> world. Plan y points away from the back wall; world is Y-up
 * with the cabin centred on the origin. Z = -y keeps the plan's handedness when
 * seen from above (plan up = screen up).
 */
export class PlanFrame {
  constructor(readonly width: number, readonly depth: number) {}
  point(p: Vec2, elevation = 0): THREE.Vector3 { return new THREE.Vector3(p[0] - this.width / 2, elevation, this.depth / 2 - p[1]); }
  dir(d: Vec2): THREE.Vector3 { return new THREE.Vector3(d[0], 0, -d[1]).normalize(); }
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Basis whose +Z points along `facing` (the module's front) and +X = Y x Z.
 * `mirror` flips X (left/right-hinged door variants are mirror images).
 */
export function facingMatrix(position: THREE.Vector3, facing: THREE.Vector3, mirror = false): THREE.Matrix4 {
  const z = facing.clone().setY(0).normalize();
  const x = new THREE.Vector3().crossVectors(UP, z).normalize();
  if (mirror) x.negate();
  return new THREE.Matrix4().makeBasis(x, UP, z).setPosition(position);
}

/**
 * A 1 m profile module laid from `from` to `to` with its front towards
 * `facing`. Returns the placement matrix (unit length) and the run length;
 * the run direction is reversed when needed so that +X x +Y stays = facing.
 */
export function runMatrix(from: THREE.Vector3, to: THREE.Vector3, facing: THREE.Vector3): { matrix: THREE.Matrix4; length: number } {
  const z = facing.clone().setY(0).normalize();
  const x = new THREE.Vector3().crossVectors(UP, z).normalize();
  const along = to.clone().sub(from);
  const start = along.dot(x) >= 0 ? from : to;
  return { matrix: new THREE.Matrix4().makeBasis(x, UP, z).setPosition(start), length: Math.abs(along.dot(x)) };
}
