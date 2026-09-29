import * as THREE from 'three';

/**
 * One material per finish slot, shared by every module and every procedural
 * part - so the sauna has exactly one Zirbe, one slate, one glass, etc.
 * Module GLBs name their materials "slot:<name>"; the assembler swaps them for
 * these. Changing a finish (Espe -> Erle) swaps the texture on the existing
 * material: no geometry is rebuilt.
 *
 * Procedural geometry gets world-scale UVs pre-divided by each texture's real
 * size (TEXTURE_METRES), so every texture uses repeat = 1.
 */
export type Slot = 'slate' | 'zirbe' | 'bench_wood' | 'glass' | 'metal' | 'heater_black' | 'stones' | 'display' | 'led' | 'dial' | 'floor';

/** Real-world size covered by one copy of each texture image (metres). */
export const TEXTURE_METRES: Record<string, [number, number]> = {
  zirbe: [0.378, 0.5],   // zirbe_boards.jpg: 4 board rows
  slate: [0.8, 1.14],    // slate_tiles.jpg: 2 x 2 tiles of 400 x 570 mm
  floor: [1.2, 1.2],     // generated: 2 x 2 large-format 600 x 600 mm stone tiles
};

/** Light, large-format stone floor tiles like the ones in HolzSauna's renders. */
function floorTiles(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 1024, tile = size / 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 17;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    const base = 228 + Math.round(rnd() * 8);
    g.fillStyle = `rgb(${base},${base - 4},${base - 11})`;
    g.fillRect(tx * tile, ty * tile, tile, tile);
    // soft marble veining
    for (let i = 0; i < 18; i++) {
      g.strokeStyle = `rgba(160,150,138,${0.05 + rnd() * 0.08})`;
      g.lineWidth = 0.8 + rnd() * 2.2;
      g.beginPath();
      let x = tx * tile + rnd() * tile, y = ty * tile + rnd() * tile;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (rnd() - 0.3) * 60; y += (rnd() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(150,142,130,0.55)'; // grout
  g.fillRect(0, 0, size, 3); g.fillRect(0, tile - 1.5, size, 3); g.fillRect(0, 0, 3, size); g.fillRect(tile - 1.5, 0, 3, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TEX = '/textures/production';
export const BENCH_WOOD_TEXTURES: Record<string, string> = {
  espe: `${TEX}/wood/espe.jpg`,
  erle: `${TEX}/wood/erle.jpg`,
};
/** Relief maps made from the same photo textures (make_textures.py): grain, grooves, riven slate. */
const normalOf = (url: string) => url.replace(/\.jpg$/, '_normal.jpg');

export class MaterialLibrary {
  private loader = new THREE.TextureLoader();
  /** Called when a texture finishes loading (the viewer renders on demand). */
  onChange: (() => void) | null = null;
  private textures = new Map<string, THREE.Texture>();
  readonly slots: Record<Slot, THREE.Material>;

  constructor(private anisotropy = 8) {
    this.slots = {
      slate: new THREE.MeshStandardMaterial({ map: this.texture(`${TEX}/slate/slate_tiles.jpg`), normalMap: this.texture(normalOf(`${TEX}/slate/slate_tiles.jpg`), false), normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.78, metalness: 0 }),
      zirbe: new THREE.MeshStandardMaterial({ map: this.texture(`${TEX}/wood/zirbe_boards.jpg`), normalMap: this.texture(normalOf(`${TEX}/wood/zirbe_boards.jpg`), false), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.62, metalness: 0 }),
      bench_wood: new THREE.MeshStandardMaterial({ map: this.texture(BENCH_WOOD_TEXTURES.espe), normalMap: this.texture(normalOf(BENCH_WOOD_TEXTURES.espe), false), normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.6, metalness: 0 }),
      // Low-iron clear glass: almost fully see-through with soft environment
      // reflections. Plain transparency instead of a transmission pass keeps
      // it cheap to render and avoids an over-shiny look.
      glass: new THREE.MeshPhysicalMaterial({
        color: 0xeef6f3, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.14,
        envMapIntensity: 0.6, depthWrite: false, side: THREE.DoubleSide,
      }),
      metal: new THREE.MeshStandardMaterial({ color: 0xc9c9c5, metalness: 1, roughness: 0.34 }),
      heater_black: new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0.25, roughness: 0.55 }),
      stones: new THREE.MeshStandardMaterial({ color: 0x3b3b3a, roughness: 0.95 }),
      display: new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.12, metalness: 0.1 }),
      led: new THREE.MeshStandardMaterial({ color: 0xffc07a, emissive: 0xff9a45, emissiveIntensity: 3 }),
      dial: new THREE.MeshStandardMaterial({ color: 0xeeece4, roughness: 0.5 }),
      floor: new THREE.MeshStandardMaterial({ map: floorTiles(), color: 0xffffff, roughness: 0.28, metalness: 0 }),
    };
    for (const [slot, mat] of Object.entries(this.slots)) mat.name = slot; // readable names in exported AR models
  }

  private texture(url: string, color = true): THREE.Texture {
    let t = this.textures.get(url);
    if (!t) {
      t = this.loader.load(url, () => this.onChange?.());
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace; // normal maps hold vectors, not colours
      t.anisotropy = this.anisotropy;
      this.textures.set(url, t);
    }
    return t;
  }

  /** Material for a GLB material name ("slot:bench_wood") - unknown names keep the original. */
  forModuleMaterial(original: THREE.Material): THREE.Material {
    const slot = original.name?.startsWith('slot:') ? (original.name.slice(5) as Slot) : null;
    return (slot && this.slots[slot]) || original;
  }

  setBenchWood(id: string) {
    const url = BENCH_WOOD_TEXTURES[id] ?? BENCH_WOOD_TEXTURES.espe;
    const mat = this.slots.bench_wood as THREE.MeshStandardMaterial;
    const next = this.texture(url);
    if (mat.map !== next) { mat.map = next; mat.normalMap = this.texture(normalOf(url), false); mat.needsUpdate = true; this.onChange?.(); }
  }

  dispose() {
    for (const t of this.textures.values()) t.dispose();
    for (const m of Object.values(this.slots)) m.dispose();
  }
}
