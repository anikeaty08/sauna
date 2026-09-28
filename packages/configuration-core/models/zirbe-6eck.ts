/**
 * Product definition for the Designsauna Zirbe Massivholz 6-Eck Glasfront mit
 * Schieferplatten (holzsauna.ch article 589). Every number here is either
 * sourced (see `sources`) or listed in `assumptions` - nothing is invented
 * silently. Browser and server both read this file, so prices and ranges can
 * never disagree between what the customer sees and what gets saved.
 */
import type { ModelDefinition } from '../types.ts';

const steps = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
};

export const zirbe6eck: ModelDefinition = {
  id: 'zirbe-6eck',
  version: '1.0.0',
  name: 'Designsauna Zirbe 6-Eck',
  fullName: 'Designsauna Zirbe Massivholz Swissmade 6-Eck, Glasfront, Schieferplatten',
  productUrl: 'https://www.holzsauna.ch/designsauna-zirbe-massivholz-swissmade-6-eck-glasfront-schieferplatten',
  currency: 'CHF',
  vatRate: 0.081,
  basePrice: 19990, // at 150 x 150 cm, incl. VAT

  dimensions: {
    widthCm: {
      options: steps(150, 250, 10),
      default: 230,
      surcharge: { 150: 0, 160: 127, 170: 296, 180: 435, 190: 574, 200: 712, 210: 872, 220: 1011, 230: 1181, 240: 1320, 250: 1459 },
    },
    depthCm: {
      options: steps(150, 250, 10),
      default: 250,
      surcharge: { 150: 0, 160: 96, 170: 235, 180: 343, 190: 452, 200: 560, 210: 690, 220: 798, 230: 938, 240: 1047, 250: 1156 },
    },
    heightMm: 2020,
  },

  construction: {
    wallMm: 40,
    ceilingMm: 40,
    glassMm: 8,
    slateMm: 12,
    fasciaMm: 120,
    door: { widthMm: 670, heightMm: 1875 },
    controlSegmentMm: 400,
    // Plan proportions of the published example drawing (outer 2300 x 3160 mm).
    plan: {
      solidBlockWidthRatio: 1170 / 2300,   // top wall / overall width
      rightGlassRatio: 1458 / 3160,        // glass run from the back corner / overall depth
      upperSideRatio: 1271 / 3160,         // control segment + glass return / overall depth (measured)
      cornerSeatLegLongRatio: 1085 / 3160, // movable lower bench (triangle), leg along the long bench (measured)
      cornerSeatLegShortRatio: 776 / 2300, // ... leg along the short bench (measured)
      heaterGapMm: 220,                    // heater stands this far in front of the short bench (measured)
    },
    benches: {
      longDepthMm: 975,
      shortDepthMm: 680,
      upperHeightMm: 820,  // measured from the product renders
      lowerHeightMm: 480,  // measured from the product renders
      lowerDepthMm: 420,
      slatMm: 28,
      backrestLengthsMm: [2970, 2210],
    },
  },

  options: {
    benchWood: [
      { id: 'espe', name: 'Aspen (Espe), knot-free', price: 0, default: true },
      { id: 'erle', name: 'Alder (Erle)', price: null, priceNote: 'Surcharge on request (holzsauna.ch: "Erle gegen Aufpreis erhältlich")' },
    ],
    // Exactly the five sets offered on holzsauna.ch (article 589).
    heaterSet: [
      { id: 'none', name: 'Without sauna heater, without sauna control', price: 0, heater: null, control: null },
      { id: 'harvia-virta-9', name: 'Set: Harvia Virta 9 kW, incl. 50 kg stones, HUUM UKU Glass WiFi control', price: 2425, heater: 'heater-harvia-virta', control: 'control-huum-uku-glass' },
      { id: 'harvia-virta-combi-9', name: 'Set: Harvia Virta Combi 9 kW, incl. 50 kg stones, HUUM UKU Glass WiFi control', price: 3115, heater: 'heater-harvia-virta-combi', control: 'control-huum-uku-glass' },
      { id: 'eos-mythos-s35', name: 'Set: EOS Mythos S35 black 9 kW, incl. Cubius stones black (20), EOS EmoStyle Hi control', price: null, priceNote: 'Shown as CHF 0.00 on holzsauna.ch - price to be confirmed by HolzSauna', heater: 'heater-eos-mythos', control: 'control-eos-emostyle', default: true },
      { id: 'eos-mythos-vapro-s35', name: 'Set: EOS Mythos Vapro S35 black 9 kW, incl. Cubius stones black (20), EOS EmoStyle Hi control', price: null, priceNote: 'Shown as CHF 0.00 on holzsauna.ch - price to be confirmed by HolzSauna', heater: 'heater-eos-mythos', control: 'control-eos-emostyle' },
    ],
    accessories: [
      { id: 'nova-set-4', name: 'Nova 4-piece sauna set (hourglass, climate station, 5 l black bucket, ladle)', price: 229, modules: ['nova-bucket-set', 'climate-station'] },
      { id: 'led-5m', name: 'Warm white LED strip 5 m set with transformer', price: 299, modules: ['led-strip'] },
    ],
    // The product has no windows and a single fixed door; the UI states this
    // instead of offering controls that would not correspond to a real option.
    windows: [],
    door: { configurable: false, description: 'Clear glass door without threshold, approx. 67 x 187.5 cm, hinged at the upper end of the diagonal glass front, opening outward; handle wood inside, stainless steel outside.' },
  },

  sources: [
    'holzsauna.ch article 589 product page (configurator: width/depth surcharges, heater sets, accessories; description: materials)',
    'HolzSauna example floor plan "Beispiel Saunagrundriss 6-Eck und Glasfront" (blender/zirbe_6eck/reference)',
    'HolzSauna product renders (exterior, interior, top view, detail)',
  ],
  assumptions: [
    'Wall 40 mm and glass 8 mm per the product page; the example drawing states 43 mm / 10 mm.',
    'Height is not published: 2020 mm, the HolzSauna made-to-measure standard, consistent with door 1875 mm + head profile + ceiling + slate fascia in the renders. Not adjustable.',
    'The example drawing (2300 x 3160 mm) is a custom size; its plan proportions are scaled to the chosen width/depth while real fixed sizes (door, 400 mm control segment, bench depths, wall) keep their size.',
    'Bench heights (820 / 480 mm) and the corner seat outline are measured from the renders and drawing.',
    'When the width is too small for the 97.5 cm long bench, its depth is reduced (flagged to the customer).',
  ],
};
