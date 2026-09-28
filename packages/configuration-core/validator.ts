import type { Issue, ModelDefinition, SaunaConfiguration } from './types.ts';
import { SaunaConfigurationSchema } from './schema.ts';
import { computeLayout } from './geometry/zirbe6eckLayout.ts';

export function defaultConfiguration(model: ModelDefinition): SaunaConfiguration {
  return {
    modelId: model.id,
    modelVersion: model.version,
    dimensions: { widthCm: model.dimensions.widthCm.default, depthCm: model.dimensions.depthCm.default },
    materials: { benchWood: model.options.benchWood.find(o => o.default)?.id ?? model.options.benchWood[0].id },
    heaterSet: model.options.heaterSet.find(o => o.default)?.id ?? model.options.heaterSet[0].id,
    accessories: [],
    interior: { lowerBenchOffsetMm: 0 },
  };
}

/** Snap/clamp a possibly-stale or partial configuration onto what the model offers. */
export function normalizeConfiguration(model: ModelDefinition, input: Partial<SaunaConfiguration>): SaunaConfiguration {
  const base = defaultConfiguration(model);
  const snap = (v: unknown, options: number[], fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return options.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best), options[0]);
  };
  const benchWood = model.options.benchWood.some(o => o.id === input.materials?.benchWood) ? input.materials!.benchWood : base.materials.benchWood;
  const heaterSet = model.options.heaterSet.some(o => o.id === input.heaterSet) ? input.heaterSet! : base.heaterSet;
  const accessories = [...new Set((input.accessories ?? []).filter(id => model.options.accessories.some(a => a.id === id)))];
  return {
    modelId: model.id,
    modelVersion: model.version,
    dimensions: {
      widthCm: snap(input.dimensions?.widthCm, model.dimensions.widthCm.options, base.dimensions.widthCm),
      depthCm: snap(input.dimensions?.depthCm, model.dimensions.depthCm.options, base.dimensions.depthCm),
    },
    materials: { benchWood },
    heaterSet,
    accessories,
    interior: { lowerBenchOffsetMm: Math.max(0, Math.min(400, Number(input.interior?.lowerBenchOffsetMm) || 0)) },
  };
}

export function validateConfiguration(model: ModelDefinition, config: SaunaConfiguration): { valid: boolean; issues: Issue[] } {
  const parsed = SaunaConfigurationSchema.safeParse(config);
  if (!parsed.success) {
    return { valid: false, issues: parsed.error.issues.map(i => ({ level: 'error' as const, path: i.path.join('.'), message: i.message })) };
  }
  const issues: Issue[] = [];
  if (!model.dimensions.widthCm.options.includes(config.dimensions.widthCm)) issues.push({ level: 'error', path: 'dimensions.widthCm', message: 'Width is not an available size.' });
  if (!model.dimensions.depthCm.options.includes(config.dimensions.depthCm)) issues.push({ level: 'error', path: 'dimensions.depthCm', message: 'Depth is not an available size.' });
  if (!model.options.benchWood.some(o => o.id === config.materials.benchWood)) issues.push({ level: 'error', path: 'materials.benchWood', message: 'Unknown bench wood.' });
  if (!model.options.heaterSet.some(o => o.id === config.heaterSet)) issues.push({ level: 'error', path: 'heaterSet', message: 'Unknown heater set.' });
  for (const a of config.accessories) if (!model.options.accessories.some(o => o.id === a)) issues.push({ level: 'error', path: 'accessories', message: `Unknown accessory "${a}".` });
  if (!issues.some(i => i.level === 'error')) issues.push(...computeLayout(model, config).issues);
  return { valid: !issues.some(i => i.level === 'error'), issues };
}
