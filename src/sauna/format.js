export function chf(value) {
  const n = Math.round(Number(value) || 0);
  return `CHF ${n.toLocaleString('de-CH').replace(/,/g, "'")}.–`;
}
export function chfDelta(value) {
  if (!value) return '';
  return `${value > 0 ? '+' : '-'}${chf(Math.abs(value))}`;
}
export function dimsLabel(dims) {
  if (!dims || dims.every(v => !v)) return '';
  return dims.map(v => Math.round(v)).join(' x ') + ' mm';
}
