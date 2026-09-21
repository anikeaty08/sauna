import { ArrowRight, Sparkles, Download, Zap } from 'lucide-react';
import { chf } from './format';

/* Featured preset order and copy */
const FEATURED = ['espoo-compact', 'fichte-fenster-l', 'designer-espe-schiefer'];

const COPY = {
  'espoo-compact': {
    name: 'Compact Espoo',
    blurb: 'Fits a bathroom or home gym. The most affordable way into your own sauna.',
    badge: 'Most affordable',
  },
  'fichte-fenster-l': {
    name: 'Spruce with window',
    blurb: 'Our most popular format: light Nordic spruce, a full-height window and L-shaped benches.',
    badge: 'Most popular',
  },
  'designer-espe-schiefer': {
    name: 'Designer glass corner',
    blurb: 'Glass corner with slate cladding, RGB mood lighting and audio — for a premium wellness space.',
    badge: 'Premium',
  },
  'espe-front-vertical': { name: 'Aspen, vertical boards' },
  'fichte-glasfront':    { name: 'Spruce glass front' },
  'zirbe-eck-glasfront': { name: 'Stone pine corner glass' },
};

export default function PresetPicker({ presets, totals, onPick, onStartBlank }) {
  const featured = FEATURED.map(id => presets.find(p => p.id === id)).filter(Boolean);
  const more = presets.filter(p => !FEATURED.includes(p.id));

  return (
    <div className="preset-picker">
      {/* ── Intro ── */}
      <div className="preset-picker-intro">
        <span className="collection-label">
          <Sparkles size={12} />
          Sauna configurator
        </span>
        <h1>Design your<br />own sauna</h1>
        <p>
          Start from one of our designs, then change anything — size, wood,
          heater, lighting and accessories. Every part shows its price, and
          the total updates as you go.
        </p>
      </div>

      {/* ── Featured cards ── */}
      <div className="preset-grid">
        {featured.map((preset, i) => {
          const copy = COPY[preset.id] || {};
          return (
            <button
              key={preset.id}
              type="button"
              className="preset-card"
              onClick={() => onPick(preset)}
              style={{ animationDelay: `${i * 0.08}s` }}
            >
              {/* image */}
              <span className="preset-card-image">
                <img
                  src={`/images/presets/${preset.id}.png`}
                  alt={copy.name || preset.name}
                  loading="lazy"
                />
              </span>

              {/* badge */}
              {copy.badge && (
                <span style={{
                  position: 'absolute',
                  top: 12, left: 12,
                  background: 'rgba(45,74,56,0.92)',
                  color: '#fafbf7',
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '4px 9px',
                  borderRadius: 20,
                  backdropFilter: 'blur(6px)',
                  zIndex: 2,
                }}>
                  {copy.badge}
                </span>
              )}

              {/* body */}
              <span className="preset-card-body">
                <b>{copy.name || preset.name}</b>
                <small>{copy.blurb || preset.tagline}</small>
                <span className="preset-card-price">
                  from {chf(totals[preset.id] ?? 0)}
                  <ArrowRight size={15} />
                </span>
              </span>

              {/* .glb download */}
              <a
                className="preset-card-glb"
                href={`/models/presets/${preset.id}.glb`}
                download
                onClick={e => e.stopPropagation()}
                title="Download the original Blender 3D model (.glb)"
              >
                <Download size={11} />.glb
              </a>
            </button>
          );
        })}
      </div>

      {/* ── More starting points ── */}
      {more.length > 0 && (
        <div className="preset-more">
          <p>More starting points</p>
          <div className="preset-more-list">
            {more.map(preset => (
              <button
                key={preset.id}
                type="button"
                className="preset-chip"
                onClick={() => onPick(preset)}
              >
                {COPY[preset.id]?.name || preset.name}
                <span>from {chf(totals[preset.id] ?? 0)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Blank start ── */}
      <button
        type="button"
        className="text-button preset-blank"
        onClick={onStartBlank}
      >
        Or start with an empty cabin
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
