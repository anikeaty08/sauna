// Shareable links. Primary: a short unique id from the server (/?d=abc123)
// that resolves to the exact saved configuration. Fallback when the API is
// unreachable: the whole configuration encoded in the URL (/?c=<base64url>),
// which still restores the state without any backend.
import { toPresetConfig, fromPreset } from './config';

function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  return decodeURIComponent(escape(atob(b64)));
}
function cleanBase() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  return url;
}

/** Create the share URL for a configuration. Tries the server first for a short link. */
export async function createShareURL(cfg, totalChf) {
  const payload = toPresetConfig(cfg);
  try {
    const res = await fetch('/api/shares', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configuration: payload, totalChf }),
    });
    if (res.ok) {
      const { id } = await res.json();
      const url = cleanBase();
      url.searchParams.set('d', id);
      return { url: url.toString(), kind: 'short' };
    }
  } catch { /* offline or no API: fall through to the self-contained link */ }
  const url = cleanBase();
  url.searchParams.set('c', toBase64Url(JSON.stringify(payload)));
  return { url: url.toString(), kind: 'encoded' };
}

/** Restore a configuration from the current URL (?d=<id> or ?c=<encoded>). */
export async function loadSharedConfig(catalog) {
  const params = new URLSearchParams(location.search);
  const id = params.get('d');
  if (id && /^[A-Za-z0-9_-]{6,16}$/.test(id)) {
    try {
      const res = await fetch(`/api/shares/${id}`);
      if (res.ok) {
        const { configuration } = await res.json();
        if (configuration && catalog.families[configuration.family]) return fromPreset({ config: configuration });
      }
    } catch { /* fall through */ }
  }
  const encoded = params.get('c');
  if (encoded) {
    try {
      const config = JSON.parse(fromBase64Url(encoded));
      if (config && typeof config === 'object' && catalog.families[config.family]) return fromPreset({ config });
    } catch { /* invalid link */ }
  }
  return null;
}

export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the manual-copy fallback below */ }
  try {
    const el = document.createElement('textarea');
    el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.append(el); el.select();
    document.execCommand('copy');
    el.remove();
    return true;
  } catch { return false; }
}
