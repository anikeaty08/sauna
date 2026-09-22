// Pricing logic mirrors blender/sauna_configurator.py price_items(), against the
// same public/data/catalog.json, so the browser total matches the Blender report.

const nameOf = (spec, lang = 'en') => (spec && (lang === 'de' ? (spec.name_de || spec.name_en) : (spec.name_en || spec.name_de))) || '';
const noteOf = (spec, lang = 'en') => (spec && (lang === 'de' ? (spec.note_de || spec.price_note_de || spec.note_en || spec.price_note_en) : (spec.price_note_en || spec.note_en || spec.note_de))) || '';

function nearestStep(table, value, label, isDe = false) {
  const steps = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (table[String(value)] !== undefined) return { surcharge: table[String(value)], note: '' };
  const larger = steps.filter(s => s >= value);
  if (!larger.length) {
    const max = steps[steps.length - 1];
    return {
      surcharge: table[String(max)],
      note: isDe ? `${label} ${value} cm übersteigt das Maximum von ${max} cm (auf Anfrage).` : `${label} ${value} cm is above the configurator maximum of ${max} cm (on request).`
    };
  }
  return {
    surcharge: table[String(larger[0])],
    note: isDe ? `${label} ${value} cm ist ein Sondermass; Aufpreis für ${larger[0]} cm wird angewendet.` : `${label} ${value} cm is a custom size; the ${larger[0]} cm surcharge is applied.`
  };
}

function priceCabin(cfg, family, warnings, isDe = false) {
  const { widthCm: w, depthCm: d, heightCm: h } = cfg;
  if (family.sizes) {
    let match = family.sizes.find(s => s.w === w && s.d === d);
    if (!match) {
      match = family.sizes.reduce((best, s) => (Math.abs(s.w - w) + Math.abs(s.d - d) < Math.abs(best.w - w) + Math.abs(best.d - d) ? s : best));
      warnings.push(isDe
        ? `${w} x ${d} cm ist kein Espoo-Standardmass; berechnet zum nächsten Mass ${match.w} x ${match.d} cm (auf Anfrage).`
        : `${w} x ${d} cm is not a standard Espoo size; priced as the nearest size ${match.w} x ${match.d} cm (on request).`);
    }
    return {
      base: match.price,
      note: isDe ? `Aktionspreis CHF ${match.aktion} solange Vorrat` : `Promotional price CHF ${match.aktion} while stocks last`,
      surchargeW: 0,
      surchargeD: 0
    };
  }
  const w1 = nearestStep(family.width_cm, w, isDe ? 'Breite' : 'Width', isDe);
  const d1 = nearestStep(family.depth_cm, d, isDe ? 'Tiefe' : 'Depth', isDe);
  if (w1.note) warnings.push(w1.note);
  if (d1.note) warnings.push(d1.note);
  if (h !== family.height_cm) {
    warnings.push(isDe
      ? `Höhe ${h} cm weicht vom Standard ${family.height_cm} cm ab (auf Anfrage).`
      : `Height ${h} cm differs from the standard ${family.height_cm} cm (on request).`);
  }
  return { base: family.base_price, note: '', surchargeW: w1.surcharge, surchargeD: d1.surcharge };
}

export function priceItems(cfg, catalog, lang = 'en') {
  const isDe = lang === 'de';
  const warnings = [];
  const family = catalog.families[cfg.family];
  const items = [];
  const { base, note, surchargeW, surchargeD } = priceCabin(cfg, family, warnings, isDe);

  items.push({
    category: 'cabin',
    sku: family.sku,
    name: `${nameOf(family, lang)}, ${cfg.widthCm} x ${cfg.depthCm} x ${cfg.heightCm} cm`,
    price: base,
    note
  });

  if (surchargeW) items.push({ category: 'cabin', sku: 'WIDTH', name: isDe ? `Aufpreis Breite, ${cfg.widthCm} cm` : `Width surcharge, ${cfg.widthCm} cm`, price: surchargeW, note: '' });
  if (surchargeD) items.push({ category: 'cabin', sku: 'DEPTH', name: isDe ? `Aufpreis Tiefe, ${cfg.depthCm} cm` : `Depth surcharge, ${cfg.depthCm} cm`, price: surchargeD, note: '' });

  const entryPrice = (family.entry_prices || {})[cfg.entry] || 0;
  if (entryPrice) items.push({ category: 'cabin', sku: 'ENTRY', name: isDe ? `Aufpreis: ${nameOf(catalog.entries[cfg.entry], lang)}` : `Surcharge: ${nameOf(catalog.entries[cfg.entry], lang)}`, price: entryPrice, note: '' });

  if (family.window_price && ['front', 'corner'].includes(cfg.entry) && cfg.window !== 'none') {
    items.push({ category: 'cabin', sku: 'WINDOW', name: isDe ? 'Aufpreis: Grosses Fenster' : 'Surcharge: large window', price: family.window_price, note: '' });
  }

  const cladding = catalog.claddings[cfg.cladding || 'none'];
  if (cladding.price) items.push({ category: 'cabin', sku: `CLADDING-${(cfg.cladding || 'none').toUpperCase()}`, name: nameOf(cladding, lang), price: cladding.price, note: noteOf(cladding, lang) });

  const interior = catalog.interiors[cfg.interior.material];
  items.push({ category: 'interior', sku: cfg.interior.material, name: isDe ? `Innenausstattung: ${nameOf(interior, lang)}` : `Interior: ${nameOf(interior, lang)}`, price: interior.price, note: noteOf(interior, lang) });

  const heater = catalog.heaters[cfg.heater.sku];
  if (heater) {
    const volume = (cfg.widthCm * cfg.depthCm * cfg.heightCm) / 1e6;
    const noteBits = [noteOf(heater, lang), heater.approx ? (isDe ? 'Masse ca.' : 'dimensions approximate') : ''].filter(Boolean).join('; ');
    if (!(heater.m3[0] <= volume && volume <= heater.m3[1])) {
      warnings.push(isDe
        ? `${nameOf(heater, lang).split(',')[0]} ist für ${heater.m3[0]}–${heater.m3[1]} m³ ausgelegt; diese Kabine hat ${volume.toFixed(1)} m³.`
        : `${nameOf(heater, lang).split(',')[0]} is rated for ${heater.m3[0]}–${heater.m3[1]} m³; this cabin is ${volume.toFixed(1)} m³.`);
    }
    items.push({ category: 'heater', sku: cfg.heater.sku, name: nameOf(heater, lang), price: heater.price, note: noteBits });

    const control = catalog.controls[cfg.control] || catalog.controls.none;
    if (heater.control === 'external' && cfg.control === 'none') {
      warnings.push(isDe ? 'Dieser Ofen benötigt ein separates Steuergerät.' : 'This heater needs an external control unit.');
    }
    if (['integrated', 'none'].includes(heater.control) && cfg.control !== 'none') {
      warnings.push(isDe
        ? 'Dieser Ofen hat integrierte Regler (oder ist holzbefeuert); ein separates Steuergerät wird nicht benötigt.'
        : 'This heater has built-in controls (or is wood-fired); a separate control unit is not required.');
    }
    if (cfg.control !== 'none') items.push({ category: 'control', sku: cfg.control, name: nameOf(control, lang), price: control.price, note: '' });
  }

  for (const sku of cfg.lighting) {
    const spec = catalog.lighting[sku];
    if (spec) items.push({ category: 'lighting', sku, name: nameOf(spec, lang), price: spec.price, note: '' });
  }

  for (const sku of cfg.accessories) {
    const spec = catalog.accessories[sku];
    if (spec) {
      if (spec.requires && !cfg.accessories.includes(spec.requires)) {
        warnings.push(isDe
          ? `${nameOf(spec, lang)} erfordert ${nameOf(catalog.accessories[spec.requires], lang)}.`
          : `${nameOf(spec, lang)} requires ${nameOf(catalog.accessories[spec.requires], lang)}.`);
      }
      items.push({ category: 'accessory', sku, name: nameOf(spec, lang), price: spec.price, note: noteOf(spec, lang) });
    }
  }

  for (const sku of cfg.services) {
    const spec = catalog.services[sku];
    if (spec) items.push({ category: 'service', sku, name: nameOf(spec, lang), price: spec.price, note: '' });
  }

  const hasLed = cfg.lighting.some(s => ['backrest_strip', 'under_bench'].includes((catalog.lighting[s] || {}).kind));
  if (hasLed && cfg.services.includes('M') && !cfg.services.includes('M-LED')) {
    warnings.push(isDe
      ? 'LED-Beleuchtung mit Montage: Der LED-Montageaufpreis von CHF 150 ist noch nicht hinzugefügt.'
      : 'LED lighting with assembly: the CHF 150 LED assembly surcharge is not yet added.');
  }

  const total = Math.round(items.reduce((sum, i) => sum + i.price, 0) * 100) / 100;
  const vat = catalog.meta.vat_rate;
  return {
    items,
    total,
    totalExclVat: Math.round((total / (1 + vat)) * 100) / 100,
    warnings,
    volumeM3: Math.round((cfg.widthCm * cfg.depthCm * cfg.heightCm / 1e6) * 100) / 100
  };
}
