import type { PriceResult, SaunaConfiguration } from '../../../../packages/configuration-core/index.ts';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { issues: body.issues ?? [] });
  return body as T;
}

export interface SavedLink { id: string; url: string; price: PriceResult }

/** Stable JSON of a configuration, so identical designs map to the same link. */
const fingerprint = (c: SaunaConfiguration) =>
  JSON.stringify({ ...c, accessories: [...c.accessories].sort() });

const LINKS = 'studio.sharedLinks';
const readLinks = (): Record<string, { id: string; url: string }> => { try { return JSON.parse(sessionStorage.getItem(LINKS) || '{}'); } catch { return {}; } };

/**
 * Shareable link for the current design. Links are snapshots: once a link is
 * shared it never changes, so the person who receives it sees exactly what was
 * sent. Sharing the same design again reuses its link; any edit gets a new one.
 */
export async function shareConfiguration(configuration: SaunaConfiguration): Promise<SavedLink> {
  const key = fingerprint(configuration);
  const known = readLinks()[key];
  if (known) {
    const r = await getConfiguration(known.id).catch(() => null);
    if (r) return { id: known.id, url: known.url, price: r.price };
  }
  const r = await request<{ id: string; editToken: string; path: string; price: PriceResult }>('/api/studio/configurations', { method: 'POST', body: JSON.stringify({ configuration }) });
  const saved = { id: r.id, url: `${location.origin}${r.path}` };
  try { sessionStorage.setItem(LINKS, JSON.stringify({ ...readLinks(), [key]: saved })); } catch { /* storage unavailable */ }
  return { ...saved, price: r.price };
}

/** Remember the link a design was opened from, so re-sharing it unchanged reuses that link. */
export function rememberLink(configuration: SaunaConfiguration, id: string) {
  try { sessionStorage.setItem(LINKS, JSON.stringify({ ...readLinks(), [fingerprint(configuration)]: { id, url: `${location.origin}/studio?c=${id}` } })); } catch { /* storage unavailable */ }
}

export const sameDesign = (a: SaunaConfiguration, b: SaunaConfiguration) => fingerprint(a) === fingerprint(b);

export const getConfiguration = (id: string) =>
  request<{ id: string; configuration: SaunaConfiguration; price: PriceResult }>(`/api/studio/configurations/${encodeURIComponent(id)}`);

export const requestQuote = (payload: { configurationId: string; name: string; email: string; phone?: string; message?: string }) =>
  request<{ id: string }>('/api/studio/quote-requests', { method: 'POST', body: JSON.stringify(payload) });

export const arFileUrl = (id: string, file: 'model.glb' | 'model.usdz') => `${location.origin}/api/studio/configurations/${encodeURIComponent(id)}/ar/${file}`;

/** True when both AR files exist for this link. */
export async function hasArModel(id: string): Promise<boolean> {
  const heads = await Promise.all((['model.glb', 'model.usdz'] as const).map(f => fetch(arFileUrl(id, f), { method: 'HEAD' }).then(r => r.ok).catch(() => false)));
  return heads.every(Boolean);
}

/**
 * Make sure the phone's AR viewers have this link's model: export the exact
 * configured sauna in the browser and upload it once. Files that already
 * exist are kept (a link never changes).
 */
export async function ensureArModel(id: string, configuration: SaunaConfiguration): Promise<void> {
  if (await hasArModel(id)) return;
  const [{ exportArModel }, { computeLayout, MODEL_REGISTRY }] = await Promise.all([
    import('../features/sauna/ar/exportArModel.ts'),
    import('../../../../packages/configuration-core/index.ts'),
  ]);
  const layout = computeLayout(MODEL_REGISTRY[configuration.modelId], configuration);
  const { glb, usdz } = await exportArModel(configuration, layout);
  for (const [file, data, type] of [['model.glb', glb, 'model/gltf-binary'], ['model.usdz', usdz, 'model/vnd.usdz+zip']] as const) {
    const res = await fetch(arFileUrl(id, file), { method: 'PUT', body: new Blob([data as BlobPart], { type }), headers: { 'Content-Type': type } });
    if (!res.ok && res.status !== 409) throw new Error((await res.json().catch(() => ({}))).error || 'The AR model could not be uploaded.');
  }
}
