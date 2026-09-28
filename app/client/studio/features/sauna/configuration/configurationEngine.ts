import {
  MODEL_REGISTRY, computeLayout, dirtyGroups, normalizeConfiguration, priceConfiguration, validateConfiguration,
  type Issue, type Layout, type ModelDefinition, type ModuleGroup, type PriceResult, type SaunaConfiguration,
} from '../../../../../../packages/configuration-core/index.ts';

export interface EngineResult {
  model: ModelDefinition;
  config: SaunaConfiguration;
  layout: Layout;
  issues: Issue[];
  valid: boolean;
  price: PriceResult;
  dirty: Set<ModuleGroup>;
}

/**
 * Configuration engine: one pure step from "customer changed something" to
 * everything the UI and the 3D assembler need. Browser-only, no network.
 */
export function evaluate(input: Partial<SaunaConfiguration> & { modelId: string }, previous: SaunaConfiguration | null): EngineResult {
  const model = MODEL_REGISTRY[input.modelId];
  if (!model) throw new Error(`Unknown sauna model "${input.modelId}"`);
  const config = normalizeConfiguration(model, input);
  const { valid, issues } = validateConfiguration(model, config);
  return {
    model, config, valid, issues,
    layout: computeLayout(model, config),
    price: priceConfiguration(model, config),
    dirty: dirtyGroups(previous, config),
  };
}
