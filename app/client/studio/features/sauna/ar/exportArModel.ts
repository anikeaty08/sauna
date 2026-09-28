import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Layout, SaunaConfiguration } from '../../../../../../packages/configuration-core/index.ts';
import { dirtyGroups } from '../../../../../../packages/configuration-core/index.ts';
import { ModuleAssembler } from '../assembly/ModuleAssembler.ts';

/**
 * The exact configured sauna as files for the phone's own AR viewers, the way
 * web shops ship "View in your room": a GLB for Android Scene Viewer and a
 * USDZ for iPhone Quick Look, both at true scale (1 unit = 1 m).
 *
 * Normalised for AR: door closed, lights removed, the inner floor removed (the
 * real floor shows), footprint centred on the origin, floor at y = 0, and every
 * group of repeated parts (bench slats, slate tiles) merged into one mesh per
 * material - the native viewers handle a few plain meshes far better than
 * hundreds of GPU instances.
 */
export async function exportArModel(config: SaunaConfiguration, layout: Layout): Promise<{ glb: ArrayBuffer; usdz: Uint8Array }> {
  const assembler = new ModuleAssembler();
  try {
    await assembler.update(config, layout, dirtyGroups(null, config));
    await texturesLoaded(assembler.root);
    const scene = bake(assembler.root);
    const [{ GLTFExporter }, { USDZExporter }] = await Promise.all([
      import('three/addons/exporters/GLTFExporter.js'),
      import('three/addons/exporters/USDZExporter.js'),
    ]);
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: 1024, onlyVisible: true }) as ArrayBuffer;
    const usdz = await new USDZExporter().parseAsync(scene, { maxTextureSize: 1024, quickLookCompatible: true });
    scene.traverse(o => (o as THREE.Mesh).geometry?.dispose());
    return { glb, usdz };
  } finally {
    assembler.dispose();
  }
}

/** Wait until every texture used in the model has its image. */
async function texturesLoaded(root: THREE.Object3D) {
  const maps = new Set<THREE.Texture>();
  root.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.map) maps.add(m.map);
  });
  await Promise.all([...maps].map(t => new Promise<void>(resolve => {
    const img = t.image as HTMLImageElement | undefined;
    if (img && (img.complete ?? true) && (img.width ?? 0) > 0) return resolve();
    const start = performance.now();
    const poll = () => (t.image && (t.image as HTMLImageElement).width > 0) || performance.now() - start > 15000 ? resolve() : setTimeout(poll, 50);
    poll();
  })));
}

/**
 * Flatten the assembled scene: world transforms baked into geometry, instances
 * expanded, everything merged per material, centred with the floor at y = 0.
 */
function bake(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (geo: THREE.BufferGeometry, matrix: THREE.Matrix4, material: THREE.Material) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(matrix);
    (byMaterial.get(material) ?? byMaterial.set(material, []).get(material)!).push(g);
  };
  root.traverse(o => {
    if (o.name === 'floor') return; // the real floor shows through in AR
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      const m = new THREE.Matrix4();
      for (let i = 0; i < inst.count; i++) { inst.getMatrixAt(i, m); add(inst.geometry, mesh.matrixWorld.clone().multiply(m), material); }
    } else {
      add(mesh.geometry, mesh.matrixWorld, material);
    }
  });

  const out = new THREE.Group();
  out.name = 'zirbe_6eck';
  for (const [material, geos] of byMaterial) {
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = material.name || 'part';
    out.add(mesh);
  }
  // Centre the footprint on the origin, floor at y = 0.
  const box = new THREE.Box3().setFromObject(out);
  const centre = box.getCenter(new THREE.Vector3());
  for (const child of out.children) (child as THREE.Mesh).geometry.translate(-centre.x, -box.min.y, -centre.z);
  return out;
}
