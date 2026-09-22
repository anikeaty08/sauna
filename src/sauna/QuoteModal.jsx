import { useState } from 'react';
import { X, Send, CheckCircle2 } from 'lucide-react';
import { chf } from './format';

/** "Request a quote": posts name/email/phone/message + the full configuration
 *  to /api/quotes (persisted server-side); falls back to a mailto: draft if
 *  the request fails, so the customer can always reach us. */
export default function QuoteModal({ cfg, pricing, familyName, onClose, lang = 'en' }) {
  const isDe = lang === 'de';
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const [quoteId, setQuoteId] = useState('');

  const set = patch => setForm(f => ({ ...f, ...patch }));

  const mailtoFallback = () => {
    const subject = encodeURIComponent(`${isDe ? 'Offertanfrage' : 'Quote request'}: ${familyName} - CHF ${Math.round(pricing.total)}`);
    const body = encodeURIComponent(
      `${isDe ? 'Name' : 'Name'}: ${form.name}\n${isDe ? 'Telefon' : 'Phone'}: ${form.phone || '-'}\n\n` +
      `${familyName}, ${cfg.widthCm} x ${cfg.depthCm} x ${cfg.heightCm} cm\n${isDe ? 'Gesamtpreis' : 'Total'}: ${chf(pricing.total)}\n\n${form.message || ''}`
    );
    location.href = `mailto:info@holzsauna.ch?subject=${subject}&body=${body}`;
  };

  const submit = async e => {
    e.preventDefault();
    if (!form.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return;
    setState('sending');
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, configuration: cfg, totalChf: pricing.total }),
      });
      if (!res.ok) throw new Error('request failed');
      const data = await res.json();
      setQuoteId(data.id);
      setState('done');
    } catch {
      setState('error');
      mailtoFallback();
    }
  };

  return (
    <div className="quote-modal-backdrop" onClick={onClose}>
      <div className="quote-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={isDe ? 'Offerte anfragen' : 'Request a quote'}>
        <div className="quote-modal-head">
          <h3>{isDe ? 'Offerte anfragen' : 'Request a quote'}</h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label={isDe ? 'Schliessen' : 'Close'}><X /></button>
        </div>
        {state === 'done' ? (
          <div className="quote-done">
            <CheckCircle2 size={28} color="var(--pine)" />
            <p>{isDe ? 'Danke! Ihre Anfrage ist eingegangen.' : 'Thank you! Your request has been received.'}</p>
            <p className="quote-id">{isDe ? 'Referenz' : 'Reference'}: {quoteId.slice(0, 8)}</p>
            <button type="button" className="primary-button" onClick={onClose}>{isDe ? 'Schliessen' : 'Close'}</button>
          </div>
        ) : (
          <form onSubmit={submit} className="quote-form">
            <p className="quote-summary">{familyName} · {cfg.widthCm} x {cfg.depthCm} x {cfg.heightCm} cm · <b>{chf(pricing.total)}</b></p>
            <label>{isDe ? 'Name' : 'Name'} *<input required value={form.name} onChange={e => set({ name: e.target.value })} /></label>
            <label>{isDe ? 'E-Mail' : 'Email'} *<input required type="email" value={form.email} onChange={e => set({ email: e.target.value })} /></label>
            <label>{isDe ? 'Telefon' : 'Phone'}<input value={form.phone} onChange={e => set({ phone: e.target.value })} /></label>
            <label>{isDe ? 'Nachricht' : 'Message'}<textarea rows={3} value={form.message} onChange={e => set({ message: e.target.value })} /></label>
            {state === 'error' && <p className="quote-error">{isDe ? 'Senden fehlgeschlagen - ein E-Mail-Entwurf wurde geöffnet.' : 'Sending failed - an email draft was opened instead.'}</p>}
            <button type="submit" className="primary-button" disabled={state === 'sending'}>
              <Send size={14} />{state === 'sending' ? (isDe ? 'Wird gesendet…' : 'Sending…') : (isDe ? 'Anfrage senden' : 'Send request')}
            </button>
            <button type="button" className="text-button" onClick={mailtoFallback}>{isDe ? 'Oder per E-Mail senden' : 'Or send by email instead'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
