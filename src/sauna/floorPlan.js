// A schematic top-down 2D floor plan (SVG), independent of the 3D geometry
// module: a simplified rectangle/chamfer outline with door swing, so it
// stays cheap to generate for the PDF export and the standalone download.
import { familyType } from './config';

export function buildFloorPlanSVG(cfg, catalog, lang = 'en') {
  const isDe = lang === 'de';
  const family = catalog.families[cfg.family];
  const type = familyType(family);
  const W = cfg.widthCm, D = cfg.depthCm;
  const pad = 60, scale = Math.min(560 / W, 420 / D);
  const w = W * scale, d = D * scale;
  const ox = pad, oy = pad;
  const chamfered = ['corner', 'corner_glasfront'].includes(cfg.entry);
  const c = chamfered ? Math.min(w, d) * 0.22 : 0;
  const corner = cfg.door.corner === 'left' ? 'left' : 'right';

  let outline;
  if (type === 'barrel') {
    outline = `<rect x="${ox}" y="${oy}" width="${w}" height="${d}" rx="${d / 2}" ry="${d / 2}" />`;
  } else if (chamfered) {
    const pts = corner === 'right'
      ? [[ox, oy], [ox, oy + d], [ox + w - c, oy + d], [ox + w, oy + d - c], [ox + w, oy]]
      : [[ox, oy], [ox, oy + d - c], [ox + c, oy + d], [ox + w, oy + d], [ox + w, oy]];
    outline = `<polygon points="${pts.map(p => p.join(',')).join(' ')}" />`;
  } else {
    outline = `<rect x="${ox}" y="${oy}" width="${w}" height="${d}" />`;
  }

  const doorW = (family.door_mm[0] / 10) * scale;
  const hinge = cfg.door.hinge === 'left' ? 1 : -1;
  const doorX = ox + w / 2 - doorW / 2;
  const doorY = oy + d;
  const hingeX = hinge === 1 ? doorX : doorX + doorW;
  const swingR = doorW;
  const swingSweep = hinge === 1
    ? `M ${hingeX} ${doorY} L ${hingeX + swingR} ${doorY} A ${swingR} ${swingR} 0 0 0 ${hingeX} ${doorY - swingR} Z`
    : `M ${hingeX} ${doorY} L ${hingeX - swingR} ${doorY} A ${swingR} ${swingR} 0 0 1 ${hingeX} ${doorY - swingR} Z`;

  const heaterSide = cfg.heater?.position?.includes('left') ? -1 : 1;
  const heaterSize = 26;
  const heaterX = heaterSide > 0 ? ox + w - heaterSize - 10 : ox + 10;
  const heaterY = oy + d - heaterSize - 10;

  const dimW = `<text x="${ox + w / 2}" y="${oy - 14}" text-anchor="middle" class="dim">${W} cm</text>
    <line x1="${ox}" y1="${oy - 22}" x2="${ox + w}" y2="${oy - 22}" class="dimline" marker-start="url(#tick)" marker-end="url(#tick)" />`;
  const dimD = `<text x="${ox - 34}" y="${oy + d / 2}" text-anchor="middle" class="dim" transform="rotate(-90 ${ox - 34} ${oy + d / 2})">${D} cm</text>
    <line x1="${ox - 22}" y1="${oy}" x2="${ox - 22}" y2="${oy + d}" class="dimline" marker-start="url(#tick)" marker-end="url(#tick)" />`;

  return `<svg viewBox="0 0 ${w + pad * 2} ${d + pad * 2}" xmlns="http://www.w3.org/2000/svg" font-family="Manrope, sans-serif">
  <defs><marker id="tick" markerWidth="8" markerHeight="8" refX="4" refY="4"><line x1="4" y1="0" x2="4" y2="8" stroke="#738075" stroke-width="1"/></marker></defs>
  <style>.wall{fill:#f5f3ec;stroke:#365443;stroke-width:2.5}.dim{font-size:11px;fill:#738075}.dimline{stroke:#b8c2b0;stroke-width:1}.swing{fill:#dce4d6;fill-opacity:.5;stroke:#8ea084;stroke-width:1;stroke-dasharray:3 3}.heater{fill:#25352b;opacity:.85}.label{font-size:10px;fill:#fafbf7;text-anchor:middle}</style>
  <g class="wall">${outline}</g>
  <path d="${swingSweep}" class="swing" />
  <rect x="${heaterX}" y="${heaterY}" width="${heaterSize}" height="${heaterSize}" class="heater" rx="2" />
  <text x="${heaterX + heaterSize / 2}" y="${heaterY + heaterSize / 2 + 3}" class="label">${isDe ? 'Ofen' : 'Heater'}</text>
  ${dimW}${dimD}
</svg>`;
}

export function downloadFloorPlan(cfg, catalog, lang = 'en', filename = 'floor-plan') {
  const svg = buildFloorPlanSVG(cfg, catalog, lang);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `${filename}.svg`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
