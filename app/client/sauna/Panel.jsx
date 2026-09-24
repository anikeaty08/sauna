import { useState } from 'react';
import { Check, Plus, X, Flame, Gauge, Lightbulb, PackagePlus, DoorOpen, Ruler, Layers, Trash2, Home, Zap, Info, Ruler as RulerIcon } from 'lucide-react';
import { chf, chfDelta } from './format';
import { nameOf, woodHex, heaterSpecLine, fitsVolume, controlSpecLine, shortFamily } from './options';
import { widthOptions, depthOptions, familyType } from './config';

const TYPE_LABEL = {
  en: { cabin: 'Indoor', hex: 'Hexagon', round: 'Round', barrel: 'Barrel', house: 'Garden house', infrared: 'Infrared' },
  de: { cabin: 'Innen', hex: 'Sechseck', round: 'Rund', barrel: 'Fass', house: 'Gartenhaus', infrared: 'Infrarot' },
  fr: { cabin: 'Intérieur', hex: 'Hexagone', round: 'Rond', barrel: 'Tonneau', house: 'Maison de jardin', infrared: 'Infrarouge' },
  it: { cabin: 'Interno', hex: 'Esagono', round: 'Rotonda', barrel: 'Botte', house: 'Casetta da giardino', infrared: 'Infrarossi' },
};

/* ── Swatch (selectable option button) ── */
function Swatch({ selected, title, subtitle, price, color, onClick, disabled, flag, lang = 'en' }) {
  const isDe = lang === 'de';
  return (
    <button
      type="button"
      className={`opt-swatch${selected ? ' is-selected' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
    >
      {color && <span className="opt-swatch-color" style={{ background: color }} />}
      <span className="opt-swatch-text">
        <b>{title}</b>
        {subtitle && <small>{subtitle}</small>}
        {flag && <small className="opt-flag">{flag}</small>}
      </span>
      <span className="opt-swatch-price">{price === 0 ? (isDe ? 'inbegriffen' : 'included') : chfDelta(price)}</span>
      {selected && <Check className="opt-swatch-check" />}
    </button>
  );
}

/* ── Toggle row (checkbox-style) ── */
function ListRow({ checked, title, subtitle, price, onToggle, onRemove, lang = 'en' }) {
  const isDe = lang === 'de';
  return (
    <label className={`opt-row${checked ? ' is-checked' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="opt-row-box" aria-hidden="true">
        {checked ? <Check /> : <Plus />}
      </span>
      <span className="opt-row-text">
        <b>{title}</b>
        {subtitle && <small>{subtitle}</small>}
      </span>
      <span className="opt-row-price">{price ? chf(price) : (isDe ? 'auf Anfrage' : 'on request')}</span>
      {checked && onRemove && (
        <button
          type="button"
          className="opt-row-remove"
          onClick={e => { e.preventDefault(); onRemove(); }}
          aria-label={isDe ? `${title} entfernen` : `Remove ${title}`}
        >
          <Trash2 />
        </button>
      )}
    </label>
  );
}

/* ── Step slider ── */
function StepSlider({ label, value, onChange, min, max, step = 1, unit = 'cm' }) {
  return (
    <label className="stepper">
      <span>{label}<b>{value}{unit ? ` ${unit}` : ''}</b></span>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/* ── Section accordion ── */
export function Section({ id, title, icon: Icon, open, children }) {
  return (
    <details className="panel-section" id={`section-${id}`} open={open}>
      <summary><Icon /><span>{title}</span></summary>
      <div className="panel-section-body">{children}</div>
    </details>
  );
}

/* ── Lookup maps ── */
const ENTRY_SHORT = {
  en: {
    front:           'Front entry',
    corner:          'Corner entry',
    glasfront:       'Glass front',
    corner_glasfront:'Corner + glass',
    glass_corner:    'Glass corner',
  },
  de: {
    front:           'Fronteinstieg',
    corner:          'Eckeinstieg',
    glasfront:       'Glasfront',
    corner_glasfront:'Eck-Glasfront',
    glass_corner:    'Ganzglaseck',
  },
  fr: {
    front:           'Entrée frontale',
    corner:          "Entrée d'angle",
    glasfront:       'Façade vitrée',
    corner_glasfront:'Angle + vitrage',
    glass_corner:    'Angle tout vitré',
  },
  it: {
    front:           'Ingresso frontale',
    corner:          "Ingresso d'angolo",
    glasfront:       'Fronte vetrato',
    corner_glasfront:'Angolo + vetro',
    glass_corner:    'Angolo tutto vetro',
  }
};

const CLADDING_SHORT = {
  en: {
    none:    'Natural wood',
    schiefer:'Slate tiles',
    altholz: 'Reclaimed spruce',
  },
  de: {
    none:    'Naturholz',
    schiefer:'Schieferplatten',
    altholz: 'Altholz-Fichte',
  },
  fr: {
    none:    'Bois naturel',
    schiefer:"Plaques d'ardoise",
    altholz: 'Épicéa vieilli',
  },
  it: {
    none:    'Legno naturale',
    schiefer:"Lastre d'ardesia",
    altholz: 'Abete anticato',
  }
};

/* ── Sub-lists used in both the panel and the drawer ── */
function HeaterList({ catalog, cfg, family, volumeM3, onSetHeater, lang = 'en' }) {
  const isDe = lang === 'de';
  // Wood-fired stoves need outdoor clearance and a chimney - only offer them
  // for outdoor product types, so every listed heater is actually selectable.
  const entries = Object.entries(catalog.heaters).filter(([, spec]) => !spec.outdoor_only || family?.outdoor);
  return (
    <div className="opt-list">
      {entries.map(([key, spec]) => (
        <Swatch
          key={key}
          selected={cfg.heater.sku === key}
          title={nameOf(spec, lang).split(', incl.')[0].split(', inkl.')[0]}
          subtitle={heaterSpecLine(spec, lang)}
          flag={fitsVolume(spec, volumeM3) ? '' : (isDe ? 'nicht ausgelegt für dieses Volumen' : 'not rated for this cabin size')}
          price={spec.price}
          lang={lang}
          onClick={() => onSetHeater({ sku: key })}
        />
      ))}
    </div>
  );
}

function ControlList({ catalog, cfg, onSetCfg, lang = 'en' }) {
  const isDe = lang === 'de';
  return (
    <div className="opt-list">
      <Swatch
        selected={cfg.control === 'none'}
        title={isDe ? 'Kein separates Steuergerät' : 'No separate control unit'}
        subtitle={isDe ? 'Für Öfen mit integrierten Drehreglern' : 'For heaters with built-in controls'}
        price={0}
        lang={lang}
        onClick={() => onSetCfg({ control: 'none' })}
      />
      {Object.entries(catalog.controls).filter(([k]) => k !== 'none').map(([key, spec]) => (
        <Swatch
          key={key}
          selected={cfg.control === key}
          title={nameOf(spec, lang).replace('HUUM UKU 4.2 control, ', 'HUUM UKU 4.2 · ').replace('HUUM UKU 4.2 Steuerung, ', 'HUUM UKU 4.2 · ')}
          subtitle={controlSpecLine(spec, lang)}
          price={spec.price}
          lang={lang}
          onClick={() => onSetCfg({ control: key })}
        />
      ))}
    </div>
  );
}

function InteriorList({ catalog, cfg, family, onSetInterior, lang = 'en' }) {
  return (
    <div className="opt-grid">
      {family.interior_options.map(key => {
        const spec = catalog.interiors[key];
        return (
          <Swatch
            key={key}
            selected={cfg.interior.material === key}
            title={nameOf(spec, lang)}
            price={spec.price}
            color={woodHex(catalog, spec.wood)}
            lang={lang}
            onClick={() => onSetInterior({ material: key })}
          />
        );
      })}
    </div>
  );
}

function ToggleList({ entries, selected, listKey, onToggleList, lang = 'en' }) {
  return (
    <div className="opt-list">
      {entries.map(([key, spec]) => (
        <ListRow
          key={key}
          checked={selected.includes(key)}
          title={nameOf(spec, lang)}
          price={spec.price}
          lang={lang}
          onToggle={() => onToggleList(listKey, key)}
          onRemove={() => onToggleList(listKey, key)}
        />
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════ */
/* ConfiguratorPanel — always-visible accordion on the right                  */
/* ════════════════════════════════════════════════════════════════════════════ */
export function ConfiguratorPanel({
  catalog, cfg, openId, volumeM3,
  onSetCfg, onSetInterior, onSetDoor, onSetHeater, onSetBundle, onToggleList, warnings, notes, fit,
  lang = 'en'
}) {
  const isDe = lang === 'de';
  const family = catalog.families[cfg.family];
  const type = familyType(family);
  const entriesMap = ENTRY_SHORT[lang] || ENTRY_SHORT.en;
  const claddingMap = CLADDING_SHORT[lang] || CLADDING_SHORT.en;
  const typeLabels = TYPE_LABEL[lang] || TYPE_LABEL.en;
  const [typeFilter, setTypeFilter] = useState('all');
  const familyEntries = Object.entries(catalog.families).filter(([, f]) => typeFilter === 'all' || familyType(f) === typeFilter);
  const availableTypes = [...new Set(Object.values(catalog.families).map(familyType))];

  return (
    <div className="panel-sections">

      {/* ── Cabin & size ── */}
      <Section id="cabin" title={isDe ? 'Kabine & Masse' : 'Cabin & size'} icon={Ruler} open={openId === 'cabin' || !openId}>
        <p className="panel-label">{isDe ? 'Produktart' : 'Product type'}</p>
        <div className="type-filter" role="group">
          <button type="button" className={typeFilter === 'all' ? 'is-active' : ''} onClick={() => setTypeFilter('all')}>{isDe ? 'Alle' : 'All'}</button>
          {availableTypes.map(k => (
            <button key={k} type="button" className={typeFilter === k ? 'is-active' : ''} onClick={() => setTypeFilter(k)}>{typeLabels[k] || k}</button>
          ))}
        </div>
        <p className="panel-label">{isDe ? 'Holz & Konstruktion' : 'Wood & construction'}</p>
        <div className="opt-grid">
          {familyEntries.map(([key, f]) => (
            <Swatch
              key={key}
              selected={cfg.family === key}
              title={shortFamily(f, lang)}
              subtitle={`${isDe ? 'ab' : 'from'} ${chf(f.base_price || f.sizes?.[0]?.aktion || 0)}`}
              color={woodHex(catalog, f.wall_wood)}
              price={0}
              lang={lang}
              onClick={() => onSetCfg({ family: key })}
            />
          ))}
        </div>

        {(family.wood_options_outside || family.wood_options_inside) && (
          <>
            {family.wood_options_outside && (
              <>
                <p className="panel-label">{isDe ? 'Paneele aussen (2 Sichtseiten)' : 'Panel wood outside (2 visible sides)'}</p>
                <div className="opt-grid opt-grid-3">
                  {family.wood_options_outside.map(k => (
                    <Swatch key={k} selected={(cfg.woodOutside || family.wood_options_outside[0]) === k} title={nameOf(catalog.woods[k], lang)} price={0} flag={catalog.woods[k]?.on_request ? (isDe ? 'auf Anfrage' : 'on request') : ''} color={woodHex(catalog, k)} lang={lang} onClick={() => onSetCfg({ woodOutside: k })} />
                  ))}
                </div>
              </>
            )}
            {family.wood_options_inside && (
              <>
                <p className="panel-label">{isDe ? 'Paneele innen' : 'Panel wood inside'}</p>
                <div className="opt-grid opt-grid-3">
                  {family.wood_options_inside.map(k => (
                    <Swatch key={k} selected={(cfg.woodInside || family.wood_options_inside[0]) === k} title={nameOf(catalog.woods[k], lang)} price={0} flag={catalog.woods[k]?.on_request ? (isDe ? 'auf Anfrage' : 'on request') : ''} color={woodHex(catalog, k)} lang={lang} onClick={() => onSetCfg({ woodInside: k })} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <p className="panel-label">{isDe ? 'Masse' : 'Dimensions'}</p>
        <div className="dims-row">
          <label>
            {isDe ? 'Breite' : 'Width'}
            <select value={cfg.widthCm} onChange={e => onSetCfg({ widthCm: Number(e.target.value) })}>
              {widthOptions(family).map(w => <option key={w} value={w}>{w} cm</option>)}
            </select>
          </label>
          <label>
            {isDe ? 'Tiefe' : 'Depth'}
            <select value={cfg.depthCm} onChange={e => onSetCfg({ depthCm: Number(e.target.value) })}>
              {depthOptions(family).map(d => <option key={d} value={d}>{d} cm</option>)}
            </select>
          </label>
        </div>
        <StepSlider label={isDe ? 'Höhe' : 'Height'} value={cfg.heightCm} onChange={v => onSetCfg({ heightCm: v })} min={190} max={220} step={2} />
        <p className="dims-note">
          {isDe
            ? `Innenvolumen ca. ${volumeM3} m³ · Schalung ${cfg.boardOrientation === 'vertical' ? 'vertikal' : 'horizontal'}`
            : `Interior volume approx. ${volumeM3} m³ · boards ${cfg.boardOrientation}`}
        </p>

        <div className="opt-grid opt-grid-2">
          <Swatch selected={cfg.boardOrientation === 'horizontal'} title={isDe ? 'Horizontale Schalung' : 'Horizontal boards'} price={0} lang={lang} onClick={() => onSetCfg({ boardOrientation: 'horizontal' })} />
          <Swatch selected={cfg.boardOrientation === 'vertical'} title={isDe ? 'Vertikale Schalung' : 'Vertical boards'} price={0} lang={lang} onClick={() => onSetCfg({ boardOrientation: 'vertical' })} />
        </div>

        <p className="panel-label">{isDe ? 'Einstieg & Verglasung' : 'Entry & glazing'}</p>
        <div className="opt-grid opt-grid-3">
          {family.entries.map(key => (
            <Swatch
              key={key}
              selected={cfg.entry === key}
              title={entriesMap[key] || key}
              price={(family.entry_prices || {})[key] || 0}
              lang={lang}
              onClick={() => onSetCfg({ entry: key })}
            />
          ))}
        </div>

        <p className="panel-label">{isDe ? 'Aussenverkleidung' : 'Exterior finish'}</p>
        <div className="opt-grid opt-grid-3">
          {Object.entries(catalog.claddings).map(([key, c]) => (
            <Swatch
              key={key}
              selected={(cfg.cladding || 'none') === key}
              title={claddingMap[key] || key}
              price={c.price}
              color={
                key === 'schiefer' ? '#2b2e31'
                : key === 'altholz' ? woodHex(catalog, 'altholz')
                : woodHex(catalog, family.wall_wood)
              }
              lang={lang}
              onClick={() => onSetCfg({ cladding: key })}
            />
          ))}
        </div>

        {family.insulation_options && (
          <>
            <p className="panel-label">{isDe ? 'Dämmung' : 'Insulation'}</p>
            <div className="switch-grid">
              <label className="mini-switch"><input type="checkbox" checked={!!cfg.insulation?.roof} onChange={e => onSetCfg({ insulation: { ...cfg.insulation, roof: e.target.checked } })} />{isDe ? `Dach (+${chf(catalog.insulation.roof.price)})` : `Roof (+${chf(catalog.insulation.roof.price)})`}</label>
              <label className="mini-switch"><input type="checkbox" checked={!!cfg.insulation?.floor} onChange={e => onSetCfg({ insulation: { ...cfg.insulation, floor: e.target.checked } })} />{isDe ? `Boden (+${chf(catalog.insulation.floor.price)})` : `Floor (+${chf(catalog.insulation.floor.price)})`}</label>
            </div>
          </>
        )}
        {family.roof_colours && (
          <>
            <p className="panel-label">{isDe ? 'Dacheindeckung' : 'Roof shingles'}</p>
            <div className="opt-grid opt-grid-2">
              {family.roof_colours.map(k => (
                <Swatch key={k} selected={cfg.roofColour === k} title={nameOf(catalog.roof_colours[k], lang)} price={0} color={k === 'black' ? '#20221f' : '#7a2a20'} lang={lang} onClick={() => onSetCfg({ roofColour: k })} />
              ))}
            </div>
          </>
        )}
      </Section>

      {/* ── Door & window ── */}
      <Section id="door" title={isDe ? 'Tür & Fenster' : 'Door & window'} icon={DoorOpen} open={openId === 'door'}>
        <p className="panel-label">{isDe ? 'Türanschlag (von aussen gesehen)' : 'Hinge side (seen from outside)'}</p>
        <div className="opt-grid opt-grid-2">
          <Swatch selected={cfg.door.hinge === 'left'}  title={isDe ? 'Linksanschlag' : 'Hinged left'}  price={0} lang={lang} onClick={() => onSetDoor({ hinge: 'left' })} />
          <Swatch selected={cfg.door.hinge === 'right'} title={isDe ? 'Rechtsanschlag' : 'Hinged right'} price={0} lang={lang} onClick={() => onSetDoor({ hinge: 'right' })} />
        </div>

        {['corner', 'corner_glasfront', 'glass_corner'].includes(cfg.entry) ? (
          <>
            <p className="panel-label">{isDe ? 'Eckposition' : 'Which corner'}</p>
            <div className="opt-grid opt-grid-2">
              <Swatch selected={cfg.door.corner === 'left'}  title={isDe ? 'Ecke vorne links' : 'Front-left corner'}  price={0} lang={lang} onClick={() => onSetDoor({ corner: 'left' })} />
              <Swatch selected={cfg.door.corner === 'right'} title={isDe ? 'Ecke vorne rechts' : 'Front-right corner'} price={0} lang={lang} onClick={() => onSetDoor({ corner: 'right' })} />
            </div>
          </>
        ) : (
          // Only round.js/barrel.js's shells never read cfg.door.position - the
          // door sits at a fixed bearing (round) or centred on the end cap
          // (barrel), by design. Showing Left/Centre/Right there let people
          // click a control that visibly did nothing.
          family.type !== 'round' && family.type !== 'barrel' && (
            <>
              <p className="panel-label">{isDe ? 'Türposition' : 'Door position'}</p>
              <div className="opt-grid opt-grid-3">
                {[
                  ['left', isDe ? 'Links' : 'Left'],
                  ['centre', isDe ? 'Mitte' : 'Centre'],
                  ['right', isDe ? 'Rechts' : 'Right']
                ].map(([key, label]) => (
                  <Swatch key={key} selected={cfg.door.position === key} title={label} price={0} lang={lang} onClick={() => onSetDoor({ position: key })} />
                ))}
              </div>
            </>
          )
        )}

        {(family.window_types ? family.window_types.length > 1 : ['front', 'corner'].includes(cfg.entry)) && (
          <>
            <p className="panel-label">{isDe ? 'Fenster' : 'Window'}</p>
            <div className="opt-grid opt-grid-3">
              {(family.window_types || ['none', 'auto', '60']).map(key => {
                const wt = catalog.window_types?.[key];
                const label = wt ? nameOf(wt, lang) : (key === 'none' ? (isDe ? 'Kein Fenster' : 'No window') : key === 'auto' ? (isDe ? 'Raumhoch' : 'Full-height') : `${key} cm`);
                const price = wt?.price || (key !== 'none' && family.window_price ? family.window_price : 0);
                return <Swatch key={key} selected={String(cfg.window) === key} title={label} price={price} lang={lang} onClick={() => onSetCfg({ window: key })} />;
              })}
            </div>
          </>
        )}

        {(family.door_glass_options?.length > 1 || (catalog.door_glass && !family.door_glass_options)) && (
          <>
            <p className="panel-label">{isDe ? 'Glas / Türblatt' : 'Door glass'}</p>
            <div className="opt-grid opt-grid-3">
              {(family.door_glass_options || ['clear']).map(key => (
                <Swatch key={key} selected={cfg.door.glass === key} title={nameOf(catalog.door_glass[key], lang)} price={0} flag={catalog.door_glass[key]?.on_request ? (isDe ? 'auf Anfrage' : 'on request') : ''} lang={lang} onClick={() => onSetDoor({ glass: key })} />
              ))}
            </div>
          </>
        )}

        <p className="panel-label">{isDe ? 'Türgriff' : 'Door handle'}</p>
        <div className="opt-grid opt-grid-2">
          {Object.entries(catalog.handles).map(([key, h]) => (
            <Swatch key={key} selected={cfg.door.handle === key} title={nameOf(h, lang)} price={0} lang={lang} onClick={() => onSetDoor({ handle: key })} />
          ))}
        </div>
      </Section>

      {/* ── Benches & interior ── */}
      <Section id="interior" title={isDe ? 'Bänke & Innenraum' : 'Benches & interior'} icon={Layers} open={openId === 'interior'}>
        <p className="panel-label">{isDe ? 'Bankholz' : 'Bench wood'}</p>
        <InteriorList catalog={catalog} cfg={cfg} family={family} onSetInterior={onSetInterior} lang={lang} />

        <p className="panel-label">{isDe ? 'Bankanordnung' : 'Layout'}</p>
        <div className="opt-grid opt-grid-3">
          {[
            ['straight', isDe ? 'Gerade' : 'Straight'],
            ['L', isDe ? 'L-Form' : 'L-shape'],
            ['U', isDe ? 'U-Form' : 'U-shape']
          ].map(([key, label]) => (
            <Swatch key={key} selected={cfg.interior.layout === key} title={label} price={0} lang={lang} onClick={() => onSetInterior({ layout: key })} />
          ))}
        </div>

        <div className="dims-row">
          <StepSlider label={isDe ? 'Tiefe obere Bank' : 'Upper bench depth'} value={cfg.interior.upperDepthCm} onChange={v => onSetInterior({ upperDepthCm: v })} min={40} max={70} />
          <StepSlider label={isDe ? 'Tiefe untere Bank' : 'Lower bench depth'} value={cfg.interior.lowerDepthCm} onChange={v => onSetInterior({ lowerDepthCm: v })} min={25} max={50} />
        </div>
        <div className="dims-row">
          <StepSlider label={isDe ? 'Höhe obere Bank' : 'Upper bench height'} value={cfg.interior.upperHeightCm} onChange={v => onSetInterior({ upperHeightCm: v })} min={75} max={100} />
          <StepSlider label={isDe ? 'Höhe untere Bank' : 'Lower bench height'} value={cfg.interior.lowerHeightCm} onChange={v => onSetInterior({ lowerHeightCm: v })} min={35} max={55} />
        </div>

        <div className="switch-grid">
          {[
            ['backrests',     isDe ? 'Rückenlehnen' : 'Backrests'],
            ['sideBackrests', isDe ? 'Seitliche Rückenlehnen' : 'Side backrests'],
            ['apron',         isDe ? 'Zwischenbankverkleidung' : 'Under-bench cladding'],
            ['floorGrate',    isDe ? 'Bodenrost' : 'Floor grating'],
            ['slidingStool',  isDe ? 'Vorrückbank' : 'Sliding lower bench'],
          ].map(([key, label]) => (
            <label key={key} className="mini-switch">
              <input type="checkbox" checked={cfg.interior[key]} onChange={e => onSetInterior({ [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>

        <StepSlider
          label={isDe ? 'Kopfstützen' : 'Headrests'}
          value={cfg.interior.headrests}
          onChange={v => onSetInterior({ headrests: v })}
          min={0} max={3} unit={isDe ? 'Stk' : ''}
        />
      </Section>

      {/* ── Heater ── */}
      {!family.no_heater && (
      <Section id="heater" title={isDe ? 'Saunaofen' : 'Heater'} icon={Flame} open={openId === 'heater'}>
        <p className="panel-label">{isDe ? 'Fertige Ofen-Sets (Ofen + Steuerung)' : 'Ready-made sets (heater + control)'}</p>
        <div className="opt-list">
          {Object.entries(catalog.bundles).filter(([, b]) => !b.outdoor || family.outdoor).map(([key, b]) => (
            <Swatch key={key} selected={cfg.bundle === key} title={nameOf(b, lang).replace('Set: ', '')} subtitle={`${b.kw} kW`} price={b.price} lang={lang} onClick={() => onSetBundle(key)} />
          ))}
        </div>
        <p className="panel-label">{isDe ? 'Oder einzeln wählen' : 'Or choose individually'}</p>
        <HeaterList catalog={catalog} cfg={cfg} family={family} volumeM3={volumeM3} onSetHeater={patch => { onSetCfg({ bundle: null }); onSetHeater(patch); }} lang={lang} />

        {catalog.heaters[cfg.heater.sku]?.wood_fired && (
          <>
            <p className="panel-label">{isDe ? 'Schornstein-Set (erforderlich)' : 'Chimney kit (required)'}</p>
            <div className="opt-list">
              {Object.entries(catalog.chimneys).map(([key, c]) => (
                <Swatch key={key} selected={cfg.chimney === key} title={nameOf(c, lang)} price={c.price} lang={lang} onClick={() => onSetCfg({ chimney: key })} />
              ))}
            </div>
          </>
        )}

        <p className="panel-label">{isDe ? 'Position' : 'Position'}</p>
        <div className="opt-grid opt-grid-2">
          {[
            ['front_right', isDe ? 'Vorne rechts' : 'Front right'],
            ['front_left',  isDe ? 'Vorne links' : 'Front left'],
            ['back_right',   isDe ? 'Hinten rechts' : 'Back right'],
            ['back_left',    isDe ? 'Hinten links' : 'Back left']
          ].map(([key, label]) => (
            <Swatch key={key} selected={cfg.heater.position === key} title={label} price={0} lang={lang} onClick={() => onSetHeater({ position: key })} />
          ))}
        </div>
        <label className="mini-switch">
          <input type="checkbox" checked={cfg.ventilation} onChange={e => onSetCfg({ ventilation: e.target.checked })} />
          {isDe ? 'Zu- & Abluftschieber' : 'Supply & exhaust vents'}
        </label>

        {catalog.infrared && Object.keys(catalog.infrared).length > 0 && (
          <>
            <p className="panel-label">{isDe ? 'Infrarot-Strahler (zusätzlich)' : 'Infrared emitter (in addition)'}</p>
            <div className="opt-list">
              <Swatch selected={!cfg.infrared} title={isDe ? 'Ohne Infrarot' : 'No infrared'} price={0} lang={lang} onClick={() => onSetCfg({ infrared: null })} />
              {Object.entries(catalog.infrared).map(([key, ir]) => (
                <Swatch key={key} selected={cfg.infrared === key} title={nameOf(ir, lang)} price={ir.price} lang={lang} onClick={() => onSetCfg({ infrared: key })} />
              ))}
            </div>
          </>
        )}
      </Section>
      )}

      {/* ── Control unit ── */}
      <Section id="control" title={isDe ? 'Steuergerät' : 'Control unit'} icon={Gauge} open={openId === 'control'}>
        <ControlList catalog={catalog} cfg={cfg} onSetCfg={onSetCfg} lang={lang} />
      </Section>

      {/* ── Lighting ── */}
      <Section id="lighting" title={isDe ? 'Beleuchtung' : 'Lighting'} icon={Lightbulb} open={openId === 'lighting'}>
        <ToggleList entries={Object.entries(catalog.lighting)} selected={cfg.lighting} listKey="lighting" onToggleList={onToggleList} lang={lang} />
      </Section>

      {/* ── Accessories & delivery ── */}
      <Section id="accessory" title={isDe ? 'Zubehör & Montage' : 'Accessories & delivery'} icon={PackagePlus} open={openId === 'accessory'}>
        <ToggleList entries={Object.entries(catalog.accessories)} selected={cfg.accessories} listKey="accessories" onToggleList={onToggleList} lang={lang} />
        <p className="panel-label">{isDe ? 'Montage & Lieferung' : 'Assembly & delivery'}</p>
        <ToggleList entries={Object.entries(catalog.services)} selected={cfg.services} listKey="services" onToggleList={onToggleList} lang={lang} />
      </Section>

      {/* ── Room fit ── */}
      <Section id="room" title={isDe ? 'Platz-Check' : 'Room fit check'} icon={RulerIcon} open={openId === 'room'}>
        <p className="panel-label">{isDe ? 'Verfügbarer Raum (cm)' : 'Available space (cm)'}</p>
        <div className="dims-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          {['widthCm', 'depthCm', 'heightCm'].map((k, i) => (
            <label key={k}>{[isDe ? 'Breite' : 'Width', isDe ? 'Tiefe' : 'Depth', isDe ? 'Höhe' : 'Height'][i]}
              <input type="number" min="0" className="room-input" value={cfg.room?.[k] || ''}
                placeholder="—"
                onChange={e => onSetCfg({ room: { widthCm: cfg.room?.widthCm || 0, depthCm: cfg.room?.depthCm || 0, heightCm: cfg.room?.heightCm || 0, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
        {fit && (
          <div className={`fit-result ${fit.ok ? 'is-ok' : 'is-bad'}`}>
            <Info size={14} />
            <span>{fit.text}</span>
          </div>
        )}
        {!fit && <p className="dims-note">{isDe ? 'Masse eingeben, um zu prüfen, ob die Sauna in Ihren Raum passt (inkl. Türschwenk).' : 'Enter your room size to check whether the sauna fits (door swing included).'}</p>}
      </Section>

      {/* ── Notes: electrical, ventilation, lead time, warranty ── */}
      {notes && notes.length > 0 && (
        <div className="panel-notes" style={{ margin: '0 24px 12px' }}>
          {notes.map((n, i) => (
            <p key={i} className={`panel-note panel-note-${n.kind}`}>
              {n.kind === 'electrical' ? <Zap size={12} /> : n.kind === 'lead_time' ? <Home size={12} /> : <Info size={12} />}
              {n.text}
            </p>
          ))}
        </div>
      )}

      {/* ── Warnings ── */}
      {warnings.length > 0 && (
        <div className="panel-warnings" style={{ margin: '0 24px 12px' }}>
          <b>{isDe ? 'Gut zu wissen' : 'Good to know'}</b>
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════ */
/* Labels & hints for the click-to-configure drawer                           */
/* ════════════════════════════════════════════════════════════════════════════ */
const CATEGORY_LABEL = {
  en: {
    cabin:    'Cabin',
    door:     'Door',
    interior: 'Benches & interior',
    heater:   'Heater',
    control:  'Control unit',
    lighting: 'Lighting',
    accessory:'Accessories',
  },
  de: {
    cabin:    'Kabine',
    door:     'Glastür',
    interior: 'Bänke & Innenraum',
    heater:   'Saunaofen',
    control:  'Steuergerät',
    lighting: 'Beleuchtung',
    accessory:'Zubehör',
  }
};

const CATEGORY_HINT = {
  en: {
    interior: 'Choose the bench wood. Layout and bench sizes are in the panel on the right.',
    heater:   'Pick a heater to swap it in. The total updates instantly.',
    control:  'Wall control units for heaters without built-in controls.',
    lighting: 'Tick to add a light, untick or use the bin to remove it.',
    accessory:'Tick to add, untick or use the bin to remove.',
    door:     'Choose which side the glass door is hinged on.',
    cabin:    'Size, wood and exterior finish are in "Cabin & size" in the panel on the right.',
  },
  de: {
    interior: 'Wählen Sie das Bankholz. Anordnung und Bankmasse finden Sie im rechten Bedienfeld.',
    heater:   'Klicken Sie auf einen Ofen zum Wechseln. Der Gesamtpreis aktualisiert sich sofort.',
    control:  'Wandsteuergeräte für Öfen ohne integrierte Bedienelemente.',
    lighting: 'Aktivieren zum Hinzufügen, Deaktivieren zum Entfernen.',
    accessory:'Auswählen zum Hinzufügen oder per Papierkorb entfernen.',
    door:     'Wählen Sie den Türanschlag der Ganzglastür.',
    cabin:    'Grösse, Holzart und Aussenverkleidung finden Sie rechts unter "Kabine & Masse".',
  }
};

/* ── ComponentDrawer — shown when clicking a part in the 3D model ── */
export function ComponentDrawer({ category, catalog, cfg, volumeM3, onClose, selectedName, lang = 'en', ...handlers }) {
  if (!category) return null;
  const isDe = lang === 'de';
  const family = catalog.families[cfg.family];
  const labels = CATEGORY_LABEL[lang] || CATEGORY_LABEL.en;
  const hints = CATEGORY_HINT[lang] || CATEGORY_HINT.en;
  let body = null;

  if (category === 'door') {
    body = (
      <div className="opt-grid opt-grid-2">
        <Swatch selected={cfg.door.hinge === 'left'}  title={isDe ? 'Linksanschlag' : 'Hinged left'}  price={0} lang={lang} onClick={() => handlers.onSetDoor({ hinge: 'left' })} />
        <Swatch selected={cfg.door.hinge === 'right'} title={isDe ? 'Rechtsanschlag' : 'Hinged right'} price={0} lang={lang} onClick={() => handlers.onSetDoor({ hinge: 'right' })} />
      </div>
    );
  } else if (category === 'interior') {
    body = <InteriorList catalog={catalog} cfg={cfg} family={family} onSetInterior={handlers.onSetInterior} lang={lang} />;
  } else if (category === 'heater') {
    body = <HeaterList catalog={catalog} cfg={cfg} family={family} volumeM3={volumeM3} onSetHeater={patch => { handlers.onSetCfg({ bundle: null }); handlers.onSetHeater(patch); }} lang={lang} />;
  } else if (category === 'control') {
    body = <ControlList catalog={catalog} cfg={cfg} onSetCfg={handlers.onSetCfg} lang={lang} />;
  } else if (category === 'lighting') {
    body = <ToggleList entries={Object.entries(catalog.lighting)} selected={cfg.lighting} listKey="lighting" onToggleList={handlers.onToggleList} lang={lang} />;
  } else if (category === 'accessory') {
    body = <ToggleList entries={Object.entries(catalog.accessories)} selected={cfg.accessories} listKey="accessories" onToggleList={handlers.onToggleList} lang={lang} />;
  }

  return (
    <div className="component-drawer" role="dialog" aria-label={`${labels[category] || category} options`}>
      <div className="component-drawer-head">
        <div>
          <h3>{labels[category] || category}</h3>
          {selectedName && <small>{selectedName}</small>}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={isDe ? 'Schliessen' : 'Close'}>
          <X />
        </button>
      </div>
      <p className="drawer-hint">{hints[category]}</p>
      <div className="component-drawer-body">{body}</div>
    </div>
  );
}
