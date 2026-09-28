export function chf(value: number): string {
  return `CHF ${Math.round(value || 0).toLocaleString('de-CH').replace(/,/g, "'")}.–`;
}

export function chfDelta(value: number | null | undefined, note?: string): string {
  if (value === null) return note ? 'on request' : 'on request';
  if (!value) return 'included';
  return `${value > 0 ? '+' : '-'}${chf(Math.abs(value))}`;
}
