import { ArrowRight, Sparkles, Download } from 'lucide-react';
import { chf } from './format';
import { getTranslation } from './i18n';

/* Featured preset order and copy */
const FEATURED = ['espoo-compact', 'fichte-fenster-l', 'designer-espe-schiefer'];

export default function PresetPicker({ presets, totals, onPick, onStartBlank, lang = 'en' }) {
  const t = getTranslation(lang);
  const isDe = lang === 'de';

  const copyMap = {
    'espoo-compact': {
      name: t.presetEspooName,
      blurb: t.presetEspooBlurb,
      badge: t.badgeMostAffordable,
    },
    'fichte-fenster-l': {
      name: t.presetSpruceWindowName,
      blurb: t.presetSpruceWindowBlurb,
      badge: t.badgeMostPopular,
    },
    'designer-espe-schiefer': {
      name: t.presetDesignerName,
      blurb: t.presetDesignerBlurb,
      badge: t.badgePremium,
    },
    'espe-front-vertical': { name: t.presetAspenVertical },
    'fichte-glasfront':    { name: t.presetSpruceGlassFront },
    'zirbe-eck-glasfront': { name: t.presetZirbeCornerGlass },
  };

  const featured = FEATURED.map(id => presets.find(p => p.id === id)).filter(Boolean);
  const more = presets.filter(p => !FEATURED.includes(p.id));

  return (
    <div className="preset-picker">
      {/* ── Intro ── */}
      <div className="preset-picker-intro">
        <span className="collection-label">
          <Sparkles size={12} />
          {t.saunaConfigurator}
        </span>
        <h1 style={{ whiteSpace: 'pre-line' }}>{t.designYourOwn}</h1>
        <p>{t.pickerBlurb}</p>
      </div>

      {/* ── Featured cards ── */}
      <div className="preset-grid">
        {featured.map((preset, i) => {
          const copy = copyMap[preset.id] || {};
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
                <small>{copy.blurb || (isDe ? preset.tagline_de || preset.tagline : preset.tagline)}</small>
                <span className="preset-card-price">
                  {t.from} {chf(totals[preset.id] ?? 0)}
                  <ArrowRight size={15} />
                </span>
              </span>

              {/* .glb download */}
              <a
                className="preset-card-glb"
                href={`/models/presets/${preset.id}.glb`}
                download
                onClick={e => e.stopPropagation()}
                title={isDe ? "Originales Blender 3D-Modell (.glb) herunterladen" : "Download the original Blender 3D model (.glb)"}
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
          <p>{t.moreConfigurations}</p>
          <div className="preset-more-list">
            {more.map(preset => (
              <button
                key={preset.id}
                type="button"
                className="preset-chip"
                onClick={() => onPick(preset)}
              >
                {copyMap[preset.id]?.name || (isDe ? preset.name_de || preset.name : preset.name)}
                <span>{t.from} {chf(totals[preset.id] ?? 0)}</span>
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
        {isDe ? 'Oder mit einer leeren Kabine starten' : 'Or start with an empty cabin'}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
