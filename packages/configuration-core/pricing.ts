import type { ModelDefinition, SaunaConfiguration } from './types.ts';

export interface PriceLine { id: string; label: string; price: number | null; note?: string }
export interface PriceResult { lines: PriceLine[]; total: number; onRequest: boolean; currency: 'CHF'; vatIncluded: true }

/** Server and browser use this same function; the server never trusts a client total. */
export function priceConfiguration(model: ModelDefinition, config: SaunaConfiguration): PriceResult {
  const lines: PriceLine[] = [];
  lines.push({ id: 'base', label: `${model.name}, 150 × 150 cm`, price: model.basePrice });
  const w = model.dimensions.widthCm.surcharge[config.dimensions.widthCm] ?? 0;
  const d = model.dimensions.depthCm.surcharge[config.dimensions.depthCm] ?? 0;
  if (w) lines.push({ id: 'width', label: `Width ${config.dimensions.widthCm} cm`, price: w });
  if (d) lines.push({ id: 'depth', label: `Depth ${config.dimensions.depthCm} cm`, price: d });
  const wood = model.options.benchWood.find(o => o.id === config.materials.benchWood);
  if (wood && wood.price !== 0) lines.push({ id: `wood:${wood.id}`, label: `Benches: ${wood.name}`, price: wood.price, note: wood.priceNote });
  const heater = model.options.heaterSet.find(o => o.id === config.heaterSet);
  if (heater && heater.id !== 'none') lines.push({ id: `heater:${heater.id}`, label: heater.name, price: heater.price, note: heater.priceNote });
  for (const id of config.accessories) {
    const a = model.options.accessories.find(o => o.id === id);
    if (a) lines.push({ id: `acc:${a.id}`, label: a.name, price: a.price, note: a.priceNote });
  }
  return {
    lines,
    total: lines.reduce((s, l) => s + (l.price ?? 0), 0),
    onRequest: lines.some(l => l.price === null),
    currency: 'CHF',
    vatIncluded: true,
  };
}
