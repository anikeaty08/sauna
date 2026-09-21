// Configuration shape and normalisation, mirroring DEFAULT_CONFIG / normalise()
// in blender/sauna_configurator.py so the same JSON works on both sides.

export function defaultConfig(catalog, familyKey = 'fichte') {
  const family = catalog.families[familyKey];
  return {
    family: familyKey,
    widthCm: family.sizes ? family.sizes[0].w : Number(Object.keys(family.width_cm)[Math.min(2, Object.keys(family.width_cm).length - 1)]),
    depthCm: family.sizes ? family.sizes[0].d : Number(Object.keys(family.depth_cm)[Math.min(1, Object.keys(family.depth_cm).length - 1)]),
    heightCm: family.height_cm,
    boardOrientation: 'horizontal',
    cladding: 'none',
    entry: family.entries[0],
    door: { hinge: 'left', position: 'left', corner: 'right' },
    window: 'auto',
    interior: {
      material: family.interior_default, layout: 'straight',
      upperDepthCm: 50, lowerDepthCm: 30, upperHeightCm: 86, lowerHeightCm: 44,
      backrests: true, sideBackrests: true, apron: true, floorGrate: true, headrests: 2, slidingStool: true,
    },
    heater: { sku: Object.keys(catalog.heaters)[0], position: 'front_right' },
    control: 'none',
    lighting: ['ZS2'],
    accessories: [],
    ventilation: true,
    services: ['M', 'L1'],
  };
}

export function fromPreset(preset) {
  const c = preset.config;
  return {
    family: c.family, widthCm: c.width_cm, depthCm: c.depth_cm, heightCm: c.height_cm,
    boardOrientation: c.board_orientation, cladding: c.cladding || 'none', entry: c.entry,
    door: { ...c.door }, window: c.window,
    interior: {
      material: c.interior.material, layout: c.interior.layout,
      upperDepthCm: c.interior.upper_depth_cm, lowerDepthCm: c.interior.lower_depth_cm,
      upperHeightCm: c.interior.upper_height_cm, lowerHeightCm: c.interior.lower_height_cm,
      backrests: c.interior.backrests, sideBackrests: c.interior.side_backrests, apron: c.interior.apron,
      floorGrate: c.interior.floor_grate, headrests: c.interior.headrests, slidingStool: c.interior.sliding_stool,
    },
    heater: { ...c.heater }, control: c.control,
    lighting: [...c.lighting], accessories: [...c.accessories], ventilation: c.ventilation, services: [...c.services],
  };
}

export function normalizeConfig(cfg, catalog) {
  const next = structuredClone(cfg);
  const family = catalog.families[next.family] ? next.family : 'fichte';
  next.family = family;
  const spec = catalog.families[family];
  if (!spec.entries.includes(next.entry)) next.entry = spec.entries[0];
  if (!spec.interior_options.includes(next.interior.material)) next.interior.material = spec.interior_default;
  if (!catalog.claddings[next.cladding]) next.cladding = 'none';
  if (spec.sizes) {
    if (!spec.sizes.some(s => s.w === next.widthCm && s.d === next.depthCm)) {
      const nearest = spec.sizes[0];
      next.widthCm = nearest.w; next.depthCm = nearest.d;
    }
  } else {
    const widths = Object.keys(spec.width_cm).map(Number);
    const depths = Object.keys(spec.depth_cm).map(Number);
    if (!widths.includes(next.widthCm)) next.widthCm = widths[Math.floor(widths.length / 2)];
    if (!depths.includes(next.depthCm)) next.depthCm = depths[Math.floor(depths.length / 2)];
  }
  if (!catalog.heaters[next.heater.sku]) next.heater.sku = Object.keys(catalog.heaters)[0];
  if (next.control !== 'none' && !catalog.controls[next.control]) next.control = 'none';
  next.lighting = next.lighting.filter(sku => catalog.lighting[sku]);
  next.accessories = next.accessories.filter(sku => catalog.accessories[sku]);
  next.services = next.services.filter(sku => catalog.services[sku]);
  return next;
}

export function widthOptions(family) {
  return family.sizes ? [...new Set(family.sizes.map(s => s.w))].sort((a, b) => a - b) : Object.keys(family.width_cm).map(Number).sort((a, b) => a - b);
}
export function depthOptions(family) {
  return family.sizes ? [...new Set(family.sizes.map(s => s.d))].sort((a, b) => a - b) : Object.keys(family.depth_cm).map(Number).sort((a, b) => a - b);
}
