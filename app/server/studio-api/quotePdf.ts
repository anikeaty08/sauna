/**
 * Server-side quotation PDF for a saved design, laid out like HolzSauna's own
 * offers (A4 portrait):
 *   page 1  letterhead, quotation no., line items with the other options at
 *           quantity 0, VAT breakdown, delivery notes, sign-off
 *   page 2  product page: photo and construction details
 *   page 3  plan sketch: the dimensioned floor plan of this exact design
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.join(HERE, 'logo.png');
const PHOTO = path.join(HERE, 'product-589.jpg');
// Company details as printed on HolzSauna's quotations.
const COMPANY = {
  legal: 'Holzsauna by Holzbau Boscheri GmbH', street: 'Hauptstrasse 40', city: '8507 Hörhausen',
  phone: '052 552 43 21', email: 'info@holzsauna.ch', web: 'www.holzsauna.ch', vat: 'CHE-329.191.810 MWST',
};
// Article numbers from HolzSauna's catalogue, where one exists.
const ARTICLE: Record<string, string> = { sauna: '589', 'nova-set-4': 'S2342' };
const INK = '#1c1c1c', MUTED = '#6b6964', LINE = '#d9d5ce', BAND = '#f3f1ed', ACCENT = '#662d11';

/** Swiss money format: 19'990.00 (rounded to 5 Rappen). */
const money = (v: number) => {
  const r = Math.round(v * 20) / 20;
  const [int, dec] = r.toFixed(2).split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${dec}`;
};
const date = (d: Date) => d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });

interface Row { qty: number; art: string; title: string; detail?: string; unit: number | null; note?: string }

export function writeQuotePdf(out: Writable, model: ModelDefinition, config: SaunaConfiguration, meta: { id: string; url: string; date: Date }) {
  const layout = computeLayout(model, config);
  const price = priceConfiguration(model, config);
  const o = model.options, c = model.construction;
  const set = o.heaterSet.find(h => h.id === config.heaterSet);
  const wood = o.benchWood.find(w => w.id === config.materials.benchWood);
  const heightCm = model.dimensions.heightMm / 10;
  const size = `${config.dimensions.widthCm} × ${config.dimensions.depthCm} × ${heightCm} cm`;
  const quoteNo = `A${meta.date.getFullYear()}${String(meta.date.getMonth() + 1).padStart(2, '0')}${String(meta.date.getDate()).padStart(2, '0')}-${meta.id.slice(0, 6).toUpperCase()}`;
  const validUntil = new Date(meta.date.getTime() + 30 * 86400000);
  const vatPct = `${(model.vatRate * 100).toFixed(2)} %`;

  // ── rows: what is ordered, then the other options at quantity 0 ────────────
  const line = (id: string) => price.lines.find(l => l.id === id);
  const sizeSurcharge = (line('width')?.price ?? 0) + (line('depth')?.price ?? 0);
  const setTitle = (name: string) => name.replace(/^Set: /, '');
  const rows: Row[] = [{
    qty: 1, art: ARTICLE.sauna, title: `${model.fullName}, ${size} (W × D × H)`,
    detail: `${c.wallMm} mm solid Zirbe, slate panel exterior, ${c.glassMm} mm glass front with glass door, ${wood?.name ?? 'Espe'} benches.`
      + (sizeSurcharge ? ` Incl. made-to-measure surcharge CHF ${money(sizeSurcharge)}.` : ''),
    unit: model.basePrice + sizeSurcharge,
  }];
  const woodLine = price.lines.find(l => l.id.startsWith('wood:'));
  if (woodLine) rows.push({ qty: 1, art: '', title: `Benches and backrests in ${wood?.name ?? ''}`, unit: woodLine.price, note: woodLine.note });
  if (set && set.id !== 'none') rows.push({ qty: 1, art: 'Set', title: setTitle(set.name), unit: set.price, note: set.priceNote });
  for (const id of config.accessories) {
    const a = o.accessories.find(x => x.id === id);
    if (a) rows.push({ qty: 1, art: ARTICLE[a.id] ?? '', title: a.name, unit: a.price, note: a.priceNote });
  }
  const options: Row[] = [
    ...o.heaterSet.filter(h => h.id !== 'none' && h.id !== config.heaterSet).map(h => ({ qty: 0, art: 'Option', title: setTitle(h.name), unit: h.price })),
    ...o.accessories.filter(a => !config.accessories.includes(a.id)).map(a => ({ qty: 0, art: ARTICLE[a.id] ? `Option ${ARTICLE[a.id]}` : 'Option', title: a.name, unit: a.price })),
    ...o.benchWood.filter(w => w.id !== config.materials.benchWood).map(w => ({ qty: 0, art: 'Option', title: `Benches and backrests in ${w.name}`, unit: w.price })),
  ];

  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, left: 56, right: 56, bottom: 60 }, bufferPages: true, info: { Title: `Quotation ${quoteNo} – ${model.name}`, Author: COMPANY.legal, Subject: 'Sauna quotation' } });
  doc.pipe(out);
  const L = 56, R = doc.page.width - 56, CW = R - L;

  const letterhead = () => {
    try { doc.image(LOGO, L, 36, { height: 44 }); } catch { doc.font('Helvetica-Bold').fontSize(22).fillColor(ACCENT).text('HolzSauna', L, 44); }
  };

  // ── page 1: quotation ──────────────────────────────────────────────────────
  letterhead();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(`${COMPANY.legal}, ${COMPANY.street}, ${COMPANY.city}`, L, 92, { lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(INK);
  [`Tel: ${COMPANY.phone}`, `Web: ${COMPANY.web}`, `E-Mail: ${COMPANY.email}`].forEach((t, i) => doc.text(t, L, 104 + i * 10.5, { lineBreak: false }));

  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('Quotation', L, 156, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
    .text(`Quotation no.: ${quoteNo}`, L, 190, { lineBreak: false })
    .text(`Design reference: ${meta.id}`, L, 201, { lineBreak: false });

  // right column: addressee + date (the online design has no postal address yet)
  const AX = L + CW * 0.62;
  doc.font('Helvetica').fontSize(10).fillColor(INK)
    .text('Online configurator customer', AX, 158, { width: R - AX })
    .fillColor(MUTED).fontSize(8.5).text('Saved design, see link below', AX, doc.y + 1, { width: R - AX });
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(date(meta.date), AX, 204, { lineBreak: false });

  doc.font('Helvetica').fontSize(10).fillColor(INK)
    .text('Dear customer,', L, 238)
    .moveDown(0.6)
    .text('thank you for your interest in our products. As requested, please find our quotation for your configured sauna below:', { width: CW, lineGap: 1.5 });

  // table
  const col = { pos: L, qty: L + 26, art: L + 58, desc: L + 116, unit: R - 136, total: R - 66 };
  const DW = col.unit - col.desc - 10;
  let y = doc.y + 14;
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK);
    doc.text('Pos.', col.pos, y, { lineBreak: false });
    doc.text('Qty', col.qty, y, { lineBreak: false });
    doc.text('Art. no.', col.art, y, { lineBreak: false });
    doc.text('Description', col.desc, y, { lineBreak: false });
    doc.text('Unit price', col.unit, y, { width: 64, align: 'right', lineBreak: false });
    doc.text('Total incl. VAT', col.total - 12, y, { width: 78, align: 'right', lineBreak: false });
    y += 12;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.8).strokeColor(INK).stroke();
    y += 5;
  };
  header();
  [...rows, ...options].forEach((r, i) => {
    // measure the row first so a long description never splits across the page break
    doc.font('Helvetica').fontSize(8.5);
    let h = doc.heightOfString(r.title, { width: DW });
    if (r.detail) h += doc.fontSize(7.5).heightOfString(r.detail, { width: DW }) + 1;
    if (r.note) h += doc.fontSize(7).heightOfString(r.note, { width: DW }) + 1;
    if (y + h > doc.page.height - 70) { doc.addPage(); letterhead(); y = 100; header(); }
    if (r.qty === 0) doc.rect(L, y - 3, CW, h + 6).fill(BAND);
    const ink = r.qty ? INK : MUTED;
    const unit = r.unit === null ? 'on request' : money(r.unit);
    const total = r.qty === 0 ? '0.00' : r.unit === null ? 'on request' : money(r.unit * r.qty);
    doc.font('Helvetica').fontSize(8.5).fillColor(ink);
    doc.text(String(i + 1), col.pos, y, { lineBreak: false });
    doc.text(String(r.qty), col.qty, y, { lineBreak: false });
    doc.text(r.art, col.art, y, { width: col.desc - col.art - 6 });
    doc.text(unit, col.unit, y, { width: 64, align: 'right', lineBreak: false });
    doc.text(total, col.total - 12, y, { width: 78, align: 'right', lineBreak: false });
    doc.font(r.qty ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(ink).text(r.title, col.desc, y, { width: DW });
    if (r.detail) doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(r.detail, col.desc, doc.y + 1, { width: DW });
    if (r.note) doc.font('Helvetica-Oblique').fontSize(7).fillColor(MUTED).text(r.note, col.desc, doc.y + 1, { width: DW });
    y = y + h + 6;
    doc.moveTo(L, y - 3).lineTo(R, y - 3).lineWidth(0.4).strokeColor(LINE).stroke();
  });
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.8).strokeColor(INK).stroke();

  // totals: prices include VAT, show the split like the paper offer
  const gross = price.total, net = gross / (1 + model.vatRate);
  if (y > doc.page.height - 200) { doc.addPage(); letterhead(); y = 100; }
  y += 16;
  const total = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 9).fillColor(INK);
    doc.text(label, R - 290, y, { width: 190, align: 'right', lineBreak: false });
    doc.text(value, R - 95, y, { width: 95, align: 'right', lineBreak: false });
    y += bold ? 17 : 13;
  };
  total('Total amount incl. VAT', `${money(gross)} CHF`, true);
  total(`included ${vatPct} VAT`, `${money(gross - net)} CHF`);
  total('Total excl. VAT', `${money(net)} CHF`);
  if (price.onRequest) {
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED).text('Positions "on request" are not included in the total; HolzSauna confirms their price.', R - 290, y + 2, { width: 290, align: 'right' });
    y = doc.y;
  }

  // delivery notes + sign-off
  y += 14;
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text([
    'Made to measure in our own workshop in Switzerland. Final dimensions are confirmed before production.',
    `Prices in CHF incl. ${vatPct} VAT, plus delivery and installation. Room dimensions without plaster or wall covering.`,
    `This quotation is valid until ${date(validUntil)}.`,
  ].join('\n'), L + 6, y, { width: CW - 6, lineGap: 2 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Your design online: ', L + 6, doc.y + 6, { continued: true })
    .fillColor(ACCENT).text(meta.url, { link: meta.url, underline: false });
  y = doc.y + 20;
  if (y > doc.page.height - 84) { doc.addPage(); letterhead(); y = 110; }
  doc.font('Helvetica').fontSize(10).fillColor(INK).text('Kind regards', L + CW * 0.62, y, { lineBreak: false })
    .text(COMPANY.legal, L + CW * 0.62, y + 13, { width: R - L - CW * 0.62 });

  // ── page 2: product page ────────────────────────────────────────────────────
  doc.addPage();
  letterhead();
  doc.font('Helvetica').fontSize(11).fillColor(INK).text(model.fullName, L, 108, { width: CW });
  y = doc.y + 12;
  const photo = 330;
  try { doc.image(PHOTO, L, y, { fit: [CW, photo], align: 'center' }); y += photo + 18; } catch { y += 6; }
  const spec: [string, string][] = [
    ['Construction', `${c.wallMm} mm solid Austrian Zirbe (stone pine), walls and ceiling; exterior clad in natural slate panels.`],
    ['Size', `${size} (width × depth × height, outside). Height ${heightCm} cm is standard.`],
    ['Door', `Frameless ${c.glassMm} mm clear safety glass door, approx. ${c.door.widthMm / 10} × ${c.door.heightMm / 10} cm, without threshold; handle wood inside, stainless steel outside.`],
    ['Glass front', `Floor-to-ceiling ${c.glassMm} mm clear glass with aluminium profile at the floor.`],
    ['Interior', `Benches in ${(wood?.name ?? '').replace(/, knot-free$/, '')}: knot-free, resin-free and pleasant to the touch. Upper L-bench (${(layout.benches.long.depth * 100).toFixed(1)} and ${(layout.benches.short.depth * 100).toFixed(0)} cm deep), movable lower bench on feet, 2 slightly rounded backrests.`],
    ['Heater and control', set && set.id !== 'none' ? setTitle(set.name) : 'Without heater and control'],
  ];
  for (const [k, v] of spec) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(`${k}: `, L, y, { continued: true }).font('Helvetica').text(v, { width: CW, lineGap: 1.5 });
    y = doc.y + 9;
  }

  // ── page 3: plan sketch ─────────────────────────────────────────────────────
  doc.addPage();
  letterhead();
  doc.font('Helvetica').fontSize(11).fillColor(INK)
    .text(`${model.fullName} - ${c.wallMm} mm solid wood with glass front`, L, 108, { width: CW })
    .text(size.replace(/ /g, ''), { width: CW });
  y = doc.y + 30;
  const planH = doc.page.height - 110 - y;
  doc.rect(L, y, CW, planH).fill('#fbfbfa');
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#b9b5ae').text('PLAN SKETCH', R - 90, y + 12, { width: 80, align: 'right', characterSpacing: 0.6, lineBreak: false });
  SVGtoPDF(doc, floorPlanSvg(layout, { heater: !!set?.heater, control: !!set?.control }), L + 16, y + 26, { width: CW - 32, height: planH - 42, preserveAspectRatio: 'xMidYMid meet' });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Plan view, dimensions in mm (outside). Room dimensions without plaster or wall covering. Door hinge side as configured.', L, y + planH + 8, { width: CW });

  // ── footer on every page: VAT number, like the paper offer ─────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // write inside the margin without triggering a new page
    const fy = doc.page.height - 36;
    doc.font('Helvetica').fontSize(7.5).fillColor(INK)
      .text(`VAT no.: ${COMPANY.vat}`, L, fy, { width: CW, align: 'center', lineBreak: false });
    doc.fillColor(MUTED).text(`${quoteNo} · Page ${i - range.start + 1} of ${range.count}`, L, fy, { width: CW, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}
