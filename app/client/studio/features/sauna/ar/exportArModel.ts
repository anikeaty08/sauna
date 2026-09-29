import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Layout, SaunaConfiguration } from '../../../../../../packages/configuration-core/index.ts';
import { dirtyGroups } from '../../../../../../packages/configuration-core/index.ts';
import { ModuleAssembler } from '../assembly/ModuleAssembler.ts';
import { PlanFrame } from '../geometry/placement.ts';

/**
 * The exact configured sauna as files for the phone's own AR viewers, the way
 * web shops ship "View in your room": a GLB for Android Scene Viewer and a
 * USDZ for iPhone Quick Look, both at true scale (1 unit = 1 m).
 *
 * Normalised for AR: door closed (or open, on request), real lights replaced by
 * baked light layers and a warm glow in the wood, the inner floor removed (the
 * real floor shows), inside surfaces visible from both sides (people can walk
 * into the true-size model), footprint centred on the origin, floor at y = 0,
 * and every group of repeated parts (bench slats, slate tiles) merged into one
 * mesh per material - the native viewers handle a few plain meshes far better
 * than hundreds of GPU instances.
 */
export async function exportArModel(config: SaunaConfiguration, layout: Layout, opts: { doorOpen?: boolean } = {}): Promise<{ glb: ArrayBuffer; usdz: Uint8Array }> {
  const assembler = new ModuleAssembler();
  try {
    await assembler.update(config, layout, dirtyGroups(null, config));
    await texturesLoaded(assembler.root);
    const pivot = assembler.doorPivot;
    if (opts.doorOpen && pivot) {
      // same swing as the studio's "Open door" (80 degrees outward)
      pivot.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), assembler.doorOpenSign * THREE.MathUtils.degToRad(80)));
    }
    assembler.root.add(lightLayers(layout));
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
function potTexture(src: THREE.Texture | null, jpeg: boolean): THREE.Texture | null {
  const img = src?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!src || !img || !img.width || !img.height) return src;
  let t = safeMaps.get(src);
  if (!t) {
    const pot = (n: number) => Math.min(1024, Math.max(64, 2 ** Math.round(Math.log2(n))));
    const canvas = document.createElement('canvas');
    canvas.width = pot(img.width); canvas.height = pot(img.height);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    t = new THREE.CanvasTexture(canvas);
    t.wrapS = src.wrapS; t.wrapT = src.wrapT; t.colorSpace = src.colorSpace;
    t.repeat.copy(src.repeat); t.offset.copy(src.offset); t.rotation = src.rotation; t.center.copy(src.center);
    t.flipY = src.flipY;
    if (jpeg) t.userData.mimeType = 'image/jpeg';
    safeMaps.set(src, t);
  }
  return t;
}

// Warm self-glow of the interior wood: the "baked" look of HolzSauna's photos,
// where LEDs and downlights light the cabin. Real rooms are much darker than a
// render, so without it the interior behind the glass reads as flat and grey.
// Neutral-warm on purpose: a saturated orange turns pale Espe salmon-pink.
const WOOD_GLOW: Record<string, THREE.Color> = {
  zirbe: new THREE.Color(0.24, 0.18, 0.12),
  bench_wood: new THREE.Color(0.17, 0.16, 0.14),
};
// Surfaces people see from inside when they walk into the true-size model.
const WALK_IN = new Set(['zirbe', 'bench_wood', 'slate']);

function viewerSafeMaterial(material: THREE.Material): THREE.Material {
  const std = material as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial || std.userData.arLight) return material;
  const out = std.clone();
  out.name = material.name;
  out.map = potTexture(std.map, !std.transparent);
  out.normalMap = potTexture(std.normalMap, true);
  const glow = WOOD_GLOW[material.name];
  if (glow && out.map) { out.emissive.copy(glow); out.emissiveMap = out.map; out.emissiveIntensity = 1; }
  if (WALK_IN.has(material.name)) out.side = THREE.DoubleSide;
  return out;
}

/**
 * Light "baked" into the AR model: soft warm washes where the sauna's lights
 * fall - down the bench fronts under the LED strips, a halo on the ceiling
 * around each downlight and a pool on the bench below it. Plain textured
 * quads (alpha-blended emissive), so every AR viewer shows them the same way.
 */
function lightLayers(layout: Layout): THREE.Group {
  const f = new PlanFrame(layout.width, layout.depth);
  const g = new THREE.Group();
  g.name = 'light_layers';
  // One material and one texture for all light layers (Scene Viewer: <= 10
  // materials, <= 2 of them transparent - glass is the other one).
  const tex = lightAtlas();
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x000000, map: tex, emissive: 0xffffff, emissiveMap: tex, transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
  lightMat.name = 'light'; lightMat.userData.arLight = true;
  // atlas halves: wash (linear falloff) on top, pool (radial) below
  const quad = (w: number, h: number, half: 'wash' | 'pool') => {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.5 + (half === 'wash' ? 0.5 : 0));
    return new THREE.Mesh(geo, lightMat);
  };

  // LED under the upper bench lip: wash down the bench front boards.
  for (const r of layout.runs.filter(q => q.module === 'led-strip')) {
    const a = f.point(r.from, 0), b = f.point(r.to, 0), n = f.dir(r.facing);
    const length = a.distanceTo(b), drop = Math.min(0.7, r.elevation);
    const wash = quad(length, drop, 'wash');
    const mid = a.clone().lerp(b, 0.5).addScaledVector(n, 0.035).setY(r.elevation - drop / 2);
    wash.position.copy(mid);
    wash.lookAt(mid.clone().add(n));
    g.add(wash);
  }
  // Downlights: halo on the ceiling, pool on the upper bench below.
  const ceiling = layout.height - layout.fascia; // ceiling underside (see footprintCap)
  for (const p of layout.placements.filter(q => q.module === 'downlight')) {
    const halo = quad(0.9, 0.9, 'pool');
    halo.position.copy(f.point(p.position, ceiling - 0.004));
    halo.rotation.x = Math.PI / 2; // faces down
    g.add(halo);
    const pool = quad(0.8, 0.8, 'pool');
    pool.position.copy(f.point(p.position, layout.benches.upperHeight + 0.004));
    pool.rotation.x = -Math.PI / 2; // faces up
    g.add(pool);
  }
  return g;
}

/**
 * Warm light falloff with alpha, 256 x 512: the top half is the LED wash
 * (bright at the strip, fading down, soft ends), the bottom half a radial pool.
 */
function lightAtlas(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s; c.height = s * 2;
  const ctx = c.getContext('2d')!;
  const warm = (a: number) => `rgba(255, 176, 96, ${a})`;
  // wash (canvas rows 0..255 = texture v 0.5..1, top of the quad)
  const v = ctx.createLinearGradient(0, 0, 0, s);
  v.addColorStop(0, warm(0.62)); v.addColorStop(0.35, warm(0.28)); v.addColorStop(1, warm(0));
  ctx.fillStyle = v; ctx.fillRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'destination-out'; // soften both ends of the strip
  for (const [x0, x1] of [[0, s * 0.08], [s, s * 0.92]]) {
    const h = ctx.createLinearGradient(x0, 0, x1, 0);
    h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = h; ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), s);
  }
  ctx.globalCompositeOperation = 'source-over';
  // pool (canvas rows 256..511 = texture v 0..0.5)
  const r = ctx.createRadialGradient(s / 2, s * 1.5, 0, s / 2, s * 1.5, s / 2 - 2);
  r.addColorStop(0, warm(0.5)); r.addColorStop(0.4, warm(0.22)); r.addColorStop(1, warm(0));
  ctx.fillStyle = r; ctx.fillRect(0, s, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Faces whose texture coordinates are flat in one direction (thin edge faces)
 * get a zero or NaN tangent; glTF requires unit tangents, so give those any
 * direction perpendicular to the normal and normalise the rest.
 */
function repairTangents(geo: THREE.BufferGeometry) {
  const tan = geo.attributes.tangent as THREE.BufferAttribute, nor = geo.attributes.normal as THREE.BufferAttribute;
  const t = new THREE.Vector3(), n = new THREE.Vector3(), axis = new THREE.Vector3();
  for (let i = 0; i < tan.count; i++) {
    t.set(tan.getX(i), tan.getY(i), tan.getZ(i));
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize();
    t.addScaledVector(n, -t.dot(n)); // keep it in the surface plane
    if (!(t.lengthSq() > 1e-10)) { // zero or NaN
      axis.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0);
      t.crossVectors(axis, n);
    }
    t.normalize();
    const w = tan.getW(i);
    tan.setXYZW(i, t.x, t.y, t.z, w < 0 ? -1 : 1);
  }
  tan.needsUpdate = true;
}

/** Wait until every texture used in the model has its image. */
async function texturesLoaded(root: THREE.Object3D) {
  const maps = new Set<THREE.Texture>();
  root.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.map) maps.add(m.map);
    if (m?.normalMap) maps.add(m.normalMap);
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
    // Relief maps need a tangent frame; ship it so every AR viewer shades the
    // grain and slate the same way instead of guessing its own.
    if ((mat as THREE.MeshStandardMaterial).normalMap && merged.index && merged.attributes.uv) {
      merged.computeTangents();
      repairTangents(merged);
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
