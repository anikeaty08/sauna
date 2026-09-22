import * as THREE from 'three';

// Materials: procedural wood grain drawn once per wood type, mapped at a
// physical scale (1 texture tile = 1 metre) via per-face planar UVs (see
// physicalUVs in ./mesh.js), plus the shared door-handle material picker.

function woodCanvas([r, g, b], grain, knots, boards) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = [r * 255, g * 255, b * 255];
  ctx.fillStyle = `rgb(${base.map(Math.round).join(',')})`;
  ctx.fillRect(0, 0, size, size);
  // grain: many faint wavy lines running along the board direction
  const lines = 260;
  let seed = 7 + Math.round(r * 100 + g * 10 + b);
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < lines; i++) {
    const y = rand() * size;
    const alpha = 0.04 + rand() * 0.08 * grain;
    const dark = rand() > 0.5;
    ctx.strokeStyle = dark ? `rgba(60,35,15,${alpha})` : `rgba(255,240,215,${alpha * 0.8})`;
    ctx.lineWidth = 0.6 + rand() * 1.8;
    ctx.beginPath();
    const amp = 2 + rand() * 6;
    const freq = 0.004 + rand() * 0.01;
    const phase = rand() * 10;
    for (let x = 0; x <= size; x += 16) {
      const yy = y + Math.sin(x * freq + phase) * amp;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  if (knots) {
    for (let i = 0; i < 5; i++) {
      const cx = rand() * size, cy = rand() * size, rx = 10 + rand() * 18, ry = 6 + rand() * 9;
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
      grad.addColorStop(0, 'rgba(70,40,18,0.55)');
      grad.addColorStop(0.7, 'rgba(90,55,25,0.25)');
      grad.addColorStop(1, 'rgba(90,55,25,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (boards) {
    const pitch = size / 9; // ~111 mm boards
    ctx.strokeStyle = 'rgba(40,25,10,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 1; i < 9; i++) { ctx.moveTo(0, i * pitch); ctx.lineTo(size, i * pitch); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,225,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 1; i < 9; i++) { ctx.moveTo(0, i * pitch + 3); ctx.lineTo(size, i * pitch + 3); }
    ctx.stroke();
  }
  return canvas;
}

export class MaterialCache {
  constructor(catalog) { this.catalog = catalog; this.cache = new Map(); this.maxAnisotropy = 8; }
  wood(key, boards = false, doubleSided = false) {
    const cacheKey = `wood:${key}:${boards ? 'b' : 'p'}:${doubleSided ? 'ds' : 'fs'}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    // Single-sided and double-sided variants share one canvas texture.
    const mapKey = `woodmap:${key}:${boards ? 'b' : 'p'}`;
    let map = this.cache.get(mapKey) ?? null;
    const spec = this.catalog.woods[key] || this.catalog.woods.fichte;
    if (map === null && typeof document !== 'undefined') {
      map = new THREE.CanvasTexture(woodCanvas(spec.color, spec.grain, spec.knots, boards));
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = this.maxAnisotropy;
      this.cache.set(mapKey, map);
    }
    const mat = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : new THREE.Color(...spec.color), map, roughness: 0.68, metalness: 0, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    this.cache.set(cacheKey, mat);
    return mat;
  }
  plain(key, options) {
    if (this.cache.has(key)) return this.cache.get(key);
    const mat = new THREE.MeshStandardMaterial(options);
    this.cache.set(key, mat);
    return mat;
  }
  get glass() { return this.plain('glass', { color: 0xdfeee8, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.28, side: THREE.DoubleSide, envMapIntensity: 1.2 }); }
  get steel() { return this.plain('steel', { color: 0x9aa3a8, roughness: 0.3, metalness: 0.9 }); }
  get black() { return this.plain('black', { color: 0x15181b, roughness: 0.42, metalness: 0.45 }); }
  get darkGrille() { return this.plain('darkGrille', { color: 0x0a0c0d, roughness: 0.7, metalness: 0.2 }); }
  get seal() { return this.plain('seal', { color: 0x1c1e1d, roughness: 0.85, metalness: 0 }); }
  get stones() { return this.plain('stones', { color: 0x3a3634, roughness: 0.95, metalness: 0 }); }
  get slate() { return this.plain('slate', { color: 0x2b2e31, roughness: 0.62, metalness: 0.05 }); }
  get white() { return this.plain('white', { color: 0xe8e6dd, roughness: 0.45, metalness: 0 }); }
  get ceramic() { return this.plain('ceramic', { color: 0x8c1f14, roughness: 0.35, metalness: 0 }); }
  get opal() { return this.plain('opal', { color: 0xffe6b8, roughness: 0.5, emissive: 0xffb066, emissiveIntensity: 1.6 }); }
  get ledWarm() { return this.plain('ledWarm', { color: 0xffb066, roughness: 0.4, emissive: 0xff9a4d, emissiveIntensity: 2.4 }); }
  get ledRgb() { return this.plain('ledRgb', { color: 0xd6a6ff, roughness: 0.4, emissive: 0x9a5cff, emissiveIntensity: 2.0 }); }
  get screen() { return this.plain('screen', { color: 0x0e2622, roughness: 0.3, emissive: 0x2fae8f, emissiveIntensity: 1.3 }); }
  get gold() { return this.plain('gold', { color: 0xc9a24a, roughness: 0.2, metalness: 0.9 }); }
  get mirror() { return this.plain('mirror', { color: 0xdedede, roughness: 0.05, metalness: 1 }); }
}

/** Inside/outside handle materials for the selected catalog handle option. */
export function doorHandleMaterials(cfg, catalog, materials, benchMat) {
  const spec = catalog.handles?.[cfg.door.handle] || catalog.handles?.wood_steel || {};
  const inside = cfg.door.handle === 'beech_black' ? materials.wood('eiche_astig') : benchMat;
  const outside = { wood: materials.wood('fichte'), glass: materials.glass, black: materials.black }[spec.outside] || materials.steel;
  const mountMat = spec.outside === 'black' ? materials.black : materials.steel;
  return { inside, outside, mountMat, spec };
}
