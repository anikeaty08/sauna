import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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

/**
 * Scene Viewer is stricter than the glTF spec: textures are redrawn at
 * power-of-two sizes (max 1024) and stored as JPEG when the material is opaque.
 */
const safeMaps = new WeakMap<THREE.Texture, THREE.Texture>();
function viewerSafeMaterial(material: THREE.Material): THREE.Material {
  const std = material as THREE.MeshStandardMaterial;
  const src = std.map;
  const img = src?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!src || !img || !img.width || !img.height) return material;
  let map = safeMaps.get(src);
  if (!map) {
    const pot = (n: number) => Math.min(1024, Math.max(64, 2 ** Math.round(Math.log2(n))));
    const canvas = document.createElement('canvas');
    canvas.width = pot(img.width); canvas.height = pot(img.height);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = src.wrapS; t.wrapT = src.wrapT; t.colorSpace = src.colorSpace;
    t.repeat.copy(src.repeat); t.offset.copy(src.offset); t.rotation = src.rotation; t.center.copy(src.center);
    t.flipY = src.flipY;
    if (!std.transparent) t.userData.mimeType = 'image/jpeg';
    safeMaps.set(src, t);
    map = t;
  }
  const out = std.clone();
  out.map = map;
  out.name = material.name;
  return out;
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
    const flat = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!flat) continue;
    // Indexed triangles: ARCore's loader rejects some un-indexed GLBs from
    // three.js ("Invalid index range"); indexing also shrinks the file.
    const merged = mergeVertices(flat, 1e-5);
    flat.dispose();
    // Scene Viewer supports only a few glTF extensions: keep emissive at the
    // core range (an intensity > 1 would export KHR_materials_emissive_strength).
    let mat = viewerSafeMaterial(material);
    const std = mat as THREE.MeshStandardMaterial;
    if (std.isMeshStandardMaterial && std.emissiveIntensity > 1) {
      const c = std === material ? std.clone() : std;
      c.emissive.multiplyScalar(std.emissiveIntensity);
      c.emissive.r = Math.min(1, c.emissive.r); c.emissive.g = Math.min(1, c.emissive.g); c.emissive.b = Math.min(1, c.emissive.b);
      c.emissiveIntensity = 1;
      mat = c;
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = material.name || 'part';
    out.add(mesh);
  }
  // Centre the footprint on the origin, floor at y = 0.
  const box = new THREE.Box3().setFromObject(out);
  const centre = box.getCenter(new THREE.Vector3());
  for (const child of out.children) (child as THREE.Mesh).geometry.translate(-centre.x, -box.min.y, -centre.z);
  return out;
}
