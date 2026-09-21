// Small display helpers shared between the persistent panel and the
// click-to-configure drawer: turns a catalog entry into something a
// customer can scan quickly (a colour swatch, a short spec line).

export const nameOf = spec => (spec && (spec.name_en || spec.name_de)) || '';

export function woodHex(catalog, key) {
  const [r, g, b] = (catalog.woods[key] || catalog.woods.fichte).color;
  return `#${[r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function heaterSpecLine(spec) {
  const bits = [spec.kw ? `${spec.kw} kW` : 'Wood-fired', `${spec.m3[0]}–${spec.m3[1]} m³`];
  if (spec.control === 'integrated') bits.push('controls on heater');
  else if (spec.control === 'external') bits.push('needs control unit');
  if (spec.combi) bits.push('with steamer');
  return bits.join(' · ');
}

export function fitsVolume(spec, volumeM3) {
  return spec.m3[0] <= volumeM3 && volumeM3 <= spec.m3[1];
}

export function controlSpecLine(spec) {
  return [spec.wifi ? 'WiFi + app' : 'Local only', spec.series === 'glass' ? 'glass panel' : 'classic panel'].join(' · ');
}

export function shortFamily(family) {
  return nameOf(family).replace(', Swiss-made to measure', '').replace(', solid spruce 45 mm, front entry with window', '');
}
