// A dependency-free "PDF" export: opens a styled, print-ready page (itemised
// quote + 2D floor plan) in a new tab and triggers the browser's print
// dialog, where "Save as PDF" produces the actual file. No PDF library
// needed, and it always matches what generateSpecificationText() reports.
import { generateSpecificationText } from './exportSpec';
import { buildFloorPlanSVG } from './floorPlan';
import { chf } from './format';

export function openPrintableQuote(cfg, catalog, pricing, lang = 'en') {
  const isDe = lang === 'de';
  const family = catalog.families[cfg.family];
  const familyName = (isDe ? family.name_de : family.name_en) || family.name_en || family.name_de;
  const plan = buildFloorPlanSVG(cfg, catalog, lang);
  const specText = generateSpecificationText(cfg, catalog, pricing, lang);
  const rows = pricing.items.filter(i => i.price > 0 || i.note).map(i => `<tr><td>${i.name}${i.note ? `<br><small>${i.note}</small>` : ''}</td><td class="num">${i.price ? chf(i.price) : (isDe ? 'inbegriffen' : 'included')}</td></tr>`).join('');
  const notes = (pricing.notes || []).map(n => `<li>${n.text}</li>`).join('');
  const warnings = (pricing.warnings || []).map(w => `<li>${w}</li>`).join('');
  const date = new Date().toLocaleDateString(isDe ? 'de-CH' : 'en-CH', { year: 'numeric', month: 'long', day: 'numeric' });

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${isDe ? 'Offerte' : 'Quotation'} - ${familyName}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: 'Manrope', 'Segoe UI', sans-serif; color: #25352b; font-size: 12px; line-height: 1.5; margin: 0; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.5px; }
  .meta { color: #738075; font-size: 11px; margin-bottom: 18px; }
  .plan { text-align: center; margin: 16px 0 22px; }
  .plan svg { max-width: 420px; height: auto; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  td { padding: 7px 6px; border-bottom: 1px solid #dce2d8; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; font-weight: 600; }
  td small { color: #738075; }
  .total-row td { border-top: 2px solid #365443; border-bottom: none; font-weight: 700; font-size: 14px; padding-top: 10px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.4px; color: #365443; border-bottom: 1px solid #dce2d8; padding-bottom: 6px; margin: 22px 0 10px; }
  ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 5px; }
  .print-bar { position: fixed; top: 12px; right: 12px; }
  .print-bar button { background: #365443; color: white; border: 0; padding: 10px 16px; border-radius: 6px; font: inherit; cursor: pointer; }
  @media print { .print-bar { display: none; } }
  footer { margin-top: 28px; font-size: 10px; color: #97a191; border-top: 1px solid #dce2d8; padding-top: 10px; }
</style></head><body>
<div class="print-bar"><button onclick="window.print()">${isDe ? 'Als PDF speichern / drucken' : 'Save as PDF / print'}</button></div>
<h1>${familyName}</h1>
<div class="meta">${isDe ? 'Individuelle Offerte' : 'Custom quotation'} - ${date} - ${cfg.widthCm} x ${cfg.depthCm} x ${cfg.heightCm} cm - ${pricing.volumeM3} m³</div>
<div class="plan">${plan}</div>
<h2>${isDe ? 'Positionen' : 'Line items'}</h2>
<table><tbody>${rows}
<tr class="total-row"><td>${isDe ? 'Gesamtpreis inkl. 8.1% MwSt.' : 'Total price incl. 8.1% VAT'}</td><td class="num">${chf(pricing.total)}</td></tr>
</tbody></table>
${notes ? `<h2>${isDe ? 'Technische Hinweise' : 'Technical notes'}</h2><ul>${notes}</ul>` : ''}
${warnings ? `<h2>${isDe ? 'Gut zu wissen' : 'Good to know'}</h2><ul>${warnings}</ul>` : ''}
<footer>${isDe
    ? 'Richtpreise auf Basis der öffentlichen Preisliste von holzsauna.ch (Stand: 2026-09-22). Kein verbindliches Angebot; Bestätigung durch Holzbau Boscheri GmbH erforderlich.'
    : 'Indicative pricing based on the public holzsauna.ch price list (as of 2026-09-22). Not a binding offer; confirmation from Holzbau Boscheri GmbH required.'}</footer>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}
