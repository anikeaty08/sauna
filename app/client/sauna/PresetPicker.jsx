import { ArrowRight, Sparkles, Ruler } from 'lucide-react';
import { chf } from './format';
import { getTranslation } from './i18n';

/* Display order; the first three carry a badge. */
const ORDER = [
  'espoo-compact', 'fichte-fenster-l', 'designer-espe-schiefer',
  'espe-front-vertical', 'fichte-glasfront', 'zirbe-eck-glasfront',
];

export default function PresetPicker({ presets, totals, onPick, onStartBlank, lang = 'en' }) {
  const t = getTranslation(lang);
  const isDe = lang === 'de';

  const copyMap = {
    'espoo-compact': { name: t.presetEspooName, blurb: t.presetEspooBlurb, badge: t.badgeMostAffordable },
    'fichte-fenster-l': { name: t.presetSpruceWindowName, blurb: t.presetSpruceWindowBlurb, badge: t.badgeMostPopular },
    'designer-espe-schiefer': { name: t.presetDesignerName, blurb: t.presetDesignerBlurb, badge: t.badgePremium },
    'espe-front-vertical': { name: t.presetAspenVertical, blurb: t.presetAspenVerticalBlurb },
    'fichte-glasfront': { name: t.presetSpruceGlassFront, blurb: t.presetSpruceGlassFrontBlurb },
    'zirbe-eck-glasfront': { name: t.presetZirbeCornerGlass, blurb: t.presetZirbeCornerGlassBlurb },
  };

  const ordered = ORDER.map(id => presets.find(p => p.id === id)).filter(Boolean);

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

      {/* ── The full range: 6 starting designs plus a made-to-measure tile ── */}
      <div className="preset-grid">
        {ordered.map((preset, i) => {
          const copy = copyMap[preset.id] || {};
          return (
            <button
              key={preset.id}
              type="button"
              className="preset-card"
              onClick={() => onPick(preset)}
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <span className="preset-card-image">
                <img
                  src={`/assets/images/presets/${preset.id}.png`}
                  alt={copy.name || preset.name}
                  loading="lazy"
                />
              </span>

              {copy.badge && <span className="preset-card-badge">{copy.badge}</span>}

              <span className="preset-card-body">
                <b>{copy.name || preset.name}</b>
                <small>{copy.blurb || (isDe ? preset.tagline_de || preset.tagline : preset.tagline)}</small>
                <span className="preset-card-price">
                  {t.from} {chf(totals[preset.id] ?? 0)}
                  <ArrowRight size={15} />
                </span>
              </span>
            </button>
          );
        })}

        {/* ── 7th tile: no fixed design, pick every dimension yourself ── */}
        <button type="button" className="preset-card preset-card-blank" onClick={onStartBlank}>
          <span className="preset-card-image preset-card-image-blank">
            <Ruler size={30} strokeWidth={1.4} />
          </span>
          <span className="preset-card-body">
            <b>{t.buildFromScratch}</b>
            <small>{t.cleanSlate}</small>
            <span className="preset-card-price">
              {t.startConfiguring}
              <ArrowRight size={15} />
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
