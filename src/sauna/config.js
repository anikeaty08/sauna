// Configuration shape and normalisation, mirroring DEFAULT_CONFIG / normalise()
// in blender/sauna_configurator.py so the same JSON works on both sides.
// Product types: cabin (indoor made-to-measure / Finn series), barrel, house
// (garden sauna house), infrared. Every family in the catalog carries `type`.

export function widthOptions(family) {
  return family.sizes ? [...new Set(family.sizes.map(s => s.w))].sort((a, b) => a - b) : Object.keys(family.width_cm).map(Number).sort((a, b) => a - b);
}
export function depthOptions(family) {
  return family.sizes ? [...new Set(family.sizes.map(s => s.d))].sort((a, b) => a - b) : Object.keys(family.depth_cm).map(Number).sort((a, b) => a - b);
}
export function sizeOf(family, cfg) {
  if (!family.sizes) return null;
  return family.sizes.find(s => s.w === cfg.widthCm && s.d === cfg.depthCm) || null;
}
export const familyType = family => family.type || 'cabin';
export const isOutdoor = family => !!family.outdoor;

export function defaultConfig(catalog, familyKey = 'fichte') {
  const family = catalog.families[familyKey] || catalog.families.fichte;
  const key = catalog.families[familyKey] ? familyKey : 'fichte';
  const size = family.sizes ? family.sizes[Math.min(2, family.sizes.length - 1)] : null;
  const type = familyType(family);
  return {
    family: key,
    widthCm: size ? size.w : widthOptions(family)[Math.min(2, widthOptions(family).length - 1)],
    depthCm: size ? size.d : depthOptions(family)[Math.min(1, depthOptions(family).length - 1)],
    heightCm: size?.h || family.height_cm,
    boardOrientation: 'horizontal',
    cladding: 'none',
    woodOutside: null,            // bergzauber-style per-side wood, null = family default
    woodInside: null,
    entry: family.entries[0],
    door: { hinge: 'left', position: family.door_position_default || 'left', corner: 'right', glass: (family.door_glass_options || ['clear'])[0], handle: family.handle_default || 'wood_steel' },
    window: family.window_default || (family.window_types ? family.window_types[0] : 'auto'),
    interior: {
      material: family.interior_default, layout: 'straight',
      upperDepthCm: 50, lowerDepthCm: 30, upperHeightCm: 86, lowerHeightCm: 44,
      backrests: true, sideBackrests: true, apron: true, floorGrate: true, headrests: 2, slidingStool: true,
    },
    heater: { sku: type === 'infrared' ? null : (catalog.heaters['HARVIA-VIRTA-90'] ? 'HARVIA-VIRTA-90' : Object.keys(catalog.heaters)[0]), position: 'front_right' },
    bundle: null,                 // heater + control set sku (replaces heater/control pricing when set)
    control: type === 'infrared' ? 'none' : (catalog.controls['UKU-WIFI-CB'] ? 'UKU-WIFI-CB' : 'none'),
    chimney: null,                // wood-fired heaters only
    infrared: null,               // IR emitter add-on sku
    lighting: type === 'infrared' ? [] : ['ZS2'],
    accessories: [],
    ventilation: true,
    insulation: { roof: false, floor: false },
    roofColour: 'black',
    services: ['M', 'L1'],
    room: null,                   // optional { widthCm, depthCm, heightCm } for the fit check
  };
}

export function fromPreset(preset) {
  const c = preset.config;
  return {
    family: c.family, widthCm: c.width_cm, depthCm: c.depth_cm, heightCm: c.height_cm,
    boardOrientation: c.board_orientation, cladding: c.cladding || 'none',
    woodOutside: c.wood_outside || null, woodInside: c.wood_inside || null,
    entry: c.entry,
    door: { hinge: 'left', position: 'left', corner: 'right', glass: 'clear', handle: null, ...c.door },
    window: c.window,
    interior: {
      material: c.interior.material, layout: c.interior.layout,
      upperDepthCm: c.interior.upper_depth_cm, lowerDepthCm: c.interior.lower_depth_cm,
      upperHeightCm: c.interior.upper_height_cm, lowerHeightCm: c.interior.lower_height_cm,
      backrests: c.interior.backrests, sideBackrests: c.interior.side_backrests, apron: c.interior.apron,
      floorGrate: c.interior.floor_grate, headrests: c.interior.headrests, slidingStool: c.interior.sliding_stool,
    },
    heater: { ...c.heater }, bundle: c.bundle || null, control: c.control, chimney: c.chimney || null, infrared: c.infrared || null,
    lighting: [...c.lighting], accessories: [...c.accessories], ventilation: c.ventilation,
    insulation: { roof: false, floor: false, ...(c.insulation || {}) }, roofColour: c.roof_colour || 'black',
    services: [...c.services], room: c.room || null,
  };
}

/** Serialise for the Blender pipeline / share links (snake_case, same keys as presets.json). */
export function toPresetConfig(cfg) {
  return {
    family: cfg.family, width_cm: cfg.widthCm, depth_cm: cfg.depthCm, height_cm: cfg.heightCm,
    board_orientation: cfg.boardOrientation, cladding: cfg.cladding, wood_outside: cfg.woodOutside, wood_inside: cfg.woodInside,
    entry: cfg.entry, door: { ...cfg.door }, window: cfg.window,
    interior: {
      material: cfg.interior.material, layout: cfg.interior.layout,
      upper_depth_cm: cfg.interior.upperDepthCm, lower_depth_cm: cfg.interior.lowerDepthCm,
      upper_height_cm: cfg.interior.upperHeightCm, lower_height_cm: cfg.interior.lowerHeightCm,
      backrests: cfg.interior.backrests, side_backrests: cfg.interior.sideBackrests, apron: cfg.interior.apron,
      floor_grate: cfg.interior.floorGrate, headrests: cfg.interior.headrests, sliding_stool: cfg.interior.slidingStool,
    },
    heater: { ...cfg.heater }, bundle: cfg.bundle, control: cfg.control, chimney: cfg.chimney, infrared: cfg.infrared,
    lighting: [...cfg.lighting], accessories: [...cfg.accessories], ventilation: cfg.ventilation,
    insulation: { ...cfg.insulation }, roof_colour: cfg.roofColour, services: [...cfg.services], room: cfg.room,
  };
}

export function normalizeConfig(cfg, catalog) {
  const base = defaultConfig(catalog, (cfg && cfg.family) || 'fichte');
  const next = structuredClone(cfg || base);
  const family = catalog.families[next.family] ? next.family : 'fichte';
  next.family = family;
  const spec = catalog.families[family];
  const type = familyType(spec);
  next.door = { ...base.door, ...next.door };
  next.interior = { ...base.interior, ...next.interior };
  next.heater = { ...base.heater, ...next.heater };
  next.insulation = { ...base.insulation, ...(next.insulation || {}) };
  next.lighting = Array.isArray(next.lighting) ? next.lighting : base.lighting;
  next.accessories = Array.isArray(next.accessories) ? next.accessories : base.accessories;
  next.services = Array.isArray(next.services) ? next.services : base.services;
  if (next.roofColour == null) next.roofColour = base.roofColour;
  for (const key of ['bundle', 'chimney', 'infrared', 'woodOutside', 'woodInside', 'room']) if (next[key] === undefined) next[key] = null;

  if (!spec.entries.includes(next.entry)) next.entry = spec.entries[0];
  if (!spec.interior_options.includes(next.interior.material)) next.interior.material = spec.interior_default;
  const cladding = catalog.claddings[next.cladding];
  if (!cladding || (cladding.barrel_only && type !== 'barrel') || (cladding.outdoor_only && !spec.outdoor)) next.cladding = 'none';
  if (next.woodOutside && !(spec.wood_options_outside || []).includes(next.woodOutside)) next.woodOutside = null;
  if (next.woodInside && !(spec.wood_options_inside || []).includes(next.woodInside)) next.woodInside = null;

  if (spec.sizes) {
    if (!spec.sizes.some(s => s.w === next.widthCm && s.d === next.depthCm)) {
      const nearest = spec.sizes.reduce((best, s) =>
        Math.abs(s.w - next.widthCm) + Math.abs(s.d - next.depthCm) < Math.abs(best.w - next.widthCm) + Math.abs(best.d - next.depthCm) ? s : best);
      next.widthCm = nearest.w; next.depthCm = nearest.d;
    }
    const size = sizeOf(spec, next);
    if (size?.h) next.heightCm = size.h;
  } else {
    const widths = Object.keys(spec.width_cm).map(Number).sort((a, b) => a - b);
    const depths = Object.keys(spec.depth_cm).map(Number).sort((a, b) => a - b);
    if (!widths.includes(next.widthCm)) next.widthCm = widths.reduce((best, w) => Math.abs(w - next.widthCm) < Math.abs(best - next.widthCm) ? w : best);
    if (!depths.includes(next.depthCm)) next.depthCm = depths.reduce((best, d) => Math.abs(d - next.depthCm) < Math.abs(best - next.depthCm) ? d : best);
  }
  if (!Number.isFinite(next.heightCm)) next.heightCm = spec.height_cm;

  // door options
  const glassOptions = spec.door_glass_options || ['clear', 'bronze', 'grey'];
  if (!glassOptions.includes(next.door.glass)) next.door.glass = glassOptions[0];
  if (!catalog.handles[next.door.handle]) next.door.handle = spec.handle_default || 'wood_steel';
  if (!['left', 'centre', 'right'].includes(next.door.position)) next.door.position = spec.door_position_default || 'left';

  // windows
  const windowTypes = spec.window_types || ['none', 'auto', '60'];
  if (!windowTypes.includes(String(next.window))) next.window = spec.window_default || windowTypes[0];

  // heater / bundle / control / chimney
  if (spec.no_heater) { next.heater.sku = null; next.bundle = null; next.control = 'none'; next.chimney = null; }
  else {
    if (next.bundle && !catalog.bundles[next.bundle]) next.bundle = null;
    if (next.bundle && catalog.bundles[next.bundle].outdoor && !spec.outdoor) next.bundle = null;
    if (next.bundle) { next.heater.sku = catalog.bundles[next.bundle].heater; next.control = catalog.bundles[next.bundle].control; }
    if (!catalog.heaters[next.heater.sku]) next.heater.sku = base.heater.sku;
    if (catalog.heaters[next.heater.sku].outdoor_only && !spec.outdoor) { next.heater.sku = 'HARVIA-VIRTA-90'; next.bundle = null; }
    const heater = catalog.heaters[next.heater.sku];
    if (next.control !== 'none' && !catalog.controls[next.control]) next.control = 'none';
    if (next.control !== 'none' && catalog.controls[next.control].bundle_only && !next.bundle) next.control = 'none';
    if (heater.wood_fired) { next.control = 'none'; if (next.chimney && !catalog.chimneys[next.chimney]) next.chimney = null; }
    else next.chimney = null;
  }
  if (next.infrared && (!catalog.infrared[next.infrared] || type === 'infrared')) next.infrared = null;

  next.lighting = next.lighting.filter(sku => catalog.lighting[sku] && !catalog.lighting[sku].included_with);
  next.accessories = next.accessories.filter(sku => {
    const a = catalog.accessories[sku];
    return a && !(a.barrel_only && type !== 'barrel') && !(a.min_depth_cm && next.depthCm < a.min_depth_cm);
  });
  if (type === 'barrel') {
    const size = sizeOf(spec, next);
    if (size?.terrace_cm && !next.accessories.includes('TERRACE-70')) next.accessories.push('TERRACE-70');
  }
  if (!spec.insulation_options) next.insulation = { roof: false, floor: false };
  if (!(spec.roof_colours || ['black']).includes(next.roofColour)) next.roofColour = (spec.roof_colours || ['black'])[0];
  next.services = next.services.filter(sku => catalog.services[sku]);
  if (next.services.includes('M') && next.services.includes('M-REQUEST')) next.services = next.services.filter(s => s !== 'M-REQUEST');
  if (next.room && !(next.room.widthCm > 0 && next.room.depthCm > 0 && next.room.heightCm > 0)) next.room = null;
  return next;
}
