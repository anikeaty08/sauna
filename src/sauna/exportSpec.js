import { chf } from './format';

export function generateSpecificationText(cfg, catalog, pricing) {
  const family = (catalog && catalog.families && catalog.families[cfg.family]) || {};
  const familyName = family.name_en || family.name_de || 'Bespoke Sauna';
  const wood = (catalog && catalog.woods && catalog.woods[cfg.wall_wood || family.wall_wood || 'fichte']) || {};
  const interior = (catalog && catalog.interiors && catalog.interiors[cfg.interior?.material]) || {};
  const heater = (catalog && catalog.heaters && catalog.heaters[cfg.heater?.sku]) || {};
  const control = (catalog && catalog.controls && catalog.controls[cfg.control]) || {};
  const cladding = (catalog && catalog.claddings && catalog.claddings[cfg.cladding || 'none']) || {};
  const entry = (catalog && catalog.entries && catalog.entries[cfg.entry]) || {};

  const w = cfg.widthCm || cfg.width_cm || 200;
  const d = cfg.depthCm || cfg.depth_cm || 180;
  const h = cfg.heightCm || cfg.height_cm || 202;
  const footprint = ((w * d) / 10000).toFixed(2);
  const volume = pricing?.volumeM3 ? Number(pricing.volumeM3).toFixed(2) : ((w * d * h) / 1e6).toFixed(2);

  const date = new Date().toLocaleDateString('de-CH', { year: 'numeric', month: '2-digit', day: '2-digit' });

  const lines = [
    '=================================================================',
    '                   SAUNA STUDIO SWITZERLAND                      ',
    '                 Bespoke Specification & Quote                   ',
    '=================================================================',
    `Date:                 ${date}`,
    `Model Line:           ${familyName}`,
    '',
    '-- 1. DIMENSIONS & ROOM CLEARANCE -------------------------------',
    `Exterior Dimensions:  ${w} × ${d} × ${h} cm (W × D × H)`,
    `Footprint:            ${footprint} m²`,
    `Cabin Volume:         ${volume} m³`,
    '',
    '-- 2. CABIN & TIMBER SPECIFICATION ------------------------------',
    `Wall Construction:    ${family.wall_mm || 45} mm solid timber (${wood.name_en || wood.name_de || 'Spruce'})`,
    `Board Orientation:    ${cfg.board_orientation === 'vertical' ? 'Vertical cladding' : 'Horizontal tongue & groove'}`,
    `Corner Cladding:      ${cladding.name_en || cladding.name_de || 'None'}`,
    `Entry Type:           ${entry.name_en || entry.name_de || 'Front entrance'}`,
    `Door:                 8 mm tempered safety glass, ${cfg.door?.hinge || 'left'} hinge`,
    `Window:               ${cfg.window === 'none' ? 'None' : 'Panoramic safety glass window'}`,
    '',
    '-- 3. INTERIOR & SEATING ----------------------------------------',
    `Interior Material:    ${interior.name_en || interior.name_de || 'Nordic Aspen'}`,
    `Bench Layout:         ${cfg.interior?.layout === 'U' ? 'U-Shape benches' : cfg.interior?.layout === 'L' ? 'L-Shape benches' : 'Straight benches'}`,
    `Backrests:            ${cfg.interior?.backrests ? 'Included' : 'Not included'}`,
    `Bench Apron:          ${cfg.interior?.apron ? 'Included' : 'Not included'}`,
    `Floor Grate:          ${cfg.interior?.floor_grate ? 'Included' : 'Not included'}`,
    `Headrests:            ${cfg.interior?.headrests || 0} unit(s)`,
    '',
    '-- 4. HEATER & CONTROLS -----------------------------------------',
    `Heater Model:         ${heater.name_en || heater.name_de || 'Sauna Heater'}`,
    `Power Rating:         ${heater.kw || '3.6'} kW (recommended for ${heater.m3 ? heater.m3.join('–') + ' m³' : volume + ' m³'})`,
    `Control Unit:         ${control.name_en || control.name_de || 'Integrated on-heater dials'}`,
    `Operating Mode:       ${heater.wood_fired ? 'Wood-fired' : heater.combi ? 'Bio-Combi (Dry Sauna / Herbal Steam)' : 'Electric Finnish sauna'}`,
    '',
    '-- 5. LIGHTING & VENTILATION ------------------------------------',
    `Lighting:             ${(cfg.lighting || []).length > 0 ? (cfg.lighting || []).map(id => (catalog.lighting[id]?.name_en || catalog.lighting[id]?.name_de || id)).join(', ') : 'Standard sauna lighting'}`,
    `Ventilation:          ${cfg.ventilation ? 'Inflow & outflow ventilation louvers included' : 'Standard passive convection'}`,
    '',
    '-- 6. ITEMIZED BILL OF MATERIALS & PRICING ----------------------',
  ];

  if (pricing?.items) {
    for (const item of pricing.items) {
      if (item.price > 0) {
        const itemPrice = chf(item.price).padStart(14, ' ');
        const itemName = item.name.length > 46 ? item.name.slice(0, 43) + '...' : item.name.padEnd(46, '.');
        lines.push(`${itemName} ${itemPrice}`);
      }
    }
  }

  const total = pricing?.total || 0;
  const vat = Math.round((total * 0.081) / 1.081);
  const net = total - vat;

  lines.push(
    '-----------------------------------------------------------------',
    `Subtotal (net excl. VAT):                        ${chf(net).padStart(14, ' ')}`,
    `VAT (8.1% included):                             ${chf(vat).padStart(14, ' ')}`,
    '-----------------------------------------------------------------',
    `TOTAL INDICATIVE PRICE:                          ${chf(total).padStart(14, ' ')}`,
    '=================================================================',
    '',
    'Notes & Conditions:',
    '• Indicative quote based on official Swiss manufacturer catalog rates.',
    '• Please verify electrical connection (400V 3N~ or 230V 1N~), flooring level, and wall clearances with your local electrician/contractor.',
    '• Generated from Sauna Studio 3D Configurator.'
  );

  return lines.join('\n');
}

export function downloadSpecification(cfg, catalog, pricing, filename = 'sauna-specification') {
  const text = generateSpecificationText(cfg, catalog, pricing);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
