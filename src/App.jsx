import { useEffect, useRef, useState } from 'react';
import { Bookmark, Box, Armchair, Layers2, Ruler, Download, RotateCcw, Move, Check, SlidersHorizontal, PanelTop, LampWallUp, SunDim, Scan, ArrowUpRight, ArrowRight, ArrowUp, Link, Glasses } from 'lucide-react';
import { SaunaViewer } from './viewer';
import { api } from './api';
import { loadConfig, saveConfig, designURL } from './state';
import { xrSupport, startXR, publishModel, openSceneViewer, arLaunchFailed } from './xr';
import SpaceChecker, { Modal } from './SpaceChecker';

function download(url, filename) { const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); }
function Wordmark() { return <a className="wordmark brand-link" href="#studio" aria-label="HolzSauna"><img src="/images/logo.png" alt="HolzSauna" className="brand-logo" /></a>; }

function DoorDiagram({ right }) { return <svg viewBox="0 0 42 36" aria-hidden="true"><path d={right ? 'M9 31V5h23v26M28 5v26H9M28 10h4m-4 15h4' : 'M9 31V5h23v26M13 5v26h19M13 10h-4m4 15h-4'} /><circle cx={right ? 14 : 27} cy="19" r="1" /></svg>; }

function Configuration({ config, change, changeDoor, ready, space, review, persistence }) {
  return <aside className="configuration" id="configuration" aria-label="Configure your sauna"><div className="product-heading"><div><span className="collection-label">Your personal retreat</span><h2>Sauna 140</h2></div><span className="wood-swatch" aria-label="Natural spruce" /></div><p className="product-description">Warm timber. Clear glass. A little room to unwind.</p><div className="product-specs"><span><b>1.68</b> m² footprint</span><span><b>3.6</b> kW heater</span></div>
    <fieldset className="control-section"><legend>Door hinge <span>Viewed from outside</span></legend><div className="hinge-options">{['left','right'].map(door => <button key={door} className={`option ${config.door === door ? 'selected' : ''}`} aria-pressed={config.door === door} onClick={() => changeDoor({ door })}><DoorDiagram right={door === 'right'} />{door === 'left' ? 'Left' : 'Right'} hinge<Check className="selection-check" /></button>)}</div><div className="door-control"><label htmlFor="door-angle">Open the door</label><output id="angle-output" htmlFor="door-angle">{config.angle}°</output></div><input id="door-angle" type="range" min="0" max="90" step="1" value={config.angle} onChange={event => changeDoor({ angle: Number(event.target.value) })} aria-label="Door opening angle" /><button className="door-toggle" disabled={!ready} onClick={() => changeDoor({ angle: config.angle > 45 ? 0 : 90 })}>{config.angle > 45 ? "Close door" : "Open door"}</button></fieldset>
    <fieldset className="control-section"><legend>Heater controls</legend><div className="heater-options">{['integrated','external'].map(heater => <button key={heater} className={`heater-option ${config.heater === heater ? 'selected' : ''}`} aria-pressed={config.heater === heater} onClick={() => change({ heater })}><span className="radio-dot" /><span><b>{heater === 'integrated' ? 'Integrated' : 'External'}</b><small>{heater === 'integrated' ? 'Controls on the heater' : 'A separate wall controller'}</small></span>{heater === 'integrated' ? <SlidersHorizontal /> : <PanelTop />}</button>)}</div></fieldset>
    <fieldset className="control-section light-section"><legend>Set the atmosphere</legend>{[['wall','Timber wall light',LampWallUp],['bench','Under-bench glow',SunDim]].map(([key,label,Icon]) => <label key={key} className="switch-row"><span><Icon />{label}</span><input type="checkbox" checked={config[key]} onChange={event => change({ [key]: event.target.checked })} /><span className="switch" aria-hidden="true" /></label>)}</fieldset>
    <div className="configuration-actions"><button className="primary-button" onClick={space}><Scan />Check my space<ArrowUpRight /></button><button className="review-button" onClick={review}>Review your design<ArrowRight /></button><p>{persistence ? 'Your configuration stays saved on this device.' : 'Local saving is unavailable. Use Save design to keep a link.'}</p></div>
  </aside>;
}

export default function App() {
  const [config, setConfig] = useState(loadConfig);
  const latestConfig = useRef(config);
  const [view, setView] = useState('exterior'), [component, setComponent] = useState('all');
  const [dimensions, setDimensions] = useState(false), [status, setStatus] = useState({ progress: 0 });
  const [modal, setModal] = useState(arLaunchFailed ? 'space' : null), [summaryImage, setSummaryImage] = useState('/images/exterior.png');
  const [toast, setToast] = useState(''), [saving, setSaving] = useState(false), [share, setShare] = useState('');
  const [persistence, setPersistence] = useState(true), [support, setSupport] = useState({}), [attempt, setAttempt] = useState(0);
  const [xrActive, setXRActive] = useState(false), [xrMessage, setXRMessage] = useState('');
  const host = useRef(null), viewer = useRef(null), overlay = useRef(null), configRequest = useRef(0);
  const toastTimer = useRef(null);
  function notify(message) { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 5000); }
  function change(patch) { setConfig(value => ({ ...value, ...patch })); setShare(''); configRequest.current++; }

  useEffect(() => {
    let alive = true, instance;
    setStatus({ progress: 0 });
    try {
      instance = new SaunaViewer(host.current, { onStatus: value => { if (alive) setStatus(old => ({ ...old, ...value })); }, onDoor: () => setConfig(value => ({ ...value, angle: value.angle > 45 ? 0 : 90 })), onXR: setXRActive });
      viewer.current = instance;
      instance.apply(latestConfig.current);
      api('/catalog').then(catalog => instance.load(catalog)).catch(error => { if (alive) setStatus({ error: error.message }); });
      if (import.meta.env.DEV || new URLSearchParams(location.search).has('inspect')) window.__sauna = { diagnostics: () => instance.diagnostics() };
    } catch (error) { setStatus({ error: 'The 3D view could not start. Enable hardware acceleration or try another browser.' }); }
    return () => { alive = false; instance?.dispose(); viewer.current = null; delete window.__sauna; };
  }, [attempt]);

  useEffect(() => { latestConfig.current = config; viewer.current?.apply(config); setPersistence(saveConfig(config)); setShare(''); }, [config]);
  useEffect(() => { if (viewer.current) { viewer.current.dimensionBox.visible = dimensions; viewer.current.dirty = true; } }, [dimensions]);
  useEffect(() => { xrSupport().then(setSupport); return () => clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('design');
    if (!id) return;
    let alive = true; const revision = configRequest.current;
    api(`/designs/${encodeURIComponent(id)}`).then(design => { if (alive && revision === configRequest.current) { setConfig(design.configuration); notify('Shared design loaded'); } }).catch(error => { if (alive) notify(error.message); });
    return () => { alive = false; };
  }, []);

  function selectView(next) { setView(next); setComponent('all'); if (viewer.current) { viewer.current.component = 'all'; if (next === 'interior') change({ angle: 90 }); viewer.current.setView(next); } }
  function selectComponent(next) { setComponent(next); setView('exterior'); viewer.current?.setComponent(next); }
  function changeDoor(patch) {
    if (component !== 'all' && component !== 'door') selectComponent('all');
    change(patch);
  }
  function showReview() { setSummaryImage(status.ready ? viewer.current.snapshot() : '/images/exterior.png'); setModal('summary'); }
  async function saveDesign(copy = false) {
    setSaving(true);
    const selected = { ...latestConfig.current };
    try {
      const saved = await api('/designs', { configuration: selected });
      const url = new URL(saved.path, location.origin).href;
      setShare(url);
      if (copy) {
        try { await navigator.clipboard.writeText(url); notify('Design saved. Link copied.'); }
        catch { notify('Design saved. Copy the link below.'); }
      } else { setModal('summary'); setSummaryImage(status.ready ? viewer.current.snapshot() : '/images/exterior.png'); notify('Design saved. Anyone with its link can view it.'); }
    } catch { setShare(designURL(selected)); notify('Server unavailable. Your configuration link is still available below.'); setModal('summary'); }
    finally { setSaving(false); }
  }
  function specification() {
    const text = `Sauna Studio — Sauna 140\n\nDimensions: 140 × 120 × 202 cm\nFootprint: 1.68 m²\nWalls: 45 mm solid spruce\nDoor: 8 mm tempered glass, ${config.door} hinge\nHeater: 3.6 kW, ${config.heater} control\nTimber wall light: ${config.wall ? 'Included' : 'Not included'}\nUnder-bench glow: ${config.bench ? 'Included' : 'Not included'}\n\nDesign: ${share || designURL(config)}\n\nVisual configuration only. Confirm manufacturer component drawings and installation, ventilation and service clearances before ordering.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); download(url, 'sauna-140-specification.txt'); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function enterXR(mode) {
    if (!status.ready) return notify('Please wait for the model to finish loading.');
    try { await startXR(viewer.current, mode, overlay.current, setXRMessage); }
    catch (error) {
      console.error('XR session failed', error);
      if (error.name === 'NotAllowedError') return notify('Immersive access was declined. You can continue in 3D.');
      // In-page AR is the fussiest path. Scene Viewer reaches the same ARCore without it.
      if (mode === 'immersive-ar' && /Android/.test(navigator.userAgent)) {
        notify(`In-page AR unavailable (${error.name}). Opening Google’s AR viewer…`);
        try { openSceneViewer(await publishModel(viewer.current), 'Sauna 140'); return; }
        catch (fallback) { return notify(`AR could not start — ${error.name}, then ${fallback.message}`); }
      }
      notify(`Immersive session could not start — ${error.name}: ${error.message}`);
    }
  }
  const rows = [['Dimensions','140 × 120 × 202 cm'], ['Door',`${config.door === 'left' ? 'Left' : 'Right'} hinge`], ['Heater',`${config.heater === 'integrated' ? 'Integrated' : 'External'} control`], ['Wall light',config.wall ? 'Included' : 'Not included'], ['Bench glow',config.bench ? 'Included' : 'Not included']];

  return <><a className="skip-link" href="#configuration">Skip to configuration</a><header className="site-header"><Wordmark /><nav aria-label="Main navigation"><a className="nav-active" href="#studio">Configure</a><a href="#details">The details</a></nav><button className="text-button" onClick={() => saveDesign()} disabled={saving}><Bookmark /><span>{saving ? 'Saving…' : 'Save design'}</span></button></header>
  <main><section className="studio" id="studio" aria-label="Sauna configurator"><div className="viewer" data-view={view}>
    <div className="viewer-heading"><span className="collection-label">The compact collection</span><h1>Space for<br />your own quiet.</h1><p>Sauna 140 · Solid spruce</p></div>
    {!status.ready && <img className="model-fallback" src="/images/exterior.png" alt="Compact spruce sauna" />}<div id="canvas-host" ref={host} className={status.ready ? 'ready' : ''} />
    <div className={`viewer-status ${status.ready ? 'ready' : ''} ${status.error ? 'error' : ''}`} role="status"><span className="loading-dot" /><span>{status.error || (status.ready ? 'Live 3D preview' : `Preparing your sauna… ${status.progress || 0}%`)}</span>{status.error && <button onClick={() => setAttempt(value => value + 1)}>Try again</button>}</div>
    <div className="viewer-utilities"><button className="icon-button" aria-label="Show dimensions" aria-pressed={dimensions} onClick={() => { setDimensions(!dimensions); if (viewer.current) viewer.current.dimensionBox.visible = !dimensions; }}><Ruler /></button><button className="icon-button" aria-label="Download image" disabled={!status.ready} onClick={() => download(viewer.current.snapshot(),`sauna-${component}.png`)}><Download /></button><button className="icon-button" aria-label="Reset view" onClick={() => selectView('exterior')}><RotateCcw /></button>{support.vr && <button className="icon-button" aria-label="Enter VR" onClick={() => enterXR('immersive-vr')}><Glasses /></button>}</div>
    {dimensions && <div className="dimension-labels"><span>Width <b>140 cm</b></span><span>Depth <b>120 cm</b></span><span>Height <b>202 cm</b></span></div>}
    <label className="component-select">Explore parts<select aria-label="Component view" value={component} onChange={event => selectComponent(event.target.value)}><option value="all">Complete sauna</option><option value="cabin">Cabin & benches</option><option value="door">Glass door</option><option value="heater">Heater & controls</option><option value="lighting">Lighting fixtures</option><option value="scale">Human scale reference</option></select></label>
    <div className="viewer-bottom"><div className="view-switch" role="group" aria-label="Camera view">{[['exterior','Exterior',Box],['interior','Interior',Armchair],['cutaway','Cutaway',Layers2]].map(([key,label,Icon]) => <button key={key} aria-pressed={view === key && component === 'all'} onClick={() => selectView(key)}><Icon />{label}</button>)}</div><p className="orbit-hint"><Move />Drag to explore · Scroll to zoom · Tap the door</p></div>
  </div><Configuration config={config} change={change} changeDoor={changeDoor} ready={status.ready} space={() => setModal('space')} review={showReview} persistence={persistence} /></section>
  <section className="details-section" id="details"><div className="detail-image"><img src="/images/interior.png" alt="Spruce interior with timber benches, a shaded wall lamp and stone heater" loading="lazy" /><span>A closer look inside</span></div><div className="detail-copy"><span className="collection-label">Considered in every corner</span><h2>Small footprint.<br />A full sauna experience.</h2><p>A compact cabin with solid spruce walls, two seating levels, and a full-height window that keeps the space open.</p><dl><div><dt>Solid timber walls</dt><dd>45 mm spruce</dd></div><div><dt>Tempered glass door</dt><dd>8 mm</dd></div><div><dt>Exterior dimensions</dt><dd>140 × 120 × 202 cm</dd></div></dl><button className="text-button" onClick={() => setModal('space')}>Find its place in your home<ArrowUpRight /></button></div></section></main>
  <footer><Wordmark /><p>A little space. A slower pace.</p><a href="#studio">Back to your design<ArrowUp /></a></footer>
  {modal === 'space' && <SpaceChecker onClose={() => setModal(null)} config={config} viewer={status.ready ? viewer.current : null} support={support} onAR={() => enterXR('immersive-ar')} />}
  {modal === 'summary' && <Modal title="Your moment of calm." eyebrow="Your configuration" onClose={() => setModal(null)}><div className="summary-layout"><img src={summaryImage} alt="Your selected sauna configuration" /><div><h3>Sauna 140</h3><dl>{rows.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><button className="primary-button" onClick={() => saveDesign(true)} disabled={saving}><Link />{saving ? 'Saving…' : 'Save & copy design link'}</button><button className="secondary-button" onClick={specification}><Download />Download specification</button>{share && <label className="share-label">Anyone with this link can view your design<input id="share-url" aria-label="Design link" value={share} readOnly onFocus={event => event.target.select()} /></label>}<p className="fit-note">A visual configuration. Confirm component drawings and installation requirements before ordering.</p></div></div></Modal>}
  <div ref={overlay} id="xr-overlay" hidden={!xrActive}><p role="status">{xrMessage}</p><div><button onClick={() => { if (viewer.current) viewer.current.model.rotation.y += Math.PI / 4; }}>Rotate sauna</button><button onClick={() => change({ angle: config.angle > 45 ? 0 : 90 })}>Open / close door</button><button onClick={() => viewer.current?.renderer.xr.getSession()?.end()}>Exit immersive view</button></div></div>
  <div className={`toast ${toast ? 'visible' : ''}`} role="status">{toast}</div></>;
}
