import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, DoorOpen, ChevronLeft, ChevronDown, Receipt, Download, FileText, Share2, Send, RotateCcw, Check, Undo2, Redo2, Globe } from 'lucide-react';
import { useCatalog } from './useCatalog';
import { defaultConfig, fromPreset, normalizeConfig } from './config';
import { priceItems } from './pricing';
import { chf } from './format';
import { getTranslation } from './i18n';
import { createShareURL, loadSharedConfig, copyToClipboard } from './shareLink';
import { openPrintableQuote } from './printQuote';
import QuoteModal from './QuoteModal';
import PresetPicker from './PresetPicker';
import { ConfiguratorPanel, ComponentDrawer } from './Panel';
import './customizer.css';

/* ── Wordmark ── */
function Wordmark({ homeAria }) {
  return (
    <a className="brand-link" href="#top" aria-label={homeAria || "HolzSauna"}>
      <img src="/assets/images/logo.gif" alt="HolzSauna" className="brand-logo" />
    </a>
  );
}

/* ── Language selector ── */
const LANGUAGES = [
  ['en', 'English'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['it', 'Italiano'],
];

/**
 * Dropdown rather than a row of four pills: the header already carries back /
 * undo / redo / reset / share, and four more always-on buttons crowd it —
 * badly so once a narrow viewport wraps the row.
 */
function LanguageSelect({ lang, onSelect, label }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = LANGUAGES.find(([code]) => code === lang) || LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = e => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKeyDown = e => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      rootRef.current?.querySelector('.lang-trigger')?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="lang-select" ref={rootRef}>
      <button
        type="button"
        className={`lang-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current[1]}`}
        title={label}
      >
        <Globe size={13} aria-hidden="true" />
        <span className="lang-code">{current[0].toUpperCase()}</span>
        <ChevronDown size={13} aria-hidden="true" className="lang-caret" />
      </button>

      {open && (
        <ul className="lang-menu" role="listbox" aria-label={label}>
          {LANGUAGES.map(([code, name]) => (
            <li key={code}>
              <button
                type="button"
                role="option"
                aria-selected={code === lang}
                className={`lang-option ${code === lang ? 'is-active' : ''}`}
                onClick={() => { onSelect(code); setOpen(false); }}
              >
                <span className="lang-option-code">{code.toUpperCase()}</span>
                <span className="lang-option-name">{name}</span>
                {code === lang && <Check size={13} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const [share, setShare] = useState({ url: '', copied: false, busy: false });
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [hist, setHist] = useState({ stack: [], index: -1 });
  const initialCfgRef = useRef(null);
  const sharedPresetRef = useRef(null);
  const skipHistoryRef = useRef(false);
  const canUndo = hist.index > 0;
  const canRedo = hist.index >= 0 && hist.index < hist.stack.length - 1;

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

  // Price every preset once for the picker screen's "from CHF …" tags
  useEffect(() => {
    if (!catalog || !presets) return;
    const totals = {};
    for (const preset of presets) totals[preset.id] = priceItems(fromPreset(preset), catalog, lang).total;
    setPresetTotals(totals);
  }, [catalog, presets, lang]);

  // Every committed change goes through here so it lands on the undo/redo
  // stack (skipped while undo/redo itself is replaying a past config).
  const commit = updater => setCfgRaw(prev => {
    if (!catalog) return prev;
    const next = updater(prev);
    if (!skipHistoryRef.current) {
      setHist(h => {
        const stack = h.stack.slice(0, h.index + 1);
        stack.push(next);
        while (stack.length > 60) stack.shift();
        return { stack, index: stack.length - 1 };
      });
    }
    return next;
  });

  const setCfg = patch => commit(prev => {
    const next = { ...prev, ...patch };
    // Each family owns its own height (or height-per-size); switching families
    // must not leave a stale height from a different product type behind.
    if (patch.family && patch.family !== prev.family) {
      const nf = catalog.families[patch.family];
      const size = nf.sizes ? nf.sizes.find(s => s.w === prev.widthCm && s.d === prev.depthCm) || nf.sizes[Math.min(2, nf.sizes.length - 1)] : null;
      next.heightCm = size?.h || nf.height_cm;
    }
    return normalizeConfig(next, catalog);
  });
  const setInterior = patch => commit(prev => normalizeConfig({ ...prev, interior: { ...prev.interior, ...patch } }, catalog));
  const setDoor = patch => commit(prev => normalizeConfig({ ...prev, door: { ...prev.door, ...patch } }, catalog));
  const setHeater = patch => commit(prev => normalizeConfig({ ...prev, heater: { ...prev.heater, ...patch } }, catalog));
  const setBundle = bundleKey => commit(prev => normalizeConfig({ ...prev, bundle: bundleKey }, catalog));
  const toggleList = (key, sku) => commit(prev => {
    const list = prev[key].includes(sku) ? prev[key].filter(s => s !== sku) : [...prev[key], sku];
    return normalizeConfig({ ...prev, [key]: list }, catalog);
  });

  const seedHistory = initial => { setHist({ stack: [initial], index: 0 }); };
  const undo = () => {
    if (!canUndo) return;
    const newIndex = hist.index - 1;
    skipHistoryRef.current = true;
    setCfgRaw(hist.stack[newIndex]);
    skipHistoryRef.current = false;
    setHist(h => ({ ...h, index: newIndex }));
  };
  const redo = () => {
    if (!canRedo) return;
    const newIndex = hist.index + 1;
    skipHistoryRef.current = true;
    setCfgRaw(hist.stack[newIndex]);
    skipHistoryRef.current = false;
    setHist(h => ({ ...h, index: newIndex }));
  };

  // Keyboard shortcuts: Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) to redo.
  useEffect(() => {
    if (stage !== 'customize') return;
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' && e.key.toLowerCase() !== 'y') return;
      // Only defer to native undo inside a text field - a focused checkbox
      // (e.g. right after toggling a lighting/accessory row) is still an
      // <input>, but Ctrl+Z has no native meaning there and should undo the app state.
      const el = e.target;
      const isTextField = el instanceof HTMLElement && (el.tagName === 'TEXTAREA' ||
        (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)));
      if (isTextField) return;
      e.preventDefault();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, hist]);

  // A shared link (?c=...) restores a full configuration straight into the
  // customizer on load, bypassing the preset picker.
  useEffect(() => {
    if (!catalog || sharedPresetRef.current) return;
    sharedPresetRef.current = true;
    if (!location.search) return;
    let cancelled = false;
    loadSharedConfig(catalog).then(shared => {
      if (cancelled || !shared) return;
      const normalized = normalizeConfig(shared, catalog);
      setCfgRaw(normalized);
      initialCfgRef.current = normalized;
      seedHistory(normalized);
      setStage('customize');
      history.replaceState({ stage: 'customize' }, '', location.href);
    });
    return () => { cancelled = true; };
  }, [catalog]);

  // Real browser back/forward: entering the customizer pushes a history
  // entry, so the native Back button returns to the preset picker.
  useEffect(() => {
    const onPopState = e => setStage(e.state?.stage === 'customize' ? 'customize' : 'pick');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleShare = async () => {
    if (!cfg || share.busy) return;
    setShare({ url: '', copied: false, busy: true });
    const { url } = await createShareURL(cfg, pricing?.total);
    const copied = await copyToClipboard(url);
    setShare({ url, copied, busy: false });
  };
  const handleReset = () => {
    if (!initialCfgRef.current) return;
    const restored = structuredClone(initialCfgRef.current);
    skipHistoryRef.current = true;
    setCfgRaw(restored);
    skipHistoryRef.current = false;
    setHist(h => ({ stack: [...h.stack.slice(0, h.index + 1), restored], index: h.index + 1 }));
  };
  const handlePrintQuote = () => { if (pricing) openPrintableQuote(cfg, catalog, pricing, lang); };

  // Mount the 3D scene once we enter the customizer. three.js (~570 kB) and its
  // scene/geometry code are only fetched here, not on the preset-picker screen,
  // which never needs them.
  useEffect(() => {
    if (stage !== 'customize' || !hostRef.current || !catalog) return;
    let cancelled = false;
    let scene = null;
    Promise.all([import('./SaunaScene'), import('./geometry')]).then(([{ SaunaScene }, { MaterialCache }]) => {
      if (cancelled || !hostRef.current) return;
      materialsRef.current = new MaterialCache(catalog);
      scene = new SaunaScene(hostRef.current, materialsRef.current, {
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
      if (cfg) scene.setConfig(cfg, catalog, lang);
    });
    return () => { cancelled = true; scene?.dispose(); sceneRef.current = null; };
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
    const normalized = normalizeConfig(fromPreset(preset), catalog);
    setCfgRaw(normalized);
    initialCfgRef.current = normalized;
    seedHistory(normalized);
    setStage('customize');
    setView('exterior');
    setDoorOpen(false);
    history.pushState({ stage: 'customize' }, '', location.pathname);
  }
  function startBlank() {
    const normalized = defaultConfig(catalog);
    setCfgRaw(normalized);
    initialCfgRef.current = normalized;
    seedHistory(normalized);
    setStage('customize');
    history.pushState({ stage: 'customize' }, '', location.pathname);
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
            <>
              <button
                className="customizer-back"
                onClick={() => history.back()}
                title={isDe ? 'Zur Vorlagenauswahl (Browser-Zurück)' : 'Back to the presets (browser Back)'}
              >
                <ChevronLeft size={14} />
                {isDe ? 'Zurück' : 'Back'}
              </button>
              <button className="customizer-back icon-only" onClick={undo} disabled={!canUndo} title={isDe ? 'Rückgängig (Strg+Z)' : 'Undo (Ctrl+Z)'} aria-label={isDe ? 'Rückgängig' : 'Undo'}>
                <Undo2 size={14} />
              </button>
              <button className="customizer-back icon-only" onClick={redo} disabled={!canRedo} title={isDe ? 'Wiederholen (Strg+Y)' : 'Redo (Ctrl+Y)'} aria-label={isDe ? 'Wiederholen' : 'Redo'}>
                <Redo2 size={14} />
              </button>
              <button className="customizer-back" onClick={handleReset} title={isDe ? 'Änderungen verwerfen, zur Ausgangskonfiguration' : 'Discard changes, back to the starting configuration'}>
                <RotateCcw size={13} />
                {isDe ? 'Zurücksetzen' : 'Reset'}
              </button>
              <button className={`customizer-back share-btn ${share.copied ? 'is-done' : ''}`} onClick={handleShare} disabled={share.busy} title={isDe ? 'Eindeutigen Link zu diesem Entwurf erstellen' : 'Create a unique link to this design'}>
                {share.copied ? <Check size={13} /> : <Share2 size={13} />}
                {share.busy ? '…' : share.copied ? (isDe ? 'Link kopiert' : 'Link copied') : (isDe ? 'Link teilen' : 'Share link')}
              </button>
            </>
          )}

          {/* ── Language selector (EN / DE / FR / IT) ── */}
          <LanguageSelect lang={lang} onSelect={switchLang} label={t.langLabel} />
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
              onSetBundle={setBundle}
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
              notes={pricing?.notes || []}
              fit={pricing?.fit}
              lang={lang}
              onSetCfg={setCfg}
              onSetInterior={setInterior}
              onSetDoor={setDoor}
              onSetHeater={setHeater}
              onSetBundle={setBundle}
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

              {/* Primary action: request a quote */}
              <button type="button" className="primary-button quote-cta" onClick={() => setQuoteOpen(true)}>
                <Send size={15} />
                <span>{isDe ? 'Offerte anfragen' : 'Request a quote'}</span>
              </button>

              {/* One PDF (quote + floor plan + technical notes) and the 3D model */}
              <div className="export-row">
                <button type="button" className="export-btn export-btn-secondary" onClick={handlePrintQuote} title={isDe ? 'Offerte mit Grundriss und technischen Hinweisen als PDF' : 'Quotation with floor plan and technical notes as PDF'}>
                  <FileText size={14} />
                  <span>{isDe ? 'PDF-Offerte' : 'PDF quote'}</span>
                </button>
                <button type="button" className="export-btn export-btn-secondary" onClick={handleExportGLB} disabled={exportingGLB} title={isDe ? '3D-Modell (.glb) für Blender, CAD oder AR' : '3D model (.glb) for Blender, AR or CAD'}>
                  <Download size={14} />
                  <span>{exportingGLB ? t.exportingGLB : (isDe ? '3D-Modell' : '3D model')}</span>
                </button>
              </div>
              {share.url && (
                <div className="share-box">
                  <input readOnly value={share.url} onFocus={e => e.target.select()} aria-label={isDe ? 'Link zum Entwurf' : 'Link to this design'} />
                  <button type="button" onClick={async () => { const ok = await copyToClipboard(share.url); setShare(s => ({ ...s, copied: ok })); }}>{share.copied ? (isDe ? 'Kopiert' : 'Copied') : (isDe ? 'Kopieren' : 'Copy')}</button>
                </div>
              )}
              {exportMessage && <p className="export-feedback">{exportMessage}</p>}
            </div>
          </aside>
        </div>
      )}

      {quoteOpen && cfg && pricing && (
        <QuoteModal cfg={cfg} pricing={pricing} familyName={familyName} lang={lang} onClose={() => setQuoteOpen(false)} />
      )}
    </div>
  );
}
