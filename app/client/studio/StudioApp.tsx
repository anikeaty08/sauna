/**
 * Production studio (/studio). Same showroom design as the previous studio -
 * stage with Exterior/Interior tabs on the left; product card, section stepper,
 * icon rail and option groups on the right - but driven by the modular
 * production engine: configuration-core (rules, layout, pricing) + the module
 * assembler (Blender modules, loaded on demand).
 */
import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  ChevronLeft, ChevronRight, Ruler, DoorOpen, Trees, Flame, LayoutGrid, PackagePlus,
  Send, Download, RotateCcw, Maximize2, ExternalLink, Undo2, DoorClosed, Smartphone, Share2, Move3d, ChevronDown,
} from 'lucide-react';
import { useStudio, type Section, type Tab } from './store/configurationStore.ts';
import { SaunaViewer } from './components/viewer/SaunaViewer.tsx';
import { Group } from './components/configurator/ui.tsx';
import { AccessorySelector, DimensionControls, DoorSelector, HeaterSelector, InteriorLayoutSelector, MaterialSelector } from './components/options/Options.tsx';
import { QuoteModal, RoomModal, ShareModal, isPhone } from './components/configurator/Modals.tsx';
import { shareConfiguration } from './services/saunaApi.ts';
import { getConfiguration, rememberLink, sameDesign } from './services/saunaApi.ts';
import type { SaunaConfiguration } from '../../../packages/configuration-core/index.ts';
import { chf } from './utils/format.ts';
import './styles/configurator.css';

const TABS: Record<Tab, { label: string; sections: { id: Section; label: string; icon: typeof Ruler }[] }> = {
  exterior: { label: 'Exterior', sections: [{ id: 'size', label: 'Size', icon: Ruler }, { id: 'door', label: 'Door & windows', icon: DoorOpen }] },
  interior: { label: 'Interior', sections: [
    { id: 'wood', label: 'Wood', icon: Trees }, { id: 'heater', label: 'Heater', icon: Flame },
    { id: 'layout', label: 'Layout', icon: LayoutGrid }, { id: 'extras', label: 'Accessories', icon: PackagePlus },
  ] },
};
const ALL = (Object.keys(TABS) as Tab[]).flatMap(t => TABS[t].sections);
const BODY: Record<Section, ComponentType> = {
  size: DimensionControls, door: DoorSelector, wood: MaterialSelector, heater: HeaterSelector, layout: InteriorLayoutSelector, extras: AccessorySelector,
};

export default function StudioApp() {
  const { model, config, price, issues, layout, tab, section, setSection, setTab, reset, resetView, load, doorOpen, toggleDoor } = useStudio();
  const [open, setOpen] = useState<Set<Section>>(() => new Set(ALL.map(s => s.id)));
  const [showDims, setShowDims] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [modal, setModal] = useState<'room' | 'quote' | 'share' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef<Partial<Record<Section, HTMLElement | null>>>({});

  // Restore a shared design (/studio?c=<id>).
  const opened = useRef<SaunaConfiguration | null>(null);
  const [sharedNote, setSharedNote] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('c');
    if (!id) return;
    getConfiguration(id)
      .then(r => {
        load(r.configuration);
        const cfg = useStudio.getState().config;
        opened.current = cfg;
        rememberLink(cfg, id);
        setSharedNote(true);
      })
      .catch(e => setLoadError(`${(e as Error).message} Showing the standard design instead.`));
  }, [load]);
  // Once the design is edited, the address bar must stop pointing at the old snapshot.
  useEffect(() => {
    if (opened.current && !sameDesign(opened.current, config) && location.search.includes('c=')) {
      history.replaceState(null, '', '/studio');
      opened.current = null;
      setSharedNote(false);
    }
  }, [config]);

  const idx = ALL.findIndex(s => s.id === section);
  const goTo = (id: Section) => {
    setSection(id);
    setOpen(o => new Set(o).add(id));
    requestAnimationFrame(() => {
      const el = groupRefs.current[id];
      if (el && listRef.current) listRef.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    });
  };
  const step = (dir: number) => goTo(ALL[(idx + dir + ALL.length) % ALL.length].id);
  const flip = (id: Section) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen())?.catch(() => {});
  // The quotation PDF is built by the server from the saved design (re-priced
  // there) and downloaded directly.
  const [pdfBusy, setPdfBusy] = useState(false);
  const pdf = async () => {
    setPdfBusy(true);
    try {
      const r = await shareConfiguration(useStudio.getState().config);
      const a = document.createElement('a');
      a.href = `/api/studio/configurations/${r.id}/quote.pdf`;
      a.download = `HolzSauna-Quotation-${r.id}.pdf`;
      document.body.append(a);
      a.click();
      a.remove();
    } catch (e) { setLoadError((e as Error).message); }
    finally { setPdfBusy(false); }
  };
  const warnings = issues.filter(i => i.level !== 'info');
  // Phones go straight to their own AR; desktops get the QR code.
  const viewInRoom = async () => {
    if (!isPhone()) { setModal('room'); return; }
    try { const r = await shareConfiguration(useStudio.getState().config); location.href = `/studio/ar?c=${r.id}`; }
    catch (e) { setLoadError((e as Error).message); }
  };

  return (
    <div className="studio">
      <main className="st-stage" ref={stageRef}>
        <header className="st-brand">
          <a href="/" aria-label="HolzSauna"><img src="/assets/images/logo.gif" alt="HolzSauna" /></a>
          <span>3D configurator</span>
        </header>

        <div className="st-tabs" role="tablist" aria-label="View">
          {(Object.keys(TABS) as Tab[]).map(k => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)}>{TABS[k].label}</button>
          ))}
        </div>

        <div className="st-canvas"><SaunaViewer onCanvas={c => { canvasRef.current = c; }} /></div>

        <div className="st-stage-tools">
          <button type="button" onClick={toggleDoor} aria-pressed={doorOpen} aria-label={doorOpen ? 'Close the door' : 'Open the door'} title={doorOpen ? 'Close the door' : 'Open the door'} className="st-door-toggle">
            {doorOpen ? <DoorOpen size={15} /> : <DoorClosed size={15} />}<span>{doorOpen ? 'Close door' : 'Open door'}</span>
          </button>
          <button type="button" onClick={resetView} aria-label="Reset view" title="Reset view"><RotateCcw size={15} /></button>
          <button type="button" onClick={fullscreen} aria-label="Full screen" title="Full screen"><Maximize2 size={15} /></button>
        </div>

        {showDims && (
          <div className="st-dims" role="status">
            <b>{config.dimensions.widthCm} × {config.dimensions.depthCm} × {model.dimensions.heightMm / 10} cm</b>
            <span>Width × depth × height (outside)</span>
            <span>Door {model.construction.door.widthMm / 10} × {model.construction.door.heightMm / 10} cm · glass front {Math.round(layout.segments.filter(s => s.kind !== 'solid').reduce((a, s) => a + s.length, 0) * 100)} cm</span>
          </div>
        )}

        <p className="st-hint" aria-hidden="true">
          <Move3d size={13} />
          {tab === 'interior'
            ? `You are inside the sauna${doorOpen ? '' : ', door closed'} · drag to look around · scroll to zoom`
            : 'Drag to rotate · scroll to zoom · right-drag to move'}
        </p>

        <div className="st-stage-actions">
          <button type="button" onClick={viewInRoom}><Smartphone size={14} /> View in your room</button>
          <button type="button" onClick={() => setModal('share')}><Share2 size={14} /> Share</button>
          <button type="button" className={showDims ? 'is-on' : ''} aria-pressed={showDims} onClick={() => setShowDims(v => !v)}><Ruler size={14} /> Measurements</button>
        </div>
        {loadError && <div className="st-viewer-msg" role="alert">{loadError} <button type="button" onClick={() => setLoadError(null)}>Dismiss</button></div>}
      </main>

      <aside className="st-panel" aria-label="Configure">
        <div className="st-card st-product">
          {sharedNote && <p className="st-shared">Shared design</p>}
          <h1>{model.name}</h1>
          <button type="button" className="st-price" onClick={() => setShowSummary(v => !v)} aria-expanded={showSummary}>
            {chf(price.total)} <small>incl. {model.vatRate * 100}% VAT{price.onRequest ? ' · some items priced on request' : ''}</small>
            <span className="st-price-toggle">{showSummary ? 'Hide' : 'Price details'} <ChevronDown size={12} className={showSummary ? 'is-up' : ''} /></span>
          </button>
          {showSummary && (
            <table className="st-summary">
              <tbody>
                {price.lines.map(l => <tr key={l.id}><td>{l.label}</td><td>{l.price === null ? 'on request' : chf(l.price)}</td></tr>)}
              </tbody>
            </table>
          )}
          {warnings.length > 0 && <ul className="st-issues">{warnings.map((w, i) => <li key={i} className={`is-${w.level}`}>{w.message}</li>)}</ul>}
          <div className="st-product-links">
            <a href={model.productUrl} target="_blank" rel="noreferrer">Product page <ExternalLink size={11} /></a>
            <button type="button" onClick={reset}><Undo2 size={11} /> Reset</button>
          </div>
        </div>

        <div className="st-card st-stepper">
          <button type="button" onClick={() => step(-1)} aria-label="Previous section"><ChevronLeft size={16} /></button>
          <span>{ALL[idx]?.label} <small>{idx + 1} / {ALL.length}</small></span>
          <button type="button" onClick={() => step(1)} aria-label="Next section"><ChevronRight size={16} /></button>
        </div>

        <div className="st-body">
          <nav className="st-rail" aria-label="Sections">
            {TABS[tab].sections.map(s => {
              const Icon = s.icon;
              return (
                <button key={s.id} type="button" className={section === s.id ? 'is-active' : ''} onClick={() => goTo(s.id)} aria-current={section === s.id}>
                  <Icon size={18} strokeWidth={1.6} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="st-card st-list" ref={listRef}>
            {TABS[tab].sections.map(s => {
              const Body = BODY[s.id];
              return (
                <Group key={s.id} id={s.id} title={s.label} open={open.has(s.id)} onToggle={() => flip(s.id)} refCb={el => { groupRefs.current[s.id] = el; }}>
                  <Body />
                </Group>
              );
            })}
          </div>
        </div>

        <div className="st-card st-actions">
          <button type="button" onClick={pdf} disabled={pdfBusy} aria-busy={pdfBusy}><Download size={14} /> {pdfBusy ? 'Preparing PDF…' : 'Download PDF quote'}</button>
          <button type="button" className="is-primary" onClick={() => setModal('quote')}><Send size={14} /> Request a quote</button>
        </div>
      </aside>

      {modal === 'room' && <RoomModal onClose={() => setModal(null)} />}
      {modal === 'quote' && <QuoteModal onClose={() => setModal(null)} />}
      {modal === 'share' && <ShareModal onClose={() => setModal(null)} />}
    </div>
  );
}
