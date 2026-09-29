/**
 * /studio/ar?c=<id> - "View in your room", the way web shops do it: the phone's
 * own AR viewer shows the exact configured sauna on the floor at true size.
 *   iPhone / iPad  -> Quick Look with our USDZ (scaling locked)
 *   Android        -> Scene Viewer with our GLB (resizing off)
 *   desktop        -> a QR code that opens this page on the phone
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, Smartphone } from 'lucide-react';
import { useStudio } from './store/configurationStore.ts';
import { SaunaViewer } from './components/viewer/SaunaViewer.tsx';
import { AR_GLB, AR_USDZ, arViewUrl, ensureArModel, getConfiguration, shareConfiguration } from './services/saunaApi.ts';
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

export default function ArPage() {
  const { model, config, price, load } = useStudio();
  const [platform] = useState<Platform>(detectPlatform);
  const [id, setId] = useState<string | null>(() => new URLSearchParams(location.search).get('c'));
  const [state, setState] = useState<{ status: 'loading' | 'preparing' | 'ready' | 'error'; message: string }>({ status: 'loading', message: 'Loading your design…' });
  const [qr, setQr] = useState('');
  const quickLook = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!id) throw new Error('This link has no design in it. Open "View in your room" from the studio.');
        const r = await getConfiguration(id);
        if (cancelled) return;
        load(r.configuration);
        setState({ status: 'preparing', message: 'Preparing the 3D model for your room…' });
        try {
          await ensureArModel(id, useStudio.getState().config);
        } catch {
          // An older link whose upload window has closed: make a fresh snapshot of
          // the same design and use that one (identical content, new files).
          const fresh = await shareConfiguration(useStudio.getState().config);
          await ensureArModel(fresh.id, useStudio.getState().config);
          history.replaceState(null, '', `/studio/ar?c=${fresh.id}`);
          if (!cancelled) setId(fresh.id);
        }
        if (!cancelled) setState({ status: 'ready', message: '' });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: (e as Error).message || 'The AR model could not be prepared.' });
      }
    })();
    return () => { cancelled = true; };
  }, [id, load]);

  useEffect(() => {
    if (platform !== 'desktop') return;
    import('qrcode').then(QR => QR.toDataURL(location.href, { margin: 1, width: 360, color: { dark: '#1c1c1c', light: '#ffffff' } })).then(setQr).catch(() => {});
  }, [platform, id]);

  const heater = model.options.heaterSet.find(h => h.id === config.heaterSet);
  const title = `${model.name} ${config.dimensions.widthCm} × ${config.dimensions.depthCm} cm`;
  const studioUrl = id ? `${location.origin}/studio?c=${id}` : `${location.origin}/studio`;
  const ready = state.status === 'ready' && id;

  const open = () => {
    if (!ready) return;
    if (platform === 'ios') quickLook.current?.click();
    else location.href = sceneViewerIntent(arViewUrl(id!, AR_GLB), title, studioUrl);
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
          <p className="ar-meta">{heater?.id === 'none' ? 'Without heater' : heater?.name.replace(/^Set: /, '').split(',')[0]} · {model.options.benchWood.find(w => w.id === config.materials.benchWood)?.name.split(',')[0]} benches</p>
          <p className="ar-price">{chf(price.total)} <small>incl. {model.vatRate * 100}% VAT{price.onRequest ? ' · + on request' : ''}</small></p>

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
                <a ref={quickLook} rel="ar" href={`${arViewUrl(id!, AR_USDZ)}#allowsContentScaling=0`} className="ar-hidden" aria-hidden="true" tabIndex={-1}>
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
        </section>

        <section className="ar-preview" aria-label="3D preview">
          <SaunaViewer />
        </section>
      </main>
    </div>
  );
}
