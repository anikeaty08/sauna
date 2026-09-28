import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, Mail, MessageCircle, Share2, Smartphone, X } from 'lucide-react';
import { useStudio } from '../../store/configurationStore.ts';
import { ensureArModel, requestQuote } from '../../services/saunaApi.ts';
import { useShareLink } from '../../features/sauna/hooks/useShareLink.ts';
import { chf } from '../../utils/format.ts';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="st-modal-backdrop" onClick={onClose}>
      <div className="st-modal" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <button type="button" className="st-modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** "View in your room": saves this exact design and shows it as a QR code for the phone. */
/** Phones open their own AR directly; desktops get a QR code for the phone. */
export const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * "View in your room" on desktop: saves the design, prepares its AR model in
 * the background, and shows a QR code that opens the AR page on the phone.
 */
export function RoomModal({ onClose }: { onClose: () => void }) {
  const link = useShareLink();
  const [img, setImg] = useState('');
  const [arUrl, setArUrl] = useState('');
  const [model, setModel] = useState<'preparing' | 'ready' | 'error'>('preparing');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await link.share();
      if (!r || cancelled) return;
      const url = `${location.origin}/studio/ar?c=${r.id}`;
      setArUrl(url);
      const QR = await import('qrcode');
      const data = await QR.toDataURL(url, { margin: 1, width: 360, color: { dark: '#1c1c1c', light: '#ffffff' } });
      if (!cancelled) setImg(data);
      ensureArModel(r.id, useStudio.getState().config)
        .then(() => !cancelled && setModel('ready'))
        .catch(() => !cancelled && setModel('error'));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal title="View in your room" onClose={onClose}>
      <p>Scan with your phone's camera to see this exact sauna in your room, at its real size.</p>
      <div className="st-qr">
        {!img && !link.error && <span className="st-qr-wait">Preparing link…</span>}
        {img && <img src={img} alt="QR code that opens this sauna in AR on your phone" />}
        {!img && link.error && <span className="st-qr-wait">{link.error}</span>}
      </div>
      {arUrl && <a className="st-modal-link" href={arUrl}>{arUrl.replace(/^https?:\/\//, '')}</a>}
      <p className="st-modal-note"><Smartphone size={13} /> {model === 'ready' ? 'Ready: works with iPhone (Quick Look) and Android (Google AR).' : model === 'error' ? 'The AR model will be prepared on your phone instead.' : 'Preparing the 3D model for AR…'}</p>
    </Modal>
  );
}

/** Request a quote: the configuration is saved and re-priced by the server first. */
export function QuoteModal({ onClose }: { onClose: () => void }) {
  const price = useStudio(s => s.price);
  const link = useShareLink();
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [state, setState] = useState<{ busy: boolean; done: string | null; error: string | null }>({ busy: false, done: null, error: null });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState({ busy: true, done: null, error: null });
    try {
      const saved = await link.share();
      if (!saved) throw new Error(link.error || 'The configuration could not be saved.');
      const r = await requestQuote({ configurationId: saved.id, ...form });
      setState({ busy: false, done: r.id, error: null });
    } catch (err) {
      setState({ busy: false, done: null, error: (err as Error).message });
    }
  };
  const field = (k: keyof typeof form, label: string, type = 'text', required = false) => (
    <label className="st-field"><span>{label}{required ? ' *' : ''}</span>
      {k === 'message'
        ? <textarea rows={3} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} maxLength={4000} />
        : <input type={type} required={required} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} maxLength={200} />}
    </label>
  );
  return (
    <Modal title="Request a quote" onClose={onClose}>
      {state.done ? (
        <p>Thank you - HolzSauna will get back to you. Reference <b>{state.done.slice(0, 8)}</b>.</p>
      ) : (
        <form className="st-form" onSubmit={submit}>
          <p>{chf(price.total)} incl. VAT{price.onRequest ? ' plus items on request' : ''}.</p>
          {field('name', 'Name', 'text', true)}
          {field('email', 'Email', 'email', true)}
          {field('phone', 'Phone', 'tel')}
          {field('message', 'Message')}
          {state.error && <p className="st-error" role="alert">{state.error}</p>}
          <button type="submit" className="st-submit" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send request'}</button>
        </form>
      )}
    </Modal>
  );
}

/** Shareable link: copy, native share sheet, WhatsApp and email. */
export function ShareModal({ onClose }: { onClose: () => void }) {
  const { model, config, price } = useStudio();
  const link = useShareLink();
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { link.share(); /* once, for the design as it is now */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const heater = model.options.heaterSet.find(h => h.id === config.heaterSet);
  const summary = `${model.name}, ${config.dimensions.widthCm} × ${config.dimensions.depthCm} cm, ${heater?.id === 'none' ? 'without heater' : heater?.name.replace(/^Set: /, '').split(',')[0]} - ${chf(price.total)}${price.onRequest ? ' + on request' : ''}`;
  const url = link.link?.url ?? '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); }
    catch { input.current?.select(); document.execCommand('copy'); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const nativeShare = () => navigator.share?.({ title: model.name, text: summary, url }).catch(() => {});
  return (
    <Modal title="Share this design" onClose={onClose}>
      <p>{summary}</p>
      {link.busy && <p className="st-qr-wait">Creating link…</p>}
      {link.error && <p className="st-error" role="alert">{link.error}</p>}
      {url && (
        <>
          <div className="st-share-row">
            <input ref={input} className="st-share-url" value={url} readOnly aria-label="Shareable link" onFocus={e => e.currentTarget.select()} />
            <button type="button" className="st-share-copy" onClick={copy}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button>
          </div>
          <div className="st-share-targets">
            {typeof navigator.share === 'function' && <button type="button" onClick={nativeShare}><Share2 size={14} /> Share…</button>}
            <a href={`https://wa.me/?text=${encodeURIComponent(`${summary}
${url}`)}`} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>
            <a href={`mailto:?subject=${encodeURIComponent(model.name)}&body=${encodeURIComponent(`${summary}

${url}`)}`}><Mail size={14} /> Email</a>
          </div>
          <p className="st-modal-note">This link is a snapshot: changes you make afterwards get a new link.</p>
        </>
      )}
    </Modal>
  );
}
