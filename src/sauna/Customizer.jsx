import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, DoorOpen, ChevronLeft, ChevronDown, Receipt } from 'lucide-react';
import { useCatalog } from './useCatalog';
import { SaunaScene } from './SaunaScene';
import { MaterialCache } from './geometry';
import { defaultConfig, fromPreset, normalizeConfig } from './config';
import { priceItems } from './pricing';
import { chf } from './format';
import PresetPicker from './PresetPicker';
import { ConfiguratorPanel, ComponentDrawer } from './Panel';
import './customizer.css';

/* ── Wordmark ── */
function Wordmark() {
  return (
    <a className="wordmark" href="#top" aria-label="Sauna Studio home">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      sauna<span className="wordmark-light">studio</span>
    </a>
  );
}

/* ── Hover tooltip ── */
function HoverTip({ info, x, y }) {
  if (!info) return null;
  const price = info.price
    ? chf(info.price)
    : (info.includedIn ? 'Included' : 'CHF 0.–');
  return (
    <div className="hover-tip" style={{ left: x + 16, top: y + 16 }}>
      <b>{info.name}</b>
      <span>{price}</span>
    </div>
  );
}

/* ── Loading screen ── */
function LoadingScreen() {
  return (
    <div className="customizer-loading">
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--sage)', display: 'inline-block',
        animation: 'breathe 1.2s ease-in-out infinite',
      }} />
      Loading configurator…
    </div>
  );
}

/* ── Main Customizer ── */
export default function Customizer() {
  const { catalog, presets, loading, error } = useCatalog();
  const [stage, setStage] = useState('pick');
  const [cfg, setCfgRaw] = useState(null);
  const [presetTotals, setPresetTotals] = useState({});
  const [view, setView] = useState('exterior');
  const [doorOpen, setDoorOpen] = useState(false);
  const [openSection, setOpenSection] = useState(null);
  const [drawerCategory, setDrawerCategory] = useState(null);
  const [drawerName, setDrawerName] = useState('');
  const [hover, setHover] = useState({ info: null, x: 0, y: 0 });
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const materialsRef = useRef(null);

  // Price every preset once for the picker screen's "from CHF …" tags
  useEffect(() => {
    if (!catalog || !presets) return;
    const totals = {};
    for (const preset of presets) totals[preset.id] = priceItems(fromPreset(preset), catalog).total;
    setPresetTotals(totals);
  }, [catalog, presets]);

  const setCfg = patch => setCfgRaw(prev => catalog ? normalizeConfig({ ...prev, ...patch }, catalog) : prev);
  const setInterior = patch => setCfgRaw(prev => catalog ? normalizeConfig({ ...prev, interior: { ...prev.interior, ...patch } }, catalog) : prev);
  const setDoor = patch => setCfgRaw(prev => catalog ? normalizeConfig({ ...prev, door: { ...prev.door, ...patch } }, catalog) : prev);
  const setHeater = patch => setCfgRaw(prev => catalog ? normalizeConfig({ ...prev, heater: { ...prev.heater, ...patch } }, catalog) : prev);
  const toggleList = (key, sku) => setCfgRaw(prev => {
    if (!catalog) return prev;
    const list = prev[key].includes(sku) ? prev[key].filter(s => s !== sku) : [...prev[key], sku];
    return normalizeConfig({ ...prev, [key]: list }, catalog);
  });

  // Mount the 3D scene once we enter the customizer
  useEffect(() => {
    if (stage !== 'customize' || !hostRef.current || !catalog) return;
    materialsRef.current = new MaterialCache(catalog);
    const scene = new SaunaScene(hostRef.current, materialsRef.current, {
      onHover: (info, x, y) => setHover({ info, x, y }),
      onSelect: (info) => {
        if (info) {
          setDrawerCategory(info.category);
          setDrawerName(info.name || '');
          setOpenSection(info.category);
        }
      },
    });
    sceneRef.current = scene;
    return () => { scene.dispose(); sceneRef.current = null; };
  }, [stage, catalog]);

  // Rebuild parametric model on config change
  useEffect(() => {
    if (!sceneRef.current || !cfg || !catalog) return;
    sceneRef.current.setConfig(cfg, catalog);
  }, [cfg, catalog]);

  useEffect(() => { sceneRef.current?.setView(view); }, [view]);
  useEffect(() => { sceneRef.current?.setDoorOpen(doorOpen); }, [doorOpen]);

  const pricing = useMemo(() => (cfg && catalog ? priceItems(cfg, catalog) : null), [cfg, catalog]);

  function pickPreset(preset) {
    setCfgRaw(normalizeConfig(fromPreset(preset), catalog));
    setStage('customize');
    setView('exterior');
    setDoorOpen(false);
  }
  function startBlank() {
    setCfgRaw(defaultConfig(catalog));
    setStage('customize');
  }

  if (loading) return <LoadingScreen />;
  if (error || !catalog) return (
    <div className="customizer-loading">
      Catalog could not be loaded.{' '}
      <button onClick={() => location.reload()} style={{ textDecoration: 'underline', color: 'var(--pine)' }}>
        Reload page
      </button>
    </div>
  );

  const family = cfg ? catalog.families[cfg.family] : null;
  const familyName = family
    ? (family.name_en || family.name_de || '').replace(', Swiss-made to measure', '')
    : '';

  return (
    <div className="customizer-app">
      {/* ── Header ── */}
      <header className="site-header">
        <Wordmark />
        {stage === 'customize' && (
          <button
            className="customizer-back"
            onClick={() => setStage('pick')}
          >
            <ChevronLeft size={14} />
            Choose a different preset
          </button>
        )}
      </header>

      {/* ── Preset picker ── */}
      {stage === 'pick' && (
        <PresetPicker
          presets={presets}
          totals={presetTotals}
          onPick={pickPreset}
          onStartBlank={startBlank}
        />
      )}

      {/* ── Configurator ── */}
      {stage === 'customize' && cfg && (
        <div className="customize-layout">

          {/* ── 3D Viewer ── */}
          <section className="viewer3d" aria-label="3D sauna preview">
            <div className="viewer3d-host" ref={hostRef} />
            <HoverTip info={hover.info} x={hover.x} y={hover.y} />

            {/* toolbar */}
            <div className="viewer3d-toolbar">
              <div className="view-switch-pill" role="group" aria-label="Camera view">
                <button
                  aria-pressed={view === 'exterior'}
                  onClick={() => setView('exterior')}
                >
                  <Box size={14} />Exterior
                </button>
                <button
                  aria-pressed={view === 'interior'}
                  onClick={() => setView('interior')}
                >
                  <DoorOpen size={14} />Interior
                </button>
              </div>

              <button
                className="viewer3d-door-btn"
                onClick={() => setDoorOpen(o => !o)}
                aria-pressed={doorOpen}
                title={doorOpen ? 'Close door' : 'Open door'}
              >
                <DoorOpen size={16} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.02em' }}>
                  {doorOpen ? 'Close' : 'Open'}
                </span>
              </button>
            </div>

            <p className="viewer3d-hint">
              Drag to orbit · Scroll to zoom · Click a part to configure it
            </p>

            {/* click-to-configure drawer */}
            <ComponentDrawer
              category={drawerCategory}
              catalog={catalog}
              cfg={cfg}
              volumeM3={pricing?.volumeM3}
              selectedName={drawerName}
              onClose={() => setDrawerCategory(null)}
              onSetCfg={setCfg}
              onSetInterior={setInterior}
              onSetDoor={setDoor}
              onSetHeater={setHeater}
              onToggleList={toggleList}
            />
          </section>

          {/* ── Right panel ── */}
          <aside className="customizer-panel" aria-label="Configure your sauna">
            {/* sticky heading */}
            <div className="panel-head">
              <span className="collection-label">Your configuration</span>
              <h2>{familyName}</h2>
              <p>
                {cfg.widthCm} × {cfg.depthCm} × {cfg.heightCm} cm
                {pricing ? ` · ${pricing.volumeM3} m³ volume` : ''}
              </p>
            </div>

            {/* accordion sections */}
            <ConfiguratorPanel
              catalog={catalog}
              cfg={cfg}
              openId={openSection}
              volumeM3={pricing?.volumeM3}
              warnings={pricing?.warnings || []}
              onSetCfg={setCfg}
              onSetInterior={setInterior}
              onSetDoor={setDoor}
              onSetHeater={setHeater}
              onToggleList={toggleList}
            />

            {/* sticky total bar */}
            <div className="total-bar">
              <details className="price-breakdown">
                <summary>
                  <Receipt size={14} />
                  Price breakdown
                  <ChevronDown size={13} />
                </summary>
                <ul>
                  {pricing?.items.filter(i => i.price > 0).map((item, i) => (
                    <li key={i}>
                      <span>{item.name}</span>
                      <span>{chf(item.price)}</span>
                    </li>
                  ))}
                </ul>
                <div className="price-breakdown-total">
                  <span>incl. 8.1% VAT</span>
                  <span>{chf(pricing?.total)}</span>
                </div>
              </details>

              <div className="grand-total">
                <div>
                  <span>Total price</span>
                  <p className="grand-total-note">Indicative · incl. VAT</p>
                </div>
                <b>{chf(pricing?.total)}</b>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
