import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, DoorOpen, ChevronLeft, ChevronDown, Receipt, Download, FileText } from 'lucide-react';
import { useCatalog } from './useCatalog';
import { SaunaScene } from './SaunaScene';
import { MaterialCache } from './geometry';
import { defaultConfig, fromPreset, normalizeConfig } from './config';
import { priceItems } from './pricing';
import { chf } from './format';
import { downloadSpecification } from './exportSpec';
import { getTranslation } from './i18n';
import PresetPicker from './PresetPicker';
import { ConfiguratorPanel, ComponentDrawer } from './Panel';
import './customizer.css';

/* ── Wordmark ── */
function Wordmark({ homeAria }) {
  return (
    <a className="wordmark brand-link" href="#top" aria-label={homeAria || "HolzSauna"}>
      <img src="/images/logo.png" alt="HolzSauna" className="brand-logo" />
    </a>
  );
}

/* ── Hover tooltip ── */
function HoverTip({ info, x, y, lang = 'en' }) {
  if (!info) return null;
  const isDe = lang === 'de';
  const price = info.price
    ? chf(info.price)
    : (info.includedIn ? (isDe ? 'Inbegriffen' : 'Included') : 'CHF 0.–');
  return (
    <div className="hover-tip" style={{ left: x + 16, top: y + 16 }}>
      <b>{info.name}</b>
      <span>{price}</span>
    </div>
  );
}

/* ── Loading screen ── */
function LoadingScreen({ text }) {
  return (
    <div className="customizer-loading">
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--sage)', display: 'inline-block',
        animation: 'breathe 1.2s ease-in-out infinite',
      }} />
      {text || 'Loading configurator…'}
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
  const [exportingGLB, setExportingGLB] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  // Bilingual state (English / German)
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('sauna_lang') || 'en'; }
    catch { return 'en'; }
  });
  const t = getTranslation(lang);
  const isDe = lang === 'de';

  const switchLang = newLang => {
    setLang(newLang);
    try { localStorage.setItem('sauna_lang', newLang); } catch {}
  };

  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const materialsRef = useRef(null);

  const handleExportGLB = async () => {
    if (!sceneRef.current) return;
    setExportingGLB(true);
    setExportMessage(t.msgGeneratingGlb);
    try {
      const familySlug = cfg?.family || 'custom';
      const filename = `${familySlug}-sauna-${cfg?.widthCm || 200}x${cfg?.depthCm || 180}`;
      await sceneRef.current.exportGLB(filename);
      setExportMessage(t.msgGlbDownloaded);
      setTimeout(() => setExportMessage(''), 3500);
    } catch (err) {
      console.error('Failed to export GLB:', err);
      setExportMessage(t.msgExportFailed);
      setTimeout(() => setExportMessage(''), 4000);
    } finally {
      setExportingGLB(false);
    }
  };

  const handleExportSpec = () => {
    if (!cfg || !catalog) return;
    const familySlug = cfg?.family || 'custom';
    const filename = `${familySlug}-sauna-${cfg?.widthCm || 200}x${cfg?.depthCm || 180}-${isDe ? 'spezifikation' : 'specification'}`;
    downloadSpecification(cfg, catalog, pricing, filename, lang);
    setExportMessage(t.msgSpecDownloaded);
    setTimeout(() => setExportMessage(''), 3500);
  };

  // Price every preset once for the picker screen's "from CHF …" tags
  useEffect(() => {
    if (!catalog || !presets) return;
    const totals = {};
    for (const preset of presets) totals[preset.id] = priceItems(fromPreset(preset), catalog, lang).total;
    setPresetTotals(totals);
  }, [catalog, presets, lang]);

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

  // Rebuild parametric model on config or language change
  useEffect(() => {
    if (!sceneRef.current || !cfg || !catalog) return;
    sceneRef.current.setConfig(cfg, catalog, lang);
  }, [cfg, catalog, lang]);

  useEffect(() => { sceneRef.current?.setView(view); }, [view]);
  useEffect(() => { sceneRef.current?.setDoorOpen(doorOpen); }, [doorOpen]);

  const pricing = useMemo(() => (cfg && catalog ? priceItems(cfg, catalog, lang) : null), [cfg, catalog, lang]);

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

  if (loading) return <LoadingScreen text={t.loading} />;
  if (error || !catalog) return (
    <div className="customizer-loading">
      {isDe ? 'Katalog konnte nicht geladen werden.' : 'Catalog could not be loaded.'}{' '}
      <button onClick={() => location.reload()} style={{ textDecoration: 'underline', color: 'var(--pine)' }}>
        {isDe ? 'Seite neu laden' : 'Reload page'}
      </button>
    </div>
  );

  const family = cfg ? catalog.families[cfg.family] : null;
  const familyName = family
    ? (isDe ? (family.name_de || family.name_en) : (family.name_en || family.name_de))
        .replace(', Swiss-made to measure', '')
        .replace(', nach Mass gefertigt in der Schweiz', '')
        .replace(', solid spruce 45 mm, front entry with window', '')
        .replace(', Massivholz 45mm mit Fronteinstieg und Fenster', '')
    : '';

  return (
    <div className="customizer-app">
      {/* ── Header ── */}
      <header className="site-header">
        <Wordmark homeAria={t.homeAria} />

        <div className="header-right">
          {stage === 'customize' && (
            <button
              className="customizer-back"
              onClick={() => setStage('pick')}
            >
              <ChevronLeft size={14} />
              {t.backToPresets}
            </button>
          )}

          {/* ── Language Toggle (EN / DE) ── */}
          <div className="lang-toggle" role="group" aria-label={t.langLabel}>
            <button
              type="button"
              className={`lang-btn ${lang === 'en' ? 'is-active' : ''}`}
              onClick={() => switchLang('en')}
              title="English"
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
            <button
              type="button"
              className={`lang-btn ${lang === 'de' ? 'is-active' : ''}`}
              onClick={() => switchLang('de')}
              title="Deutsch"
              aria-pressed={lang === 'de'}
            >
              DE
            </button>
          </div>
        </div>
      </header>

      {/* ── Preset picker ── */}
      {stage === 'pick' && (
        <PresetPicker
          presets={presets}
          totals={presetTotals}
          onPick={pickPreset}
          onStartBlank={startBlank}
          lang={lang}
        />
      )}

      {/* ── Configurator ── */}
      {stage === 'customize' && cfg && (
        <div className="customize-layout">

          {/* ── 3D Viewer ── */}
          <section className="viewer3d" aria-label={isDe ? 'Interaktive 3D-Vorschau' : '3D sauna preview'}>
            <div className="viewer3d-host" ref={hostRef} />
            <HoverTip info={hover.info} x={hover.x} y={hover.y} lang={lang} />

            {/* toolbar */}
            <div className="viewer3d-toolbar">
              <div className="view-switch-pill" role="group" aria-label={isDe ? 'Kameraperspektive' : 'Camera view'}>
                <button
                  aria-pressed={view === 'exterior'}
                  onClick={() => setView('exterior')}
                >
                  <Box size={14} />{t.exterior}
                </button>
                <button
                  aria-pressed={view === 'interior'}
                  onClick={() => setView('interior')}
                >
                  <DoorOpen size={14} />{t.interior}
                </button>
              </div>

              <button
                className="viewer3d-door-btn"
                onClick={() => setDoorOpen(o => !o)}
                aria-pressed={doorOpen}
                title={doorOpen ? t.closeDoor : t.openDoor}
              >
                <DoorOpen size={16} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.02em' }}>
                  {doorOpen ? t.close : t.open}
                </span>
              </button>
            </div>

            <p className="viewer3d-hint">
              {t.viewerHint}
            </p>

            {/* click-to-configure drawer */}
            <ComponentDrawer
              category={drawerCategory}
              catalog={catalog}
              cfg={cfg}
              volumeM3={pricing?.volumeM3}
              selectedName={drawerName}
              lang={lang}
              onClose={() => setDrawerCategory(null)}
              onSetCfg={setCfg}
              onSetInterior={setInterior}
              onSetDoor={setDoor}
              onSetHeater={setHeater}
              onToggleList={toggleList}
            />
          </section>

          {/* ── Right panel ── */}
          <aside className="customizer-panel" aria-label={isDe ? 'Sauna konfigurieren' : 'Configure your sauna'}>
            {/* sticky heading */}
            <div className="panel-head">
              <span className="collection-label">{isDe ? 'Ihre Konfiguration' : 'Your configuration'}</span>
              <h2>{familyName}</h2>
              <p>
                {cfg.widthCm} × {cfg.depthCm} × {cfg.heightCm} cm
                {pricing ? (isDe ? ` · ${pricing.volumeM3} m³ Volumen` : ` · ${pricing.volumeM3} m³ volume`) : ''}
              </p>
            </div>

            {/* accordion sections */}
            <ConfiguratorPanel
              catalog={catalog}
              cfg={cfg}
              openId={openSection}
              volumeM3={pricing?.volumeM3}
              warnings={pricing?.warnings || []}
              lang={lang}
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
                  {t.priceBreakdown}
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
                  <span>{t.vatIncluded}</span>
                  <span>{chf(pricing?.total)}</span>
                </div>
              </details>

              <div className="grand-total">
                <div>
                  <span>{t.totalPrice}</span>
                  <p className="grand-total-note">{t.indicativeVat}</p>
                </div>
                <b>{chf(pricing?.total)}</b>
              </div>

              {/* Export actions */}
              <div className="export-actions">
                <button
                  type="button"
                  className="export-btn export-btn-primary"
                  onClick={handleExportGLB}
                  disabled={exportingGLB}
                  title={isDe ? '3D-Modell (.glb) für Blender, CAD oder AR herunterladen' : 'Export and download the 3D model (.glb) for Blender, AR or CAD viewers'}
                >
                  <Download size={14} />
                  <span>{exportingGLB ? t.exportingGLB : t.exportGLB}</span>
                </button>

                <button
                  type="button"
                  className="export-btn export-btn-secondary"
                  onClick={handleExportSpec}
                  title={isDe ? 'Detaillierte Offerte & Datenblatt als Textdatei (.txt) herunterladen' : 'Download an itemized bill of materials and price quote (.txt)'}
                >
                  <FileText size={14} />
                  <span>{t.downloadSpec}</span>
                </button>
              </div>
              {exportMessage && <p className="export-feedback">{exportMessage}</p>}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
