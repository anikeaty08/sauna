import type { ModelDefinition } from './types.ts';
import { zirbe6eck } from './models/zirbe-6eck.ts';

export * from './types.ts';
export { zirbe6eck } from './models/zirbe-6eck.ts';
export { computeLayout, paneSpan } from './geometry/zirbe6eckLayout.ts';
export type { Layout, Placement, Run, Segment } from './geometry/zirbe6eckLayout.ts';
export { MODULES, modulesForModel } from './modules/registry.ts';
export type { SaunaModule } from './modules/registry.ts';
export { defaultConfiguration, normalizeConfiguration, validateConfiguration } from './validator.ts';
export { priceConfiguration } from './pricing.ts';
export type { PriceResult, PriceLine } from './pricing.ts';
export { dirtyGroups } from './dependencies.ts';
export { floorPlanSvg } from './quote/floorPlanSvg.ts';
export type { ModuleGroup } from './dependencies.ts';

/** Model registry. The three further models get their own definition + layout file. */
export const MODEL_REGISTRY: Record<string, ModelDefinition> = { [zirbe6eck.id]: zirbe6eck };
