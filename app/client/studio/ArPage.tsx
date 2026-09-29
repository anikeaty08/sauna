/**
 * /studio/ar?c=<id> - "View in your room", the way web shops do it: the phone's
 * own AR viewer shows the exact configured sauna on the floor at true size.
 *   iPhone / iPad  -> Quick Look with our USDZ (scaling locked)
 *   Android        -> Scene Viewer with our GLB (resizing off)
 *   desktop        -> a QR code that opens this page on the phone
 * Before opening AR, the page shows a turning 3D preview (outside / inside), the
 * chosen options and a door open / closed choice (each door state is its own
 * AR model, exported on first use).
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, DoorClosed, DoorOpen, Footprints, Smartphone } from 'lucide-react';
import { useStudio } from './store/configurationStore.ts';
import { SaunaViewer } from './components/viewer/SaunaViewer.tsx';
import { arFiles, arViewUrl, ensureArModel, getConfiguration, shareConfiguration } from './services/saunaApi.ts';
import { chf } from './utils/format.ts';
import './styles/configurator.css';

type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  // Quick Look is detected by the <a rel="ar"> capability, not the user agent alone.
  if (document.createElement('a').relList?.supports?.('ar')) return 'ios';
  if (/android/i.test(navigator.userAgent)) return 'android';
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

export function sceneViewerIntent(glbUrl: string, title: string, backUrl: string): string {
  const params = new URLSearchParams({ file: glbUrl, mode: 'ar_preferred', resizable: 'false', title, link: backUrl });
  return `intent://arvr.google.com/scene-viewer/1.2?${params.toString()}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(backUrl)};end;`;
}

type Status = { status: 'loading' | 'preparing' | 'ready' | 'error'; message: string };

export default function ArPage() {
  const { model, config, price, load, tab, setTab, doorOpen, toggleDoor, setTurntable } = useStudio();
  const [platform] = useState<Platform>(detectPlatform);
  const [id, setId] = useState<string | null>(() => new URLSearchParams(location.search).get('c'));
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<Status>({ status: 'loading', message: 'Loading your design…' });
  const [qr, setQr] = useState('');
  const quickLook = useRef<HTMLAnchorElement>(null);

  // The preview turns slowly on its own while showing the outside.
  useEffect(() => { setTurntable(true); return () => setTurntable(false); }, [setTurntable]);

  // 1. load the saved design
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!id) throw new Error('This link has no design in it. Open "View in your room" from the studio.');
        const r = await getConfiguration(id);
        if (cancelled) return;
        load(r.configuration);
        setLoaded(true);
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: (e as Error).message || 'This design could not be loaded.' });
      }
    })();
    return () => { cancelled = true; };
  }, [id, load]);

  // 2. make sure the AR model for the chosen door state exists
  useEffect(() => {
    if (!loaded || !id) return;
    let cancelled = false;
    setState({ status: 'preparing', message: doorOpen ? 'Preparing the model with the door open…' : 'Preparing the 3D model for your room…' });
    (async () => {
      try {
        try {
          await ensureArModel(id, useStudio.getState().config, doorOpen);
        } catch {
          // Last resort (e.g. the link's files are broken): a fresh snapshot of
          // the same design. Always switch to it - even if the customer changed
          // the door meanwhile - so the page never retries the old link.
          const fresh = await shareConfiguration(useStudio.getState().config, { fresh: true });
          await ensureArModel(fresh.id, useStudio.getState().config, doorOpen);
          history.replaceState(null, '', `/studio/ar?c=${fresh.id}`);
          setId(fresh.id);
        }
        if (!cancelled) setState({ status: 'ready', message: '' });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: (e as Error).message || 'The AR model could not be prepared.' });
      }
    })();
    return () => { cancelled = true; };
  }, [loaded, id, doorOpen]);

  useEffect(() => {
    if (platform !== 'desktop') return;
    import('qrcode').then(QR => QR.toDataURL(location.href, { margin: 1, width: 360, color: { dark: '#1c1c1c', light: '#ffffff' } })).then(setQr).catch(() => {});
  }, [platform, id]);

  const heater = model.options.heaterSet.find(h => h.id === config.heaterSet);
  const wood = model.options.benchWood.find(w => w.id === config.materials.benchWood);
  const extras = config.accessories.map(a => model.options.accessories.find(o => o.id === a)?.name.split(' (')[0]).filter(Boolean);
  const title = `${model.name} ${config.dimensions.widthCm} × ${config.dimensions.depthCm} cm`;
  const studioUrl = id ? `${location.origin}/studio?c=${id}` : `${location.origin}/studio`;
  const ready = state.status === 'ready' && id;
  const files = arFiles(doorOpen);

  const open = () => {
    if (!ready) return;
    if (platform === 'ios') quickLook.current?.click();
    else location.href = sceneViewerIntent(arViewUrl(id!, files.glb), title, studioUrl);
  };

  return (
    <div className="ar-page">
      <header className="ar-head">
        <a href={studioUrl} className="ar-back"><ArrowLeft size={16} /> Back to the configurator</a>
        <img src="/assets/images/logo.gif" alt="HolzSauna" />
      </header>

      <main className="ar-main">
        <section className="ar-card">
          <p className="ar-kicker">View in your room</p>
          <h1>{title}</h1>
          <ul className="ar-specs">
            <li><span>Size</span>{config.dimensions.widthCm} × {config.dimensions.depthCm} × {model.dimensions.heightMm / 10} cm</li>
            <li><span>Benches</span>{wood?.name.split(',')[0]}</li>
            <li><span>Heater</span>{heater?.id === 'none' ? 'Without heater' : heater?.name.replace(/^Set: /, '').split(',')[0]}</li>
            {extras.length > 0 && <li><span>Extras</span>{extras.join(', ')}</li>}
          </ul>
          <p className="ar-price">{chf(price.total)} <small>incl. {model.vatRate * 100}% VAT{price.onRequest ? ' · some items priced on request' : ''}</small></p>

          <div className="ar-door" role="radiogroup" aria-label="Door in AR">
            <span>Door</span>
            <button type="button" role="radio" aria-checked={!doorOpen} className={!doorOpen ? 'is-on' : ''} onClick={() => doorOpen && toggleDoor()}><DoorClosed size={15} /> Closed</button>
            <button type="button" role="radio" aria-checked={doorOpen} className={doorOpen ? 'is-on' : ''} onClick={() => !doorOpen && toggleDoor()}><DoorOpen size={15} /> Open</button>
          </div>

          {platform === 'desktop' ? (
            <div className="ar-qr-block">
              <div className="ar-qr">{qr ? <img src={qr} alt="QR code to open this design in AR on your phone" /> : <span>Preparing QR code…</span>}</div>
              <p><Smartphone size={14} /> Scan with your phone's camera to place this sauna in your room at its real size.</p>
            </div>
          ) : (
            <>
              <button type="button" className="ar-cta" onClick={open} disabled={!ready} aria-busy={!ready}>
                <Box size={18} /> {ready ? 'View in your room' : state.status === 'error' ? 'Not available' : 'Preparing…'}
              </button>
              {/* Quick Look needs a real <a rel="ar"> with an <img> child. */}
              {platform === 'ios' && ready && (
                <a ref={quickLook} rel="ar" href={`${arViewUrl(id!, files.usdz)}#allowsContentScaling=0`} className="ar-hidden" aria-hidden="true" tabIndex={-1}>
                  <img alt="" src="/assets/images/logo.gif" />
                </a>
              )}
            </>
          )}
          {state.message && <p className={`ar-status${state.status === 'error' ? ' is-error' : ''}`} role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>}

          <ol className="ar-steps">
            <li>Point your phone at the floor where the sauna should go and move it slowly.</li>
            <li>The sauna appears at its real size ({config.dimensions.widthCm} × {config.dimensions.depthCm} × {model.dimensions.heightMm / 10} cm) - it cannot be scaled.</li>
            <li>Drag to move it, twist with two fingers to turn it, and walk around it.</li>
          </ol>
          <p className="ar-walkin"><Footprints size={15} /> Have the space? Walk into the sauna with your phone to look around inside - benches, heater and lights are all there.</p>
        </section>

        <section className="ar-preview" aria-label="3D preview">
          <SaunaViewer />
          <div className="ar-view-toggle" role="tablist" aria-label="Preview">
            <button type="button" role="tab" aria-selected={tab === 'exterior'} className={tab === 'exterior' ? 'is-on' : ''} onClick={() => setTab('exterior')}>Outside</button>
            <button type="button" role="tab" aria-selected={tab === 'interior'} className={tab === 'interior' ? 'is-on' : ''} onClick={() => setTab('interior')}>Inside</button>
          </div>
        </section>
      </main>
    </div>
  );
}
