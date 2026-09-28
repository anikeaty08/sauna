/**
 * Studio: a second, separate configurator UI at /studio.
 *
 * Deliberately shares only the data layer (catalog, config normalisation,
 * pricing) and the 3D engine (SaunaScene) with the classic configurator at /.
 * Every piece of UI here is its own component with its own stylesheet, so the
 * two designs can evolve independently and be compared side by side.
 *
 * Layout follows a showroom pattern: a large product stage on the left with an
 * Exterior/Interior switch, and on the right a product card, a section stepper,
 * an icon rail and swatch groups, with the quote actions pinned at the bottom.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronDown, Home, Ruler, Palette, DoorOpen, Layers,
  Flame, Lightbulb, PackagePlus, Send, FileText, X, Check, Smartphone,
} from 'lucide-react';
import { useCatalog } from '../useCatalog';
import { fromPreset, normalizeConfig, widthOptions, depthOptions } from '../config';
import { priceItems } from '../pricing';
import { chf, chfDelta } from '../format';
import { nameOf, woodHex, shortFamily } from '../options';
import { openPrintableQuote } from '../printQuote';
import { createShareURL } from '../shareLink';
import QuoteModal from '../QuoteModal';
import './studio.css';

const LANG = 'en';
const START_PRESET = 'fichte-fenster-l';

/* Sections per tab. `view` is the camera each tab puts the 3D stage in. */
const TABS = {
  exterior: {
    label: 'Exterior',
    sections: [
      { id: 'model', label: 'Model', icon: Home },
      { id: 'size', label: 'Size', icon: Ruler },
      { id: 'finish', label: 'Exterior finish', icon: Palette },
      { id: 'entry', label: 'Entry & door', icon: DoorOpen },
    ],
  },
  interior: {
    label: 'Interior',
    sections: [
      { id: 'benches', label: 'Benches', icon: Layers },
      { id: 'heater', label: 'Heater', icon: Flame },
      { id: 'lighting', label: 'Lighting', icon: Lightbulb },
      { id: 'extras', label: 'Accessories', icon: PackagePlus },
    ],
  },
};
const ALL_SECTIONS = [...TABS.exterior.sections.map(s => ({ ...s, tab: 'exterior' })), ...TABS.interior.sections.map(s => ({ ...s, tab: 'interior' }))];

const ENTRY_LABEL = {
  front: 'Front entry', corner: 'Corner entry', glasfront: 'Glass front',
  corner_glasfront: 'Corner + glass', glass_corner: 'Glass corner',
};
const CLADDING_COLOR = { none: null, schiefer: '#2b2e31' };

/* ── Building blocks ─────────────────────────────────────────────────────── */

/** Round swatch with its label underneath - the core control of this design. */
function Dot({ selected, label, sub, color, icon: Icon, onClick, disabled }) {
  return (
    <button
      type="button"
      className={`st-dot${selected ? ' is-selected' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      title={sub ? `${label} · ${sub}` : label}
    >
      <span className="st-dot-disc" style={color ? { background: color } : undefined}>
        {!color && Icon && <Icon size={16} strokeWidth={1.6} />}
        {selected && <Check className="st-dot-tick" size={12} strokeWidth={3} />}
      </span>
      <span className="st-dot-label">{label}</span>
      {sub && <span className="st-dot-sub">{sub}</span>}
    </button>
  );
}

/** Rectangular chip for values that are words or numbers, not materials. */
function Chip({ selected, children, onClick, disabled }) {
  return (
    <button type="button" className={`st-chip${selected ? ' is-selected' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={selected}>
      {children}
    </button>
  );
}

/** Collapsible group with a heading and a chevron, as in the section list. */
function Group({ id, title, children, open, onToggle, refCb }) {
  return (
    <section className={`st-group${open ? ' is-open' : ''}`} ref={refCb} data-section={id}>
      <button type="button" className="st-group-head" onClick={onToggle} aria-expanded={open}>
        <span>{title}</span>
        <ChevronDown size={15} className="st-group-caret" />
      </button>
      {open && <div className="st-group-body">{children}</div>}
    </section>
  );
}

function priceSub(price) { return price ? chfDelta(price) : 'included'; }

/* ── "View in your room" handoff ─────────────────────────────────────────── */
function RoomModal({ cfg, total, onClose }) {
  const [state, setState] = useState({ busy: true, url: '', img: '' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { url } = await createShareURL(cfg, total);
      const QR = await import('qrcode');
      const img = await QR.toDataURL(url, { margin: 1, width: 360, color: { dark: '#1c1c1c', light: '#ffffff' } });
      if (!cancelled) setState({ busy: false, url, img });
    })().catch(() => { if (!cancelled) setState({ busy: false, url: '', img: '' }); });
    return () => { cancelled = true; };
  }, [cfg, total]);

  return (
    <div className="st-modal-backdrop" onClick={onClose}>
      <div className="st-modal" role="dialog" aria-label="View in your room" onClick={e => e.stopPropagation()}>
        <button type="button" className="st-modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <h2>View in your room</h2>
        <p>Scan with your phone to open this exact design there.</p>
        <div className="st-qr">
          {state.busy && <span className="st-qr-wait">Preparing link…</span>}
          {!state.busy && state.img && <img src={state.img} alt="QR code for this sauna design" />}
          {!state.busy && !state.img && <span className="st-qr-wait">The link could not be created. Try again.</span>}
        </div>
        {state.url && <a className="st-modal-link" href={state.url}>{state.url.replace(/^https?:\/\//, '')}</a>}
        <p className="st-modal-note"><Smartphone size={13} /> Placing it on your floor in augmented reality is being built next.</p>
      </div>
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────────────────── */
export default function Studio() {
  const { catalog, presets, loading, error } = useCatalog();
  const [cfg, setCfgRaw] = useState(null);
  const [tab, setTab] = useState('exterior');
  const [active, setActive] = useState('model');
  const [open, setOpen] = useState(() => new Set(ALL_SECTIONS.map(s => s.id)));
  const [showDims, setShowDims] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const groupRefs = useRef({});
  const listRef = useRef(null);

  // Starting design: ?preset=<id>, else the most popular one.
  useEffect(() => {
    if (!catalog || !presets || cfg) return;
    const want = new URLSearchParams(location.search).get('preset') || START_PRESET;
    const preset = presets.find(p => p.id === want) || presets[0];
    setCfgRaw(normalizeConfig(fromPreset(preset), catalog));
  }, [catalog, presets, cfg]);

  const set = patch => setCfgRaw(prev => {
    const next = { ...prev, ...patch };
    if (patch.family && patch.family !== prev.family) {
      const nf = catalog.families[patch.family];
      const size = nf.sizes ? nf.sizes.find(s => s.w === prev.widthCm && s.d === prev.depthCm) || nf.sizes[Math.min(2, nf.sizes.length - 1)] : null;
      next.heightCm = size?.h || nf.height_cm;
    }
    return normalizeConfig(next, catalog);
  });
  const setIn = (key, patch) => setCfgRaw(prev => normalizeConfig({ ...prev, [key]: { ...prev[key], ...patch } }, catalog));
  const toggle = (key, sku) => setCfgRaw(prev => {
    const list = prev[key].includes(sku) ? prev[key].filter(s => s !== sku) : [...prev[key], sku];
    return normalizeConfig({ ...prev, [key]: list }, catalog);
  });

  // 3D stage: same engine as the classic configurator, restyled backdrop.
  useEffect(() => {
    if (!hostRef.current || !catalog || !cfg || sceneRef.current) return;
    let cancelled = false, scene = null;
    Promise.all([import('../SaunaScene'), import('../geometry'), import('three')]).then(([{ SaunaScene }, { MaterialCache }, THREE]) => {
      if (cancelled || !hostRef.current) return;
      scene = new SaunaScene(hostRef.current, new MaterialCache(catalog));
      scene.scene.background = new THREE.Color('#f6f5f1');
      scene.scene.fog = new THREE.FogExp2(0xf6f5f1, 0.012);
      sceneRef.current = scene;
      scene.setConfig(cfg, catalog, LANG);
      scene.setView(tab);
    });
    return () => { cancelled = true; scene?.dispose(); sceneRef.current = null; };
    // Mount once per catalog; config changes flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, !!cfg]);

  useEffect(() => { if (sceneRef.current && cfg) sceneRef.current.setConfig(cfg, catalog, LANG); }, [cfg, catalog]);
  useEffect(() => { sceneRef.current?.setView(tab); }, [tab]);

  const pricing = useMemo(() => (cfg && catalog ? priceItems(cfg, catalog, LANG) : null), [cfg, catalog]);

  if (error) return <div className="st-loading">The configurator could not load its catalogue. Refresh to try again.</div>;
  if (loading || !cfg) return <div className="st-loading">Loading the studio…</div>;

  const family = catalog.families[cfg.family];
  const sections = TABS[tab].sections;
  const idx = ALL_SECTIONS.findIndex(s => s.id === active);

  const goTo = (id) => {
    const target = ALL_SECTIONS.find(s => s.id === id);
    if (!target) return;
    if (target.tab !== tab) setTab(target.tab);
    setActive(id);
    setOpen(o => new Set(o).add(id));
    requestAnimationFrame(() => {
      const el = groupRefs.current[id];
      if (el && listRef.current) listRef.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    });
  };
  const step = dir => goTo(ALL_SECTIONS[(idx + dir + ALL_SECTIONS.length) % ALL_SECTIONS.length].id);
  const flip = id => setOpen(o => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const switchTab = t => { setTab(t); setActive(TABS[t].sections[0].id); if (listRef.current) listRef.current.scrollTop = 0; };

  const heaters = Object.entries(catalog.heaters).filter(([, s]) => !s.outdoor_only || family.outdoor);
  const outsideWoods = family.wood_options_outside || [family.wall_wood];

  /* Section bodies, keyed by section id. */
  const body = {
    model: (
      <div className="st-dots">
        {Object.entries(catalog.families).map(([key, f]) => (
          <Dot key={key} selected={cfg.family === key} label={shortFamily(f, LANG).split(',')[0]} color={woodHex(catalog, f.wall_wood)} onClick={() => set({ family: key })} />
        ))}
      </div>
    ),
    size: (
      <>
        <p className="st-sub">Width</p>
        <div className="st-chips">
          {widthOptions(family).map(w => <Chip key={w} selected={cfg.widthCm === w} onClick={() => set({ widthCm: w })}>{w} cm</Chip>)}
        </div>
        <p className="st-sub">Depth</p>
        <div className="st-chips">
          {depthOptions(family).map(d => <Chip key={d} selected={cfg.depthCm === d} onClick={() => set({ depthCm: d })}>{d} cm</Chip>)}
        </div>
      </>
    ),
    finish: (
      <>
        <p className="st-sub">Wood</p>
        <div className="st-dots">
          {outsideWoods.map(k => (
            <Dot key={k} selected={(cfg.woodOutside || outsideWoods[0]) === k} label={nameOf(catalog.woods[k], LANG)} color={woodHex(catalog, k)} onClick={() => set({ woodOutside: k })} />
          ))}
        </div>
        <p className="st-sub">Cladding</p>
        <div className="st-dots">
          {Object.entries(catalog.claddings).map(([k, c]) => (
            <Dot key={k} selected={(cfg.cladding || 'none') === k} label={nameOf(c, LANG) || k} sub={priceSub(c.price)}
              color={CLADDING_COLOR[k] ?? (k === 'altholz' ? woodHex(catalog, 'altholz') : woodHex(catalog, family.wall_wood))}
              onClick={() => set({ cladding: k })} />
          ))}
        </div>
      </>
    ),
    entry: (
      <>
        <p className="st-sub">Entry</p>
        <div className="st-chips">
          {family.entries.map(k => <Chip key={k} selected={cfg.entry === k} onClick={() => set({ entry: k })}>{ENTRY_LABEL[k] || k}</Chip>)}
        </div>
        {family.door_glass_options && (
          <>
            <p className="st-sub">Door glass</p>
            <div className="st-dots">
              {family.door_glass_options.map(k => {
                const g = catalog.door_glass[k];
                const [r, gg, b] = g?.tint || [0.87, 0.93, 0.91];
                return <Dot key={k} selected={cfg.door.glass === k} label={nameOf(g, LANG)} color={`rgb(${r * 255},${gg * 255},${b * 255})`} onClick={() => setIn('door', { glass: k })} />;
              })}
            </div>
          </>
        )}
        <p className="st-sub">Hinge</p>
        <div className="st-chips">
          <Chip selected={cfg.door.hinge === 'left'} onClick={() => setIn('door', { hinge: 'left' })}>Left</Chip>
          <Chip selected={cfg.door.hinge === 'right'} onClick={() => setIn('door', { hinge: 'right' })}>Right</Chip>
        </div>
      </>
    ),
    benches: (
      <div className="st-dots">
        {family.interior_options.map(k => {
          const spec = catalog.interiors[k];
          return <Dot key={k} selected={cfg.interior.material === k} label={nameOf(spec, LANG).split(',')[0]} sub={priceSub(spec.price)} color={woodHex(catalog, spec.wood)} onClick={() => setIn('interior', { material: k })} />;
        })}
      </div>
    ),
    heater: (
      <div className="st-dots">
        {heaters.map(([k, s]) => (
          <Dot key={k} selected={cfg.heater.sku === k} label={nameOf(s, LANG).split(',')[0]} sub={`${s.kw ? `${s.kw} kW` : 'wood'} · ${priceSub(s.price)}`}
            color={s.color === 'black' ? '#1f2124' : '#a7aeb2'} onClick={() => setIn('heater', { sku: k })} />
        ))}
      </div>
    ),
    lighting: (
      <div className="st-dots">
        {Object.entries(catalog.lighting).map(([k, s]) => (
          <Dot key={k} selected={cfg.lighting.includes(k)} label={nameOf(s, LANG).split(',')[0].split('(')[0]} sub={priceSub(s.price)} icon={Lightbulb} onClick={() => toggle('lighting', k)} />
        ))}
      </div>
    ),
    extras: (
      <div className="st-dots">
        {Object.entries(catalog.accessories).map(([k, s]) => (
          <Dot key={k} selected={cfg.accessories.includes(k)} label={nameOf(s, LANG).split(',')[0].split('(')[0]} sub={priceSub(s.price)} icon={PackagePlus} onClick={() => toggle('accessories', k)} />
        ))}
      </div>
    ),
  };

  return (
    <div className="studio">
      {/* ── Stage ── */}
      <main className="st-stage">
        <header className="st-brand">
          <a href="/" aria-label="HolzSauna classic configurator"><img src="/assets/images/logo.gif" alt="HolzSauna" /></a>
          <span>3D configurator</span>
        </header>

        <div className="st-tabs" role="tablist" aria-label="View">
          {Object.entries(TABS).map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-active' : ''} onClick={() => switchTab(k)}>{t.label}</button>
          ))}
        </div>

        <div className="st-canvas" ref={hostRef} aria-label="3D sauna preview" />

        {showDims && pricing && (
          <div className="st-dims" role="status">
            <b>{cfg.widthCm} × {cfg.depthCm} × {cfg.heightCm} cm</b>
            <span>Width × depth × height</span>
            <span>{pricing.volumeM3} m³ volume · door {family.door_mm?.[0] / 10 || '—'} × {family.door_mm?.[1] / 10 || '—'} cm</span>
          </div>
        )}

        <div className="st-stage-actions">
          <button type="button" onClick={() => setRoomOpen(true)}>View in your room</button>
          <button type="button" className={showDims ? 'is-on' : ''} aria-pressed={showDims} onClick={() => setShowDims(v => !v)}>Measurements</button>
        </div>
      </main>

      {/* ── Options ── */}
      <aside className="st-panel" aria-label="Configure">
        <div className="st-card st-product">
          <h1>{shortFamily(family, LANG)}</h1>
          <p>{pricing ? chf(pricing.total) : ''} <small>incl. VAT</small></p>
        </div>

        <div className="st-card st-stepper">
          <button type="button" onClick={() => step(-1)} aria-label="Previous section"><ChevronLeft size={16} /></button>
          <span>{ALL_SECTIONS[idx]?.label}</span>
          <button type="button" onClick={() => step(1)} aria-label="Next section"><ChevronRight size={16} /></button>
        </div>

        <div className="st-body">
          <nav className="st-rail" aria-label="Sections">
            {sections.map(s => {
              const Icon = s.icon;
              return (
                <button key={s.id} type="button" className={active === s.id ? 'is-active' : ''} onClick={() => goTo(s.id)} aria-current={active === s.id}>
                  <Icon size={18} strokeWidth={1.6} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="st-card st-list" ref={listRef}>
            {sections.map(s => (
              <Group key={s.id} id={s.id} title={s.label} open={open.has(s.id)} onToggle={() => flip(s.id)} refCb={el => { groupRefs.current[s.id] = el; }}>
                {body[s.id]}
              </Group>
            ))}
          </div>
        </div>

        <div className="st-card st-actions">
          <button type="button" onClick={() => pricing && openPrintableQuote(cfg, catalog, pricing, LANG)}><FileText size={14} /> PDF quote</button>
          <button type="button" className="is-primary" onClick={() => setQuoteOpen(true)}><Send size={14} /> Request a quote</button>
        </div>
      </aside>

      {roomOpen && <RoomModal cfg={cfg} total={pricing?.total} onClose={() => setRoomOpen(false)} />}
      {quoteOpen && <QuoteModal cfg={cfg} pricing={pricing} familyName={shortFamily(family, LANG)} lang={LANG} onClose={() => setQuoteOpen(false)} />}
    </div>
  );
}
