// Small display helpers shared between the persistent panel and the
// click-to-configure drawer: turns a catalog entry into something a
// customer can scan quickly (a colour swatch, a short spec line).

export const nameOf = (spec, lang = 'en') => {
  if (!spec) return '';
  if (lang === 'de') return spec.name_de || spec.name_en || '';
  return spec.name_en || spec.name_de || '';
};

export function woodHex(catalog, key) {
  const [r, g, b] = (catalog.woods[key] || catalog.woods.fichte).color;
  return `#${[r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

export function heaterSpecLine(spec, lang = 'en') {
  const isDe = lang === 'de';
  const bits = [spec.kw ? `${spec.kw} kW` : (isDe ? 'Holzbeheizt' : 'Wood-fired'), `${spec.m3[0]}–${spec.m3[1]} m³`];
  if (spec.control === 'integrated') bits.push(isDe ? 'Regler am Ofen' : 'controls on heater');
  else if (spec.control === 'external') bits.push(isDe ? 'externes Steuergerät nötig' : 'needs control unit');
  if (spec.combi) bits.push(isDe ? 'mit Verdampfer' : 'with steamer');
  return bits.join(' · ');
}

export function fitsVolume(spec, volumeM3) {
  return spec.m3[0] <= volumeM3 && volumeM3 <= spec.m3[1];
}

export function controlSpecLine(spec, lang = 'en') {
  const isDe = lang === 'de';
  return [
    spec.wifi ? (isDe ? 'WLAN + App' : 'WiFi + app') : (isDe ? 'Nur lokal' : 'Local only'),
    spec.series === 'glass' ? (isDe ? 'Glaspanel' : 'glass panel') : (isDe ? 'Klassik-Bedienteil' : 'classic panel')
  ].join(' · ');
}

export function shortFamily(family, lang = 'en') {
  return nameOf(family, lang)
    .replace(', Swiss-made to measure', '')
    .replace(', solid spruce 45 mm, front entry with window', '')
    .replace(', Massivholz 45mm mit Fronteinstieg und Fenster', '')
    .replace(', nach Mass gefertigt in der Schweiz', '');
}
