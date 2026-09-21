import { ArrowRight, Sparkles, Download } from 'lucide-react';
import { chf } from './format';

const FEATURED = ['espoo-compact', 'fichte-fenster-l', 'designer-espe-schiefer'];
const COPY = {
  'espoo-compact': { name: 'Compact Espoo', blurb: 'Fits a bathroom or home gym. The most affordable way into your own sauna.' },
  'fichte-fenster-l': { name: 'Spruce with window', blurb: 'Our most popular format: light Nordic spruce, a full-height window and L-shaped benches.' },
  'designer-espe-schiefer': { name: 'Designer glass corner', blurb: 'Glass corner with slate cladding, RGB mood lighting and audio — for a premium wellness space.' },
  'espe-front-vertical': { name: 'Aspen, vertical boards' },
  'fichte-glasfront': { name: 'Spruce glass front' },
  'zirbe-eck-glasfront': { name: 'Stone pine corner glass' },
};

export default function PresetPicker({ presets, totals, onPick, onStartBlank }) {
  const featured = FEATURED.map(id => presets.find(p => p.id === id)).filter(Boolean);
  const more = presets.filter(p => !FEATURED.includes(p.id));
  return (
    <div className="preset-picker">
      <div className="preset-picker-intro">
        <span className="collection-label"><Sparkles size={14} /> Sauna configurator</span>
        <h1>Design your own sauna</h1>
        <p>Start from one of our designs, then change anything — size, wood, heater, lighting and accessories. Every part shows its price, and the total updates as you go.</p>
      </div>
      <div className="preset-grid">
        {featured.map(preset => (
          <button key={preset.id} type="button" className="preset-card" onClick={() => onPick(preset)}>
            <span className="preset-card-image"><img src={`/images/presets/${preset.id}.png`} alt="" loading="lazy" /></span>
            <span className="preset-card-body">
              <b>{COPY[preset.id]?.name || preset.name}</b>
              <small>{COPY[preset.id]?.blurb || preset.tagline}</small>
              <span className="preset-card-price">from {chf(totals[preset.id] ?? 0)}<ArrowRight size={15} /></span>
            </span>
            <a className="preset-card-glb" href={`/models/presets/${preset.id}.glb`} download onClick={e => e.stopPropagation()} title="Download the original Blender 3D model (.glb)">
              <Download size={13} />.glb
            </a>
          </button>
        ))}
      </div>
      {more.length > 0 && (
        <div className="preset-more">
          <p>More starting points</p>
          <div className="preset-more-list">
            {more.map(preset => (
              <button key={preset.id} type="button" className="preset-chip" onClick={() => onPick(preset)}>
                {COPY[preset.id]?.name || preset.name}<span>from {chf(totals[preset.id] ?? 0)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <button type="button" className="text-button preset-blank" onClick={onStartBlank}>Or start with an empty cabin<ArrowRight size={14} /></button>
    </div>
  );
}
