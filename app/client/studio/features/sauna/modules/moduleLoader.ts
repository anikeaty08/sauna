import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODULES } from '../../../../../../packages/configuration-core/index.ts';

/**
 * A loaded module reduced to what the assembler needs: its meshes with their
 * transform relative to the module root. Loaded once per URL (cached), only
 * when the resolver asks for it.
 */
export interface ModulePart { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }
export interface LoadedModule { id: string; parts: ModulePart[]; extras: Record<string, unknown> }

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedModule>>();

export function loadModule(id: string): Promise<LoadedModule> {
  const spec = MODULES[id];
  if (!spec) return Promise.reject(new Error(`Unknown module "${id}"`));
  let p = cache.get(spec.assetUrl);
  if (!p) {
    p = loader.loadAsync(spec.assetUrl).then(gltf => {
      const root = gltf.scene.getObjectByName(id) ?? gltf.scene;
      root.updateMatrixWorld(true);
      const inv = root.matrixWorld.clone().invert();
      const parts: ModulePart[] = [];
      root.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        parts.push({ geometry: mesh.geometry, material: mats[0], matrix: inv.clone().multiply(mesh.matrixWorld) });
      });
      return { id, parts, extras: (root.userData ?? {}) as Record<string, unknown> };
    });
    p.catch(() => cache.delete(spec.assetUrl));
    cache.set(spec.assetUrl, p);
  }
  return p;
}

export function loadModules(ids: Iterable<string>): Promise<Map<string, LoadedModule>> {
  const unique = [...new Set(ids)];
  return Promise.all(unique.map(loadModule)).then(list => new Map(list.map(m => [m.id, m])));
}
