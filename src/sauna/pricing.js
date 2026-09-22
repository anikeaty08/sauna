// Pricing logic mirrors blender/sauna_configurator.py price_items(), against the
// same public/data/catalog.json, so the browser total matches the Blender report.
// Also produces the technical notes a customer (and their electrician) needs:
// heater sizing incl. glass, electrical supply, ventilation, lead time, room fit.
import { familyType, sizeOf } from './config';

const nameOf = (spec, lang = 'en') => (spec && (lang === 'de' ? (spec.name_de || spec.name_en) : (spec.name_en || spec.name_de))) || '';
const noteOf = (spec, lang = 'en') => (spec && (lang === 'de' ? (spec.note_de || spec.price_note_de || spec.price_note || spec.note || spec.note_en || spec.price_note_en) : (spec.price_note_en || spec.note_en || spec.price_note || spec.note))) || '';
const T = (isDe, de, en) => (isDe ? de : en);

function nearestStep(table, value, label, isDe = false) {
  const steps = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (table[String(value)] !== undefined) return { surcharge: table[String(value)], note: '' };
  const larger = steps.filter(s => s >= value);
  if (!larger.length) {
    const max = steps[steps.length - 1];
    return { surcharge: table[String(max)], note: T(isDe, `${label} ${value} cm übersteigt das Maximum von ${max} cm (auf Anfrage).`, `${label} ${value} cm is above the configurator maximum of ${max} cm (on request).`) };
  }
  return { surcharge: table[String(larger[0])], note: T(isDe, `${label} ${value} cm ist ein Sondermass; Aufpreis für ${larger[0]} cm wird angewendet.`, `${label} ${value} cm is a custom size; the ${larger[0]} cm surcharge is applied.`) };
}

function priceCabin(cfg, family, warnings, isDe) {
  const { widthCm: w, depthCm: d, heightCm: h } = cfg;
  if (family.sizes) {
    let match = family.sizes.find(s => s.w === w && s.d === d);
    if (!match) {
      match = family.sizes.reduce((best, s) => (Math.abs(s.w - w) + Math.abs(s.d - d) < Math.abs(best.w - w) + Math.abs(best.d - d) ? s : best));
      warnings.push(T(isDe, `${w} x ${d} cm ist kein Standardmass; berechnet zum nächsten Mass ${match.w} x ${match.d} cm (auf Anfrage).`, `${w} x ${d} cm is not a standard size; priced as the nearest size ${match.w} x ${match.d} cm (on request).`));
    }
    const std = match.h || family.height_cm;
    if (h !== std && !match.h) warnings.push(T(isDe, `Höhe ${h} cm weicht vom Standard ${std} cm ab (auf Anfrage).`, `Height ${h} cm differs from the standard ${std} cm (on request).`));
    return { base: match.aktion ?? match.price, label: match.label, note: match.aktion ? T(isDe, `Aktionspreis (regulär CHF ${match.price}) solange Vorrat`, `Promotional price (regular CHF ${match.price}) while stocks last`) : '', surchargeW: 0, surchargeD: 0 };
  }
  const w1 = nearestStep(family.width_cm, w, T(isDe, 'Breite', 'Width'), isDe);
  const d1 = nearestStep(family.depth_cm, d, T(isDe, 'Tiefe', 'Depth'), isDe);
  if (w1.note) warnings.push(w1.note);
  if (d1.note) warnings.push(d1.note);
  if (h !== family.height_cm) warnings.push(T(isDe, `Höhe ${h} cm weicht vom Standard ${family.height_cm} cm ab (auf Anfrage).`, `Height ${h} cm differs from the standard ${family.height_cm} cm (on request).`));
  return { base: family.base_price, label: '', note: '', surchargeW: w1.surcharge, surchargeD: d1.surcharge };
}

/** Approximate glazed area in m² from the configuration alone (no 3D needed). */
export function glassAreaM2(cfg, family) {
  const H = Math.min(cfg.heightCm, 200) / 100 - 0.1;
  const W = cfg.widthCm / 100, D = cfg.depthCm / 100;
  const doorW = family.door_mm[0] / 1000;
  let area = doorW * (family.door_mm[1] / 1000);
  const e = cfg.entry;
  if (e === 'glasfront') area += (W - doorW - 0.2) * H;
  else if (e === 'corner_glasfront') area += (W - 0.2) * H + (Math.min(W, D) - 0.2) * H * 0.5;
  else if (e === 'glass_corner') area += (W - doorW - 0.2) * H + (D - 0.2) * H;
  else if (cfg.window === 'auto') area += 0.95 * H;
  else if (cfg.window === '60') area += 0.6 * H;
  else if (cfg.window === 'two_fixed' || cfg.window === 'tilt_open') area += 2 * 0.6 * 1.7;
  else if (cfg.window === 'round_half') area += 1.2;
  else if (cfg.window === 'round_full') area += 2.6;
  return Math.round(area * 100) / 100;
}

/** Recommended heater power from the industry rule of thumb in catalog.meta.sizing_rules. */
export function recommendedKw(cfg, family, catalog) {
  const r = catalog.meta.sizing_rules || { kw_per_m3: 1, kw_per_m2_glass: 1.2, height_factor_per_30cm_above_200: 0.1 };
  const volume = (cfg.widthCm * cfg.depthCm * cfg.heightCm) / 1e6;
  const glass = glassAreaM2(cfg, family);
  let kw = volume * r.kw_per_m3 + glass * r.kw_per_m2_glass;
  const extra = Math.max(0, cfg.heightCm - 200) / 30;
  kw *= 1 + extra * r.height_factor_per_30cm_above_200;
  if (family.outdoor) kw *= 1.15;
  return { kw: Math.round(kw * 10) / 10, volume: Math.round(volume * 100) / 100, glass };
}

export function electricalNote(kw, catalog, isDe) {
  if (!kw) return null;
  const e = catalog.electrical || { single_phase_max_kw: 3.6, three_phase_volts: 400 };
  if (kw <= e.single_phase_max_kw) return T(isDe, `${kw} kW: 230 V einphasig, 16 A Sicherung, eigener Stromkreis.`, `${kw} kW: 230 V single-phase, 16 A breaker, dedicated circuit.`);
  const amps = Math.ceil((kw * 1000) / (e.three_phase_volts * Math.sqrt(3)));
  return T(isDe, `${kw} kW: 400 V Drehstrom, ca. ${amps} A je Phase, eigener Stromkreis, Anschluss durch Elektrofachkraft.`, `${kw} kW: 400 V three-phase, approx. ${amps} A per phase, dedicated circuit, connected by a licensed electrician.`);
}

/** Does the cabin fit the customer's room? Includes the door swing in front. */
export function roomFit(cfg, family, isDe) {
  const room = cfg.room;
  if (!room) return null;
  const doorSwing = family.door_mm[0] / 10;
  const needW = cfg.widthCm, needD = cfg.depthCm + doorSwing, needH = cfg.heightCm + 5;
  const straight = room.widthCm >= needW && room.depthCm >= needD;
  const turned = room.widthCm >= needD && room.depthCm >= needW;
  const tall = room.heightCm >= needH;
  if ((straight || turned) && tall) {
    return { ok: true, orientation: straight ? 'straight' : 'turned', text: T(isDe, `Passt${!straight ? ' (um 90° gedreht)' : ''}: ${room.widthCm - (straight ? needW : needD)} cm Breite und ${room.depthCm - (straight ? needD : needW)} cm Tiefe Reserve, ${room.heightCm - needH} cm über der Kabine.`, `Fits${!straight ? ' (turned 90°)' : ''}: ${room.widthCm - (straight ? needW : needD)} cm spare width, ${room.depthCm - (straight ? needD : needW)} cm spare depth, ${room.heightCm - needH} cm above the cabin.`) };
  }
  return { ok: false, text: !tall ? T(isDe, `Die Decke ist ${needH - room.heightCm} cm zu niedrig (Kabine ${cfg.heightCm} cm + 5 cm Montagespiel).`, `The ceiling is ${needH - room.heightCm} cm too low (cabin ${cfg.heightCm} cm + 5 cm fitting clearance).`) : T(isDe, `Es werden mindestens ${needW} × ${needD} cm Grundfläche inkl. Türschwenkbereich benötigt.`, `At least ${needW} × ${needD} cm of floor space is needed, including the door swing.`) };
}

export function priceItems(cfg, catalog, lang = 'en') {
  const isDe = lang === 'de';
  const warnings = [], notes = [];
  const family = catalog.families[cfg.family] || catalog.families.fichte;
  const type = familyType(family);
  const items = [];
  const push = (category, sku, name, price, note = '') => items.push({ category, sku, name, price, note });
  const { base, label, note, surchargeW, surchargeD } = priceCabin(cfg, family, warnings, isDe);
  push('cabin', family.sku, `${nameOf(family, lang)}${label ? ` – ${label}` : ''}, ${cfg.widthCm} x ${cfg.depthCm} x ${cfg.heightCm} cm`, base, note);
  if (surchargeW) push('cabin', 'WIDTH', T(isDe, `Aufpreis Breite, ${cfg.widthCm} cm`, `Width surcharge, ${cfg.widthCm} cm`), surchargeW);
  if (surchargeD) push('cabin', 'DEPTH', T(isDe, `Aufpreis Tiefe, ${cfg.depthCm} cm`, `Depth surcharge, ${cfg.depthCm} cm`), surchargeD);
  const entryPrice = (family.entry_prices || {})[cfg.entry] || 0;
  if (entryPrice) push('cabin', 'ENTRY', T(isDe, 'Aufpreis: ', 'Surcharge: ') + nameOf(catalog.entries[cfg.entry], lang), entryPrice);
  if (family.window_price && ['front', 'corner'].includes(cfg.entry) && cfg.window !== 'none') push('cabin', 'WINDOW', T(isDe, 'Aufpreis: Grosses Fenster', 'Surcharge: large window'), family.window_price);
  const windowType = catalog.window_types?.[String(cfg.window)];
  if (windowType?.price && !(family.window_default === String(cfg.window))) push('cabin', `WINDOW-${cfg.window}`, nameOf(windowType, lang), windowType.price);
  const doorGlass = catalog.door_glass?.[cfg.door.glass];
  if (doorGlass?.price) push('cabin', `GLASS-${cfg.door.glass}`, nameOf(doorGlass, lang), doorGlass.price);
  for (const side of ['woodOutside', 'woodInside']) {
    const wood = cfg[side] && catalog.woods[cfg[side]];
    if (wood?.on_request) push('cabin', `WOOD-${cfg[side]}`, T(isDe, `${side === 'woodOutside' ? 'Aussen' : 'Innen'}: ${nameOf(wood, lang)}`, `${side === 'woodOutside' ? 'Outside' : 'Inside'}: ${nameOf(wood, lang)}`), 0, T(isDe, 'Preis auf Anfrage', 'Price on request'));
  }
  const cladding = catalog.claddings[cfg.cladding || 'none'] || catalog.claddings.none;
  if (cladding.price || cladding.price_note) push('cabin', `CLADDING-${(cfg.cladding || 'none').toUpperCase()}`, nameOf(cladding, lang), cladding.price, noteOf(cladding, lang));
  if (family.insulation_options) {
    if (cfg.insulation?.roof) push('cabin', 'INSULATION-ROOF', nameOf(catalog.insulation.roof, lang), catalog.insulation.roof.price);
    if (cfg.insulation?.floor) push('cabin', 'INSULATION-FLOOR', nameOf(catalog.insulation.floor, lang), catalog.insulation.floor.price);
  }

  const interior = catalog.interiors[cfg.interior.material];
  const interiorPrice = type === 'house' && interior.house_price != null ? interior.house_price : interior.price;
  push('interior', cfg.interior.material, T(isDe, 'Innenausstattung: ', 'Interior: ') + nameOf(interior, lang), interiorPrice, noteOf(interior, lang));

  // heater: bundle or standalone
  const sizing = recommendedKw(cfg, family, catalog);
  let heaterKw = 0;
  const heater = cfg.heater?.sku ? catalog.heaters[cfg.heater.sku] : null;
  if (cfg.bundle && catalog.bundles[cfg.bundle]) {
    const b = catalog.bundles[cfg.bundle];
    heaterKw = b.kw;
    push('heater', cfg.bundle, nameOf(b, lang), b.price);
  } else if (heater) {
    heaterKw = heater.kw;
    const noteBits = [noteOf(heater, lang), heater.approx ? T(isDe, 'Masse ca.', 'dimensions approximate') : ''].filter(Boolean).join('; ');
    push('heater', cfg.heater.sku, nameOf(heater, lang), heater.price, noteBits);
    const control = catalog.controls[cfg.control];
    if (heater.control === 'external' && cfg.control === 'none') warnings.push(T(isDe, 'Dieser Ofen benötigt ein separates Steuergerät.', 'This heater needs an external control unit.'));
    if (['integrated', 'none'].includes(heater.control) && cfg.control !== 'none') warnings.push(T(isDe, 'Dieser Ofen hat integrierte Regler (oder ist holzbefeuert); ein separates Steuergerät wird nicht benötigt.', 'This heater has built-in controls (or is wood-fired); a separate control unit is not required.'));
    if (control && cfg.control !== 'none') push('control', cfg.control, nameOf(control, lang), control.price);
  }
  if (heater) {
    if (!(heater.m3[0] <= sizing.volume && sizing.volume <= heater.m3[1])) warnings.push(T(isDe, `${nameOf(heater, lang).split(',')[0]} ist für ${heater.m3[0]}–${heater.m3[1]} m³ ausgelegt; diese Kabine hat ${sizing.volume} m³.`, `${nameOf(heater, lang).split(',')[0]} is rated for ${heater.m3[0]}–${heater.m3[1]} m³; this cabin is ${sizing.volume} m³.`));
    if (!heater.wood_fired && heaterKw < sizing.kw - 0.4) warnings.push(T(isDe, `Empfohlene Ofenleistung ca. ${sizing.kw} kW (${sizing.volume} m³ + ${sizing.glass} m² Glas); gewählt sind ${heaterKw} kW – die Aufheizzeit wird länger.`, `Recommended heater power is about ${sizing.kw} kW (${sizing.volume} m³ + ${sizing.glass} m² of glass); you chose ${heaterKw} kW – heat-up will be slower.`));
    if (heater.wood_fired) {
      if (!cfg.chimney) warnings.push(T(isDe, 'Holzbefeuerte Öfen benötigen ein Schornstein-Set.', 'Wood-fired stoves need a chimney kit.'));
      else { const ch = catalog.chimneys[cfg.chimney]; push('heater', cfg.chimney, nameOf(ch, lang), ch.price); }
    }
  }
  if (cfg.infrared && catalog.infrared[cfg.infrared]) {
    const ir = catalog.infrared[cfg.infrared];
    push('heater', cfg.infrared, nameOf(ir, lang), ir.price, noteOf(ir, lang));
  }

  for (const sku of cfg.lighting) { const spec = catalog.lighting[sku]; if (spec) push('lighting', sku, nameOf(spec, lang), spec.price); }
  for (const sku of cfg.accessories) {
    const spec = catalog.accessories[sku];
    if (!spec) continue;
    if (spec.requires && !cfg.accessories.includes(spec.requires)) warnings.push(T(isDe, `${nameOf(spec, lang)} erfordert ${nameOf(catalog.accessories[spec.requires], lang)}.`, `${nameOf(spec, lang)} requires ${nameOf(catalog.accessories[spec.requires], lang)}.`));
    const size = sizeOf(family, cfg);
    const included = sku === 'TERRACE-70' && size?.terrace_cm;
    push('accessory', sku, nameOf(spec, lang), included ? 0 : spec.price, included ? T(isDe, 'inbegriffen', 'included') : noteOf(spec, lang));
  }
  for (const sku of cfg.services) { const spec = catalog.services[sku]; if (spec) push('service', sku, nameOf(spec, lang), spec.price, sku === 'M' && type !== 'cabin' ? T(isDe, 'Richtwert; Aussensaunen werden auf Anfrage montiert', 'Indicative; outdoor saunas are quoted on request') : ''); }

  const hasLed = cfg.lighting.some(s => ['backrest_strip', 'under_bench', 'backrest_inset'].includes((catalog.lighting[s] || {}).kind));
  if (hasLed && cfg.services.includes('M') && !cfg.services.includes('M-LED')) warnings.push(T(isDe, 'LED-Beleuchtung mit Montage: Der LED-Montageaufpreis von CHF 150 ist noch nicht hinzugefügt.', 'LED lighting with assembly: the CHF 150 LED assembly surcharge is not yet added.'));

  // customer notes (not warnings): electrical, ventilation, lead time, room fit
  const totalKw = heaterKw + (cfg.infrared ? (catalog.infrared[cfg.infrared]?.watts || 0) / 1000 : 0);
  const el = heater && !heater.wood_fired ? electricalNote(Math.round(totalKw * 10) / 10, catalog, isDe) : null;
  if (el) notes.push({ kind: 'electrical', text: el });
  if (type === 'infrared') notes.push({ kind: 'electrical', text: T(isDe, 'Infrarotkabine: 230 V Steckdose, 16 A.', 'Infrared cabin: standard 230 V socket, 16 A.') });
  if (heater && !heater.wood_fired && cfg.ventilation) notes.push({ kind: 'ventilation', text: T(isDe, 'Zuluft unten neben dem Ofen, Abluft oben an der gegenüberliegenden Wand – in der Kabine bereits vorgesehen.', 'Supply air low beside the heater, exhaust high on the opposite wall – already built into the cabin.') });
  const lt = family.lead_time_weeks || [4, 8];
  notes.push({ kind: 'lead_time', text: T(isDe, `Lieferzeit ca. ${lt[0]}–${lt[1]} Wochen${family.sizes ? ' ab Herstellerlager' : ' (Massanfertigung)'}.`, `Lead time approx. ${lt[0]}–${lt[1]} weeks${family.sizes ? ' from stock' : ' (made to measure)'}.`) });
  if (catalog.warranty) notes.push({ kind: 'warranty', text: isDe ? catalog.warranty.de : catalog.warranty.en });
  const fit = type === 'cabin' || type === 'infrared' ? roomFit(cfg, family, isDe) : null;

  const total = Math.round(items.reduce((sum, i) => sum + i.price, 0) * 100) / 100;
  const vat = catalog.meta?.vat_rate ?? 0.081;
  return { items, total, totalExclVat: Math.round((total / (1 + vat)) * 100) / 100, warnings, notes, fit, sizing, heaterKw, volumeM3: sizing.volume, glassM2: sizing.glass, type };
}
