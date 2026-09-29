/**
 * Production studio API (mounted at /api/studio). Isolated from the legacy
 * demo endpoints: own router, own tables. Validation and pricing come from the
 * shared configuration-core package, so the server re-prices every save and
 * never trusts a total sent by the browser.
 *
 *   GET  /saunas                       model registry summary
 *   GET  /saunas/:modelId              full product definition + compatible modules
 *   GET  /modules?model=               module registry
 *   POST /configurations/validate      { configuration } -> { valid, issues, configuration, price }
 *   POST /configurations               save -> 201 { id, editToken, path }
 *   GET  /configurations/:id           read by unguessable id
 *   PUT  /configurations/:id           update; header X-Edit-Token
 *   POST /quote-requests               { configurationId, name, email, phone?, message? }
 *   GET  /configurations/:id/quote.pdf printable quote with the dimensioned floor plan
 *   PUT  /configurations/:id/ar/:file  model.glb | model.usdz, write-once within 30 min of creation
 *   GET  /configurations/:id/ar/:file  the phone's AR viewers download these (public, immutable)
 */
import express, { Router, type Request, type Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeQuotePdf } from './quotePdf.ts';
import { sceneViewerSafeGlb } from './sceneViewerGlb.ts';
import {
  MODEL_REGISTRY, MODULES, modulesForModel, normalizeConfiguration, priceConfiguration, validateConfiguration,
  type SaunaConfiguration,
} from '../../../packages/configuration-core/index.ts';

const ID = /^[A-Za-z0-9_-]{12}$/;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const now = () => new Date().toISOString();

function checkConfiguration(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'A configuration object is required.' as const };
  const cfg = raw as Partial<SaunaConfiguration>;
  const model = cfg.modelId ? MODEL_REGISTRY[cfg.modelId] : undefined;
  if (!model) return { error: 'Unknown sauna model.' as const };
  const { valid, issues } = validateConfiguration(model, cfg as SaunaConfiguration);
  return { model, configuration: cfg as SaunaConfiguration, valid, issues, price: valid ? priceConfiguration(model, cfg as SaunaConfiguration) : null };
}

/** The files the phone's own AR viewers need, per snapshot link (door closed / open). */
const GLB = { type: 'model/gltf-binary', maxBytes: 30 * 1024 * 1024, magic: 'glTF' };
const USDZ = { type: 'model/vnd.usdz+zip', maxBytes: 40 * 1024 * 1024, magic: 'PK' };
const AR_FILES: Record<string, { type: string; maxBytes: number; magic: string }> = {
  // current export format: baked light layers, relief maps, door closed or open
  'sauna-v4.glb': GLB, 'sauna-v4.usdz': USDZ,
  'sauna-v4-open.glb': GLB, 'sauna-v4-open.usdz': USDZ,
  // earlier exports, still served for old links
  'sauna-v3.glb': GLB, 'sauna-v3.usdz': USDZ,
  'model.glb': { type: 'model/gltf-binary', maxBytes: 30 * 1024 * 1024, magic: 'glTF' },
  'model.usdz': { type: 'model/vnd.usdz+zip', maxBytes: 40 * 1024 * 1024, magic: 'PK' },
};
const UPLOAD_WINDOW_MS = 30 * 60 * 1000;

export function createStudioRouter(database: DatabaseSync, opts: { dataDir?: string } = {}): Router {
  const arDir = path.join(opts.dataDir ?? path.join(tmpdir(), 'sauna-studio'), 'studio-ar');
  database.exec(`CREATE TABLE IF NOT EXISTS studio_configurations (
    id TEXT PRIMARY KEY, model_id TEXT NOT NULL, model_version TEXT NOT NULL, configuration TEXT NOT NULL,
    price_chf REAL NOT NULL, price_on_request INTEGER NOT NULL, edit_token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;`);
  database.exec(`CREATE TABLE IF NOT EXISTS studio_quote_requests (
    id TEXT PRIMARY KEY, configuration_id TEXT NOT NULL REFERENCES studio_configurations(id),
    name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, message TEXT,
    price_chf REAL NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL
  ) STRICT;`);
  const insert = database.prepare('INSERT INTO studio_configurations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const select = database.prepare('SELECT * FROM studio_configurations WHERE id = ?');
  const update = database.prepare('UPDATE studio_configurations SET model_version = ?, configuration = ?, price_chf = ?, price_on_request = ?, updated_at = ? WHERE id = ?');
  const insertQuote = database.prepare('INSERT INTO studio_quote_requests (id, configuration_id, name, email, phone, message, price_chf, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

  const router = Router();
  const reject = (res: Response, status: number, error: string, issues: unknown[] = []) => res.status(status).json({ error, issues });

  router.get('/saunas', (_req, res) => {
    res.json(Object.values(MODEL_REGISTRY).map(m => ({ id: m.id, name: m.name, version: m.version, productUrl: m.productUrl, basePrice: m.basePrice, currency: m.currency })));
  });
  router.get('/saunas/:modelId', (req, res) => {
    const model = MODEL_REGISTRY[req.params.modelId];
    if (!model) return reject(res, 404, 'Unknown sauna model.');
    res.json({ ...model, modules: modulesForModel(model.id) });
  });
  router.get('/modules', (req, res) => {
    const model = typeof req.query.model === 'string' ? req.query.model : null;
    res.json(model ? modulesForModel(model) : Object.values(MODULES));
  });

  router.post('/configurations/validate', (req, res) => {
    const r = checkConfiguration(req.body?.configuration);
    if ('error' in r) return reject(res, 400, r.error);
    res.json({ valid: r.valid, issues: r.issues, configuration: normalizeConfiguration(r.model, r.configuration), price: r.price });
  });

  router.post('/configurations', (req, res) => {
    const r = checkConfiguration(req.body?.configuration);
    if ('error' in r) return reject(res, 400, r.error);
    if (!r.valid || !r.price) return reject(res, 400, 'The configuration is not valid.', r.issues);
    const id = randomBytes(9).toString('base64url');
    const editToken = randomBytes(24).toString('base64url');
    const t = now();
    insert.run(id, r.model.id, r.model.version, JSON.stringify(r.configuration), r.price.total, r.price.onRequest ? 1 : 0, hash(editToken), t, t);
    res.status(201).json({ id, editToken, path: `/studio?c=${id}`, price: r.price });
  });

  router.get('/configurations/:id', (req, res) => {
    const row = ID.test(req.params.id) ? select.get(req.params.id) as Record<string, string | number> | undefined : undefined;
    if (!row) return reject(res, 404, 'This configuration could not be found.');
    const model = MODEL_REGISTRY[String(row.model_id)];
    if (!model) return reject(res, 409, 'This sauna model is no longer available.');
    const configuration = JSON.parse(String(row.configuration)) as SaunaConfiguration;
    res.json({ id: row.id, modelVersion: row.model_version, configuration, price: priceConfiguration(model, normalizeConfiguration(model, configuration)), createdAt: row.created_at, updatedAt: row.updated_at });
  });

  router.put('/configurations/:id', (req: Request, res: Response) => {
    const row = ID.test(req.params.id) ? select.get(req.params.id) as Record<string, string> | undefined : undefined;
    if (!row) return reject(res, 404, 'This configuration could not be found.');
    const token = req.get('X-Edit-Token') ?? '';
    const a = Buffer.from(hash(token)), b = Buffer.from(row.edit_token_hash);
    if (!token || a.length !== b.length || !timingSafeEqual(a, b)) return reject(res, 403, 'Not allowed to edit this configuration.');
    const r = checkConfiguration(req.body?.configuration);
    if ('error' in r) return reject(res, 400, r.error);
    if (!r.valid || !r.price) return reject(res, 400, 'The configuration is not valid.', r.issues);
    update.run(r.model.version, JSON.stringify(r.configuration), r.price.total, r.price.onRequest ? 1 : 0, now(), req.params.id);
    res.json({ id: req.params.id, price: r.price });
  });

  router.post('/quote-requests', (req, res) => {
    const { configurationId, name, email, phone, message } = req.body ?? {};
    const str = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    if (!str(name, 200) || !str(email, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reject(res, 400, 'A name and a valid email are required.');
    if ((phone !== undefined && phone !== '' && !str(phone, 60)) || (message !== undefined && message !== '' && !str(message, 4000))) return reject(res, 400, 'Phone or message is too long.');
    const row = typeof configurationId === 'string' && ID.test(configurationId) ? select.get(configurationId) as Record<string, number> | undefined : undefined;
    if (!row) return reject(res, 400, 'Save the configuration before requesting a quote.');
    const id = randomBytes(12).toString('hex');
    insertQuote.run(id, configurationId, name.trim(), email.trim(), phone?.trim() || null, message?.trim() || null, row.price_chf, now());
    console.log(`[studio-quote] ${now()} ${id} for configuration ${configurationId} - CHF ${row.price_chf}`);
    res.status(201).json({ id });
  });

  // ── PDF quote ───────────────────────────────────────────────────────────
  router.get('/configurations/:id/quote.pdf', (req, res) => {
    const row = ID.test(req.params.id) ? select.get(req.params.id) as Record<string, string> | undefined : undefined;
    const model = row && MODEL_REGISTRY[row.model_id];
    if (!row || !model) return reject(res, 404, 'This configuration could not be found.');
    const config = normalizeConfiguration(model, JSON.parse(row.configuration));
    const host = req.get('host') ?? 'localhost';
    const proto = req.get('x-forwarded-proto') ?? (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
    res.type('application/pdf');
    // Sent as a file download (the studio's "PDF quote" saves it directly).
    res.setHeader('Content-Disposition', `attachment; filename="HolzSauna-Quotation-Zirbe-6-Eck-${config.dimensions.widthCm}x${config.dimensions.depthCm}-${row.id}.pdf"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    writeQuotePdf(res, model, config, { id: row.id, url: `${proto}://${host}/studio?c=${row.id}`, date: new Date() });
  });

  // ── AR files (View in your room) ─────────────────────────────────────────
  // Links never change, so each link's model is uploaded once, right after the
  // link is made, and then served as an immutable public file: Scene Viewer
  // downloads it itself from a public HTTPS URL.
  const arPath = (id: string, file: string) => path.join(arDir, id, file);
  router.put('/configurations/:id/ar/:file', express.raw({ type: () => true, limit: '40mb' }), (req, res) => {
    const spec = AR_FILES[req.params.file];
    if (!spec) return reject(res, 404, 'Unknown AR file.');
    const row = ID.test(req.params.id) ? select.get(req.params.id) as Record<string, string> | undefined : undefined;
    if (!row) return reject(res, 404, 'This configuration could not be found.');
    const target = arPath(req.params.id, req.params.file);
    if (existsSync(target)) return reject(res, 409, 'This AR file already exists.');
    if (Date.now() - Date.parse(row.created_at) > UPLOAD_WINDOW_MS) return reject(res, 403, 'The upload window for this link has closed.');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 16 || body.length > spec.maxBytes) return reject(res, 400, 'The file is empty or too large.');
    if (body.subarray(0, spec.magic.length).toString('latin1') !== spec.magic) return reject(res, 400, 'The file is not a valid model.');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, spec.magic === 'glTF' ? sceneViewerSafeGlb(body) : body, { flag: 'wx' });
    res.status(201).json({ url: `/api/studio/configurations/${req.params.id}/ar/${req.params.file}` });
  });
  const serveAr = (req: Request, res: Response) => {
    const spec = AR_FILES[String(req.params.file)];
    const id = String(req.params.id);
    if (!spec || !ID.test(id) || !existsSync(arPath(id, String(req.params.file)))) return reject(res, 404, 'No AR model for this link yet.');
    // A day, not immutable: a model stored by an older export is cleaned on the way out.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const file = arPath(id, String(req.params.file));
    // Scene Viewer rejects unsupported glTF extensions; older uploads may carry one.
    if (spec.magic === 'glTF') return res.type(spec.type).send(sceneViewerSafeGlb(readFileSync(file)));
    res.type(spec.type).sendFile(file);
  };
  router.get('/configurations/:id/ar/:file', serveAr);
  router.head('/configurations/:id/ar/:file', serveAr);

  return router;
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * The /studio page with link-preview tags for a shared design (/studio?c=<id>),
 * so WhatsApp, Slack or email show the model, size and price.
 */
export function studioPageHtml(database: DatabaseSync, shellHtml: string, id: unknown): string {
  let title = 'Designsauna Zirbe 6-Eck — 3D configurator';
  let description = 'Configure the HolzSauna Zirbe 6-Eck with glass front and slate in 3D, with the live Swiss-franc price.';
  if (typeof id === 'string' && ID.test(id)) {
    const row = database.prepare('SELECT model_id, configuration FROM studio_configurations WHERE id = ?').get(id) as Record<string, string> | undefined;
    const model = row && MODEL_REGISTRY[row.model_id];
    if (row && model) {
      const cfg = normalizeConfiguration(model, JSON.parse(row.configuration));
      const price = priceConfiguration(model, cfg);
      const heater = model.options.heaterSet.find(h => h.id === cfg.heaterSet);
      title = `${model.name} ${cfg.dimensions.widthCm} × ${cfg.dimensions.depthCm} cm — shared design`;
      description = `${heater && heater.id !== 'none' ? heater.name.replace(/^Set: /, '').split(',')[0] : 'Without heater'} · ${model.options.benchWood.find(w => w.id === cfg.materials.benchWood)?.name.split(',')[0]} benches · CHF ${Math.round(price.total).toLocaleString('de-CH').replace(/,/g, "'")}${price.onRequest ? ' + on request' : ''} incl. VAT`;
    }
  }
  const t = escapeHtml(title), d = escapeHtml(description);
  return shellHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta name="description" content=")[^"]*"/, `$1${d}"`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${t}"`)
    .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${d}"`);
}
