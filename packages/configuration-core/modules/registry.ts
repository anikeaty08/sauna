/**
 * Module catalog. Each entry is one independently authored Blender module
 * (blender/production/<model>/modules/<category>/<id>.blend) exported to its own
 * GLB. Conventions (see docs/architecture.md): metres, glTF Y-up, origin at the
 * `base` attachment point, the module's "front"/visible face points +Z.
 *
 * kind:
 *   placed    - fixed-size part put at a layout anchor
 *   profile   - authored 1.000 m along `lengthAxis`; the engine scales ONLY that
 *               axis, so the cross-section never distorts
 *   instanced - repeated many times (one draw call via InstancedMesh)
 */
export type ModuleKind = 'placed' | 'profile' | 'instanced';
export type ModuleCategory = 'exterior' | 'door' | 'bench' | 'heater' | 'control' | 'lighting' | 'accessory';

export interface SaunaModule {
  id: string;
  category: ModuleCategory;
  kind: ModuleKind;
  version: string;
  assetUrl: string;
  /** Bounding size in metres [x, y, z] as authored (profiles: 1 m on lengthAxis). */
  size: [number, number, number];
  lengthAxis?: 'x' | 'y';
  attachmentPoints: Record<string, [number, number, number]>;
  materialSlots: string[];
  compatibleModels: string[];
  approx?: boolean;
  note?: string;
}

const V = '1.0.0';
const url = (category: string, id: string) => `/modules/${category}/${id}-${V}.glb`;
const Z6 = ['zirbe-6eck'];

const m = (id: string, category: ModuleCategory, kind: ModuleKind, size: [number, number, number], materialSlots: string[], extra: Partial<SaunaModule> = {}): SaunaModule => ({
  id, category, kind, version: V, assetUrl: url(category, id), size,
  attachmentPoints: { base: [0, 0, 0] }, materialSlots, compatibleModels: Z6, ...extra,
});

export const MODULES: Record<string, SaunaModule> = Object.fromEntries([
  m('slate-panel', 'exterior', 'instanced', [0.4, 0.57, 0.012], ['slot:slate'], { note: 'One riven slate tile 400 x 570 mm; tiled over every solid exterior face.' }),
  m('glass-profile', 'exterior', 'profile', [1, 0.03, 0.032], ['slot:metal'], { lengthAxis: 'x', note: 'Aluminium U-channel at the glass foot and head, centred on the glass plane.' }),
  m('glass-door', 'door', 'placed', [0.67, 1.875, 0.06], ['slot:glass', 'slot:metal', 'slot:bench_wood'], {
    attachmentPoints: { base: [0, 0, 0], handle: [0.58, 1.02, 0.04] },
    note: 'Origin on the hinge axis at floor level; leaf extends +X, handle side +Z (outside).',
  }),
  m('bench-slat', 'bench', 'profile', [1, 0.028, 0.09], ['slot:bench_wood'], { lengthAxis: 'x', note: 'Top surface at y = 0, centred on z.' }),
  m('bench-bearer', 'bench', 'profile', [1, 0.045, 0.045], ['slot:bench_wood'], { lengthAxis: 'x', note: 'Top at y = 0, centred on z.' }),
  m('backrest-rail', 'bench', 'profile', [1, 0.095, 0.027], ['slot:bench_wood'], { lengthAxis: 'x', note: 'Rounded top edge; back face at z = 0, rail towards +Z.' }),
  m('skirt-slat', 'bench', 'profile', [0.07, 1, 0.014], ['slot:bench_wood'], { lengthAxis: 'y', note: 'Vertical cladding slat between the upper benches and the floor.' }),
  m('heater-harvia-virta', 'heater', 'placed', [0.415, 0.81, 0.325], ['slot:heater_black', 'slot:metal', 'slot:stones'], { approx: true }),
  m('heater-harvia-virta-combi', 'heater', 'placed', [0.415, 0.81, 0.325], ['slot:heater_black', 'slot:metal', 'slot:stones'], { approx: true, note: 'Virta body plus side water tank.' }),
  m('heater-eos-mythos', 'heater', 'placed', [0.45, 0.86, 0.45], ['slot:heater_black', 'slot:metal', 'slot:stones'], { approx: true }),
  m('control-huum-uku-glass', 'control', 'placed', [0.095, 0.145, 0.02], ['slot:display', 'slot:metal'], { approx: true, note: 'HUUM UKU Glass WiFi control (Harvia sets).' }),
  m('control-eos-emostyle', 'control', 'placed', [0.11, 0.17, 0.025], ['slot:display', 'slot:heater_black'], { approx: true }),
  m('downlight', 'lighting', 'placed', [0.08, 0.02, 0.08], ['slot:metal', 'slot:led'], { note: 'Origin at the ceiling surface; emits towards -Y.' }),
  m('led-strip', 'lighting', 'profile', [1, 0.006, 0.014], ['slot:led'], { lengthAxis: 'x' }),
  m('nova-bucket-set', 'accessory', 'placed', [0.3, 0.45, 0.25], ['slot:heater_black', 'slot:bench_wood', 'slot:metal']),
  m('climate-station', 'accessory', 'placed', [0.2, 0.3, 0.05], ['slot:zirbe', 'slot:display', 'slot:glass']),
].map(mod => [mod.id, mod]));

export function modulesForModel(modelId: string): SaunaModule[] {
  return Object.values(MODULES).filter(mod => mod.compatibleModels.includes(modelId));
}
