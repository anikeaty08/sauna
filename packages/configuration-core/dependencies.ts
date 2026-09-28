import type { SaunaConfiguration } from './types.ts';

/** Module groups the assembler can rebuild independently. */
export type ModuleGroup = 'structure' | 'exterior' | 'glass' | 'door' | 'benches' | 'heater' | 'lighting' | 'accessories' | 'materials';

/**
 * Dependency graph: which configuration paths invalidate which module groups.
 * A bench-wood change only swaps a material slot; a width change reflows
 * everything that is positioned from the footprint.
 */
const GRAPH: Record<string, ModuleGroup[]> = {
  'dimensions.widthCm': ['structure', 'exterior', 'glass', 'door', 'benches', 'heater', 'lighting', 'accessories'],
  'dimensions.depthCm': ['structure', 'exterior', 'glass', 'door', 'benches', 'heater', 'lighting', 'accessories'],
  'materials.benchWood': ['materials'],
  'heaterSet': ['heater', 'benches'],        // heater clearance can shorten the lower bench
  'accessories': ['accessories', 'lighting'],
  'interior.lowerBenchOffsetMm': ['benches'],
};

const flatten = (c: SaunaConfiguration): Record<string, string> => ({
  'dimensions.widthCm': String(c.dimensions.widthCm),
  'dimensions.depthCm': String(c.dimensions.depthCm),
  'materials.benchWood': c.materials.benchWood,
  'heaterSet': c.heaterSet,
  'accessories': [...c.accessories].sort().join(','),
  'interior.lowerBenchOffsetMm': String(c.interior.lowerBenchOffsetMm),
});

export function dirtyGroups(prev: SaunaConfiguration | null, next: SaunaConfiguration): Set<ModuleGroup> {
  if (!prev || prev.modelId !== next.modelId) return new Set(Object.values(GRAPH).flat());
  const a = flatten(prev), b = flatten(next), out = new Set<ModuleGroup>();
  for (const key of Object.keys(GRAPH)) if (a[key] !== b[key]) GRAPH[key].forEach(g => out.add(g));
  return out;
}
