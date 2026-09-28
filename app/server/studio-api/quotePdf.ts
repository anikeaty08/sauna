/**
 * Server-side quotation PDF for a saved design (A4 portrait, formal layout):
 *   page 1  letterhead, quotation details, line items, VAT totals, terms
 *   page 2  technical specification and the dimensioned floor plan
 * Everything is derived from the saved configuration and re-priced here;
 * nothing from the browser is trusted.
 */
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Writable } from 'node:stream';
import {
  computeLayout, floorPlanSvg, priceConfiguration, type ModelDefinition, type SaunaConfiguration,
} from '../../../packages/configuration-core/index.ts';

const LOGO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logo.png');
// Company details as published on holzsauna.ch.
const COMPANY = { name: 'HolzSauna', street: 'Hauptstrasse 40', city: '8507 Hörhausen', phone: '052 552 43 23', email: 'info@holzsauna.ch', web: 'www.holzsauna.ch' };
const INK = '#1c1c1c', MUTED = '#6b6964', LINE = '#dcd8d1', BAND = '#f4f2ee', ACCENT = '#662d11';

/** Swiss money format: 19'990.00 (rounded to 5 Rappen). */
const money = (v: number) => {
  const r = Math.round(v * 20) / 20;
  const [int, dec] = r.toFixed(2).split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${dec}`;
};
const date = (d: Date) => d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function writeQuotePdf(out: Writable, model: ModelDefinition, config: SaunaConfiguration, meta: { id: string; url: string; date: Date }) {
  const layout = computeLayout(model, config);
  const price = priceConfiguration(model, config);
  const set = model.options.heaterSet.find(h => h.id === config.heaterSet);
  const wood = model.options.benchWood.find(w => w.id === config.materials.benchWood);
  const c = model.construction;
  const size = `${config.dimensions.widthCm} × ${config.dimensions.depthCm} × ${model.dimensions.heightMm / 10} cm`;
  const quoteNo = `Q-${meta.date.getFullYear()}-${meta.id.slice(0, 8).toUpperCase()}`;
  const validUntil = new Date(meta.date.getTime() + 30 * 86400000);

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: `Quotation ${quoteNo} – ${model.name}`, Author: COMPANY.name, Subject: 'Sauna quotation' } });
  doc.pipe(out);
  const L = 50, R = doc.page.width - 50, CW = R - L;

  // ── page 1: letterhead ──────────────────────────────────────────────────────
  try { doc.image(LOGO, L, 44, { height: 46 }); } catch { doc.font('Helvetica-Bold').fontSize(22).fillColor(ACCENT).text(COMPANY.name, L, 50); }
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  [COMPANY.name, COMPANY.street, COMPANY.city, `Tel. ${COMPANY.phone}`, COMPANY.email, COMPANY.web]
    .forEach((line, i) => doc.text(line, R - 180, 48 + i * 11, { width: 180, align: 'right', lineBreak: false }));

  doc.moveTo(L, 118).lineTo(R, 118).lineWidth(1.5).strokeColor(ACCENT).stroke();

  // title + quotation details
  doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text('Quotation', L, 140, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Non-binding quotation from the online configurator', L, 168, { lineBreak: false });
  const details: [string, string][] = [['Quotation no.', quoteNo], ['Date', date(meta.date)], ['Valid until', date(validUntil)], ['Design reference', meta.id]];
  details.forEach(([k, v], i) => {
    const y = 140 + i * 14;
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k, R - 220, y, { width: 100, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(v, R - 115, y, { width: 115, align: 'right', lineBreak: false });
  });

  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(
    `Thank you for configuring your sauna with us. Please find below our quotation for the ${model.fullName}, made to measure in our own workshop in Switzerland, at ${size} (width × depth × height, outside).`,
    L, 212, { width: CW, lineGap: 2 });

  // ── line items ──────────────────────────────────────────────────────────────
  const col = { pos: L, desc: L + 34, qty: R - 190, unit: R - 150, amount: R - 75 };
  let y = doc.y + 18;
  doc.rect(L, y, CW, 20).fill(BAND);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
  doc.text('POS.', col.pos + 6, y + 6, { lineBreak: false });
  doc.text('DESCRIPTION', col.desc, y + 6, { lineBreak: false });
  doc.text('QTY', col.qty, y + 6, { width: 30, align: 'right', lineBreak: false });
  doc.text('UNIT CHF', col.unit, y + 6, { width: 70, align: 'right', lineBreak: false });
  doc.text('AMOUNT CHF', col.amount, y + 6, { width: 75, align: 'right', lineBreak: false });
  y += 28;

  const detailFor = (id: string): string => {
    if (id === 'base') return `Base size 150 × 150 cm. ${c.wallMm} mm solid Austrian Zirbe walls and ceiling, slate panel exterior, ${c.glassMm} mm clear glass front with aluminium profile, glass door approx. ${c.door.widthMm / 10} × ${c.door.heightMm / 10} cm without threshold, knot-free Espe benches and backrests.`;
    if (id === 'width') return 'Surcharge for the chosen width (made to measure).';
    if (id === 'depth') return 'Surcharge for the chosen depth (made to measure).';
    if (id.startsWith('wood:')) return 'Benches and backrests in alder instead of aspen.';
    if (id.startsWith('heater:')) return set?.name.split(', ').slice(1).join(', ') ?? '';
    return '';
  };
  price.lines.forEach((l, i) => {
    const title = l.id === 'base' ? model.fullName : l.label.replace(/^Set: /, '').split(', incl.')[0];
    const detail = detailFor(l.id) || (l.id.startsWith('acc:') ? l.label : '');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(title, col.desc, y, { width: col.qty - col.desc - 10 });
    let yy = doc.y;
    if (detail && detail !== title) { doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(detail, col.desc, yy + 1, { width: col.qty - col.desc - 10, lineGap: 1 }); yy = doc.y; }
    if (l.note) { doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED).text(l.note, col.desc, yy + 1, { width: col.qty - col.desc - 10 }); yy = doc.y; }
    const amount = l.price === null ? 'on request' : money(l.price);
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(String(i + 1), col.pos + 6, y, { lineBreak: false });
    doc.text('1', col.qty, y, { width: 30, align: 'right', lineBreak: false });
    doc.text(amount, col.unit, y, { width: 70, align: 'right', lineBreak: false });
    doc.text(amount, col.amount, y, { width: 75, align: 'right', lineBreak: false });
    y = yy + 8;
    doc.moveTo(L, y - 4).lineTo(R, y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
  });

  // ── totals (prices are VAT-inclusive; show the split) ───────────────────────
  const gross = price.total, net = gross / (1 + model.vatRate), vat = gross - net;
  y += 6;
  const total = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 9).fillColor(INK);
    doc.text(label, R - 250, y, { width: 165, lineBreak: false });
    doc.text(value, R - 85, y, { width: 85, align: 'right', lineBreak: false });
    y += bold ? 18 : 14;
  };
  total('Subtotal excl. VAT', money(net));
  total(`VAT ${Math.round(model.vatRate * 1000) / 10} %`, money(vat));
  doc.moveTo(R - 250, y - 2).lineTo(R, y - 2).lineWidth(1).strokeColor(INK).stroke();
  y += 4;
  total('Total CHF incl. VAT', money(gross), true);
  doc.moveTo(R - 250, y - 5).lineTo(R, y - 5).lineWidth(0.6).strokeColor(INK).stroke();
  doc.moveTo(R - 250, y - 3).lineTo(R, y - 3).lineWidth(0.6).strokeColor(INK).stroke();
  if (price.onRequest) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED).text('Positions marked "on request" are not included in the total and will be confirmed by HolzSauna.', R - 250, y + 2, { width: 250 });
    y = doc.y;
  }

  // ── terms ───────────────────────────────────────────────────────────────────
  y = Math.max(y + 24, 560);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Terms', L, y, { lineBreak: false });
  y += 15;
  const terms: [string, string][] = [
    ['Validity', `This quotation is valid until ${date(validUntil)}.`],
    ['Prices', `In Swiss francs, incl. ${Math.round(model.vatRate * 1000) / 10} % VAT, plus shipping, as on holzsauna.ch.`],
    ['Production', 'Made to measure in our own workshop in Switzerland; final dimensions are confirmed by HolzSauna before production.'],
    ['Room', 'Room dimensions are measured without plaster or wall covering.'],
    ['Your design', meta.url],
  ];
  for (const [k, v] of terms) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k, L, y, { width: 90, lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor(k === 'Your design' ? ACCENT : INK).text(v, L + 95, y, { width: CW - 95, link: k === 'Your design' ? v : undefined });
    y = doc.y + 4;
  }
  doc.font('Helvetica').fontSize(9).fillColor(INK).text('We look forward to hearing from you.', L, y + 10, { lineBreak: false });
  doc.font('Helvetica-Bold').text(`Your ${COMPANY.name} team`, L, y + 24, { lineBreak: false });

  // ── page 2: technical specification + floor plan ────────────────────────────
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('Technical specification', L, 56, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`${model.fullName} · ${size}`, L, 78, { lineBreak: false });
  y = 102;
  const spec: [string, [string, string][]][] = [
    ['Construction', [
      ['Walls and ceiling', `${c.wallMm} mm solid Austrian Zirbe (stone pine)`],
      ['Exterior', 'Slate panels, slate-wrapped fascia'],
      ['Glass front', `${c.glassMm} mm clear glass, aluminium profile at the floor`],
      ['Door', `Clear glass, approx. ${c.door.widthMm / 10} × ${c.door.heightMm / 10} cm, no threshold; handle wood inside, stainless steel outside`],
    ]],
    ['Interior', [
      ['Benches', `${wood?.name ?? ''}, ${c.benches.slatMm} mm solid slats`],
      ['Upper benches', `Long bench ${(layout.benches.long.depth * 100).toFixed(1)} cm, short bench ${(layout.benches.short.depth * 100).toFixed(0)} cm deep; 2 slightly rounded backrests; cladding under both upper benches`],
      ['Lower bench', 'Stands on feet, movable'],
    ]],
    ['Heater and control', [['Set', set?.id === 'none' ? 'Without heater and control' : (set?.name.replace(/^Set: /, '') ?? '')]]],
    ['Accessories', config.accessories.length ? config.accessories.map(id => ['', model.options.accessories.find(a => a.id === id)?.name ?? id] as [string, string]) : [['', 'None']]],
  ];
  for (const [group, rows] of spec) {
    doc.rect(L, y, CW, 16).fill(BAND);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(group.toUpperCase(), L + 6, y + 5, { lineBreak: false, characterSpacing: 0.5 });
    y += 21;
    for (const [k, v] of rows) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k, L + 6, y, { width: 110, lineBreak: false });
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(v, L + 125, y, { width: CW - 131 });
      y = doc.y + 5;
    }
    y += 6;
  }

  y += 6;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Floor plan', L, y, { lineBreak: false });
  y += 18;
  const planH = Math.min(400, doc.page.height - 90 - y);
  doc.rect(L, y, CW, planH).lineWidth(0.6).strokeColor(LINE).stroke();
  SVGtoPDF(doc, floorPlanSvg(layout, { heater: !!set?.heater, control: !!set?.control }), L + 10, y + 10, { width: CW - 20, height: planH - 20, preserveAspectRatio: 'xMidYMid meet' });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Plan view, dimensions in mm (outside). Room dimensions without plaster or wall covering.', L, y + planH + 6, { width: CW, lineBreak: false });

  // ── footer on every page ────────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // write inside the margin without triggering a new page
    const fy = doc.page.height - 38;
    doc.moveTo(L, fy - 6).lineTo(R, fy - 6).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(`${COMPANY.name} · ${COMPANY.street} · ${COMPANY.city} · Tel. ${COMPANY.phone} · ${COMPANY.email}`, L, fy, { width: CW - 70, lineBreak: false })
      .text(`Page ${i - range.start + 1} of ${range.count}`, R - 70, fy, { width: 70, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}
