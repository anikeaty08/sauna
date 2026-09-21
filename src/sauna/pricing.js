// Pricing logic mirrors blender/sauna_configurator.py price_items(), against the
// same public/data/catalog.json, so the browser total matches the Blender report.

const nameOf = spec => (spec && (spec.name_en || spec.name_de)) || '';
const noteOf = spec => (spec && (spec.price_note_en || spec.note_en || '')) || '';

function nearestStep(table, value, label) {
  const steps = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (table[String(value)] !== undefined) return { surcharge: table[String(value)], note: '' };
  const larger = steps.filter(s => s >= value);
  if (!larger.length) return { surcharge: table[String(steps[steps.length - 1])], note: `${label} ${value} cm is above the configurator maximum of ${steps[steps.length - 1]} cm (on request).` };
  return { surcharge: table[String(larger[0])], note: `${label} ${value} cm is a custom size; the ${larger[0]} cm surcharge is applied.` };
}

function priceCabin(cfg, family, warnings) {
  const { widthCm: w, depthCm: d, heightCm: h } = cfg;
  if (family.sizes) {
    let match = family.sizes.find(s => s.w === w && s.d === d);
    if (!match) {
      match = family.sizes.reduce((best, s) => (Math.abs(s.w - w) + Math.abs(s.d - d) < Math.abs(best.w - w) + Math.abs(best.d - d) ? s : best));
      warnings.push(`${w} x ${d} cm is not a standard Espoo size; priced as the nearest size ${match.w} x ${match.d} cm (on request).`);
    }
    return { base: match.price, note: `Promotional price CHF ${match.aktion} while stocks last`, surchargeW: 0, surchargeD: 0 };
  }
  const w1 = nearestStep(family.width_cm, w, 'Width');
  const d1 = nearestStep(family.depth_cm, d, 'Depth');
  if (w1.note) warnings.push(w1.note);
  if (d1.note) warnings.push(d1.note);
  if (h !== family.height_cm) warnings.push(`Height ${h} cm differs from the standard ${family.height_cm} cm (on request).`);
  return { base: family.base_price, note: '', surchargeW: w1.surcharge, surchargeD: d1.surcharge };
}

export function priceItems(cfg, catalog) {
  const warnings = [];
  const family = catalog.families[cfg.family];
  const items = [];
  const { base, note, surchargeW, surchargeD } = priceCabin(cfg, family, warnings);
  items.push({ category: 'cabin', sku: family.sku, name: `${nameOf(family)}, ${cfg.widthCm} x ${cfg.depthCm} x ${cfg.heightCm} cm`, price: base, note });
  if (surchargeW) items.push({ category: 'cabin', sku: 'WIDTH', name: `Width surcharge, ${cfg.widthCm} cm`, price: surchargeW, note: '' });
  if (surchargeD) items.push({ category: 'cabin', sku: 'DEPTH', name: `Depth surcharge, ${cfg.depthCm} cm`, price: surchargeD, note: '' });
  const entryPrice = (family.entry_prices || {})[cfg.entry] || 0;
  if (entryPrice) items.push({ category: 'cabin', sku: 'ENTRY', name: `Surcharge: ${nameOf(catalog.entries[cfg.entry])}`, price: entryPrice, note: '' });
  if (family.window_price && ['front', 'corner'].includes(cfg.entry) && cfg.window !== 'none') {
    items.push({ category: 'cabin', sku: 'WINDOW', name: 'Surcharge: large window', price: family.window_price, note: '' });
  }
  const cladding = catalog.claddings[cfg.cladding || 'none'];
  if (cladding.price) items.push({ category: 'cabin', sku: `CLADDING-${(cfg.cladding || 'none').toUpperCase()}`, name: nameOf(cladding), price: cladding.price, note: noteOf(cladding) });
  const interior = catalog.interiors[cfg.interior.material];
  items.push({ category: 'interior', sku: cfg.interior.material, name: `Interior: ${nameOf(interior)}`, price: interior.price, note: noteOf(interior) });
  const heater = catalog.heaters[cfg.heater.sku];
  if (heater) {
    const volume = (cfg.widthCm * cfg.depthCm * cfg.heightCm) / 1e6;
    const noteBits = [noteOf(heater), heater.approx ? 'dimensions approximate' : ''].filter(Boolean).join('; ');
    if (!(heater.m3[0] <= volume && volume <= heater.m3[1])) {
      warnings.push(`${nameOf(heater).split(',')[0]} is rated for ${heater.m3[0]}–${heater.m3[1]} m³; this cabin is ${volume.toFixed(1)} m³.`);
    }
    items.push({ category: 'heater', sku: cfg.heater.sku, name: nameOf(heater), price: heater.price, note: noteBits });
    const control = catalog.controls[cfg.control] || catalog.controls.none;
    if (heater.control === 'external' && cfg.control === 'none') warnings.push('This heater needs an external control unit.');
    if (['integrated', 'none'].includes(heater.control) && cfg.control !== 'none') warnings.push('This heater has built-in controls (or is wood-fired); a separate control unit is not required.');
    if (cfg.control !== 'none') items.push({ category: 'control', sku: cfg.control, name: nameOf(control), price: control.price, note: '' });
  }
  for (const sku of cfg.lighting) {
    const spec = catalog.lighting[sku];
    if (spec) items.push({ category: 'lighting', sku, name: nameOf(spec), price: spec.price, note: '' });
  }
  for (const sku of cfg.accessories) {
    const spec = catalog.accessories[sku];
    if (spec) {
      if (spec.requires && !cfg.accessories.includes(spec.requires)) warnings.push(`${nameOf(spec)} requires ${nameOf(catalog.accessories[spec.requires])}.`);
      items.push({ category: 'accessory', sku, name: nameOf(spec), price: spec.price, note: noteOf(spec) });
    }
  }
  for (const sku of cfg.services) {
    const spec = catalog.services[sku];
    if (spec) items.push({ category: 'service', sku, name: nameOf(spec), price: spec.price, note: '' });
  }
  const hasLed = cfg.lighting.some(s => ['backrest_strip', 'under_bench'].includes((catalog.lighting[s] || {}).kind));
  if (hasLed && cfg.services.includes('M') && !cfg.services.includes('M-LED')) {
    warnings.push('LED lighting with assembly: the CHF 150 LED assembly surcharge is not yet added.');
  }
  const total = Math.round(items.reduce((sum, i) => sum + i.price, 0) * 100) / 100;
  const vat = catalog.meta.vat_rate;
  return { items, total, totalExclVat: Math.round((total / (1 + vat)) * 100) / 100, warnings, volumeM3: Math.round((cfg.widthCm * cfg.depthCm * cfg.heightCm / 1e6) * 100) / 100 };
}
