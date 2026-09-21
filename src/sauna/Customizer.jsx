import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, DoorOpen, RotateCcw, ChevronLeft, ChevronDown, Receipt } from 'lucide-react';
import { useCatalog } from './useCatalog';
import { SaunaScene } from './SaunaScene';
import { MaterialCache } from './geometry';
import { defaultConfig, fromPreset, normalizeConfig } from './config';
import { priceItems } from './pricing';
import { chf } from './format';
import PresetPicker from './PresetPicker';
import { ConfiguratorPanel, ComponentDrawer } from './Panel';
import './customizer.css';

function Wordmark() {
  return <a className="wordmark" href="#top" aria-label="Sauna Studio home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>sauna<span className="wordmark-light">studio</span></a>;
}

function HoverTip({ info, x, y }) {
  if (!info) return null;
  const price = info.price ? chf(info.price) : (info.includedIn ? 'Im Lieferumfang enthalten' : 'CHF 0.–');
  return (
    <div className="hover-tip" style={{ left: x + 16, top: y + 16 }}>
      <b>{info.name}</b>
      <span>{price}</span>
    </div>
  );
}

export default function Customizer() {
  const { catalog, presets, loading, error } = useCatalog();
  const [stage, setStage] = useState('pick');
  const [cfg, setCfgRaw] = useState(null);
  const [presetTotals, setPresetTotals] = useState({});
  const [view, setView] = useState('exterior');
  const [doorOpen, setDoorOpen] = useState(false);
  const [openSection, setOpenSection] = useState(null);
  const [drawerCategory, setDrawerCategory] = useState(null);
  const [hover, setHover] = useState({ info: null, x: 0, y: 0 });
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const materialsRef = useRef(null);

  // Price every preset once, for the picker screen's "ab CHF …" tags.
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

  // Mount the 3D scene once we enter the customizer.
  useEffect(() => {
    if (stage !== 'customize' || !hostRef.current || !catalog) return;
    materialsRef.current = new MaterialCache(catalog);
    const scene = new SaunaScene(hostRef.current, materialsRef.current, {
      onHover: (info, x, y) => setHover({ info, x, y }),
      onSelect: info => { if (info) { setDrawerCategory(info.category); setOpenSection(info.category); } },
    });
    sceneRef.current = scene;
    return () => { scene.dispose(); sceneRef.current = null; };
  }, [stage, catalog]);

  // Rebuild the parametric model whenever the configuration changes.
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

  if (loading) return <div className="customizer-loading">Konfigurator wird geladen…</div>;
  if (error || !catalog) return <div className="customizer-loading">Der Katalog konnte nicht geladen werden. Bitte laden Sie die Seite neu.</div>;

  return (
    <div className="customizer-app">
      <header className="site-header">
        <Wordmark />
        {stage === 'customize' && (
          <button className="text-button" onClick={() => setStage('pick')}><ChevronLeft size={16} />Andere Vorlage waehlen</button>
        )}
      </header>
      {stage === 'pick' && <PresetPicker presets={presets} totals={presetTotals} onPick={pickPreset} onStartBlank={startBlank} />}
      {stage === 'customize' && cfg && (
        <div className="customize-layout">
          <section className="viewer3d">
            <div className="viewer3d-host" ref={hostRef} />
            <HoverTip info={hover.info} x={hover.x} y={hover.y} />
            <div className="viewer3d-toolbar">
              <div className="view-switch">
                <button aria-pressed={view === 'exterior'} onClick={() => setView('exterior')}><Box size={15} />Aussenansicht</button>
                <button aria-pressed={view === 'interior'} onClick={() => setView('interior')}><DoorOpen size={15} />Innenansicht</button>
              </div>
              <button className="icon-button" onClick={() => setDoorOpen(o => !o)} aria-pressed={doorOpen} title="Tuer oeffnen/schliessen"><RotateCcw size={16} /></button>
            </div>
            <p className="viewer3d-hint">Ziehen zum Drehen · Scrollen zum Zoomen · Auf ein Bauteil klicken, um es anzupassen</p>
            <ComponentDrawer category={drawerCategory} catalog={catalog} cfg={cfg} volumeM3={pricing?.volumeM3}
              onClose={() => setDrawerCategory(null)}
              onSetCfg={setCfg} onSetInterior={setInterior} onSetDoor={setDoor} onSetHeater={setHeater} onToggleList={toggleList} />
          </section>
          <aside className="configuration customizer-panel" aria-label="Sauna konfigurieren">
            <div className="product-heading">
              <div><span className="collection-label">Ihre Konfiguration</span><h2>{catalog.families[cfg.family].name_de.replace(' Swissmade nach Mass', '')}</h2></div>
            </div>
            <p className="product-description">{cfg.widthCm} x {cfg.depthCm} x {cfg.heightCm} cm · {pricing?.volumeM3} m³ Innenraum</p>
            <ConfiguratorPanel catalog={catalog} cfg={cfg} openId={openSection} warnings={pricing?.warnings || []}
              onSetCfg={setCfg} onSetInterior={setInterior} onSetDoor={setDoor} onSetHeater={setHeater} onToggleList={toggleList} />
            <div className="configuration-actions total-bar">
              <details className="price-breakdown">
                <summary><Receipt size={15} />Preisdetails<ChevronDown size={14} /></summary>
                <ul>
                  {pricing?.items.filter(i => i.price > 0).map((item, i) => (
                    <li key={i}><span>{item.name}</span><span>{chf(item.price)}</span></li>
                  ))}
                </ul>
                <div className="price-breakdown-total"><span>inkl. 8.1% MwSt</span><span>{chf(pricing?.total)}</span></div>
              </details>
              <div className="grand-total"><span>Gesamtpreis</span><b>{chf(pricing?.total)}</b></div>
              <p>Preise inkl. MwSt., Richtwerte auf Basis von holzsauna.ch. Verbindliches Angebot nach Rueckfrage.</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
