import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFit, cabin } from '../src/state.js';

const root = fileURLToPath(new URL('../', import.meta.url));

export function validateConfiguration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ['door', 'heater', 'angle', 'wall', 'bench'];
  return Object.keys(value).every(key => keys.includes(key)) &&
    ['left', 'right'].includes(value.door) && ['integrated', 'external'].includes(value.heater) &&
    typeof value.angle === 'number' && Number.isFinite(value.angle) && value.angle >= 0 && value.angle <= 90 &&
    typeof value.wall === 'boolean' && typeof value.bench === 'boolean';
}

/** A quote request from the sauna configurator: contact details + the full
 *  configuration + the price total shown to the customer at submit time. */
export function validateQuote(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!value.configuration || typeof value.configuration !== 'object') return false;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) return false;
  if (typeof value.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || value.email.length > 200) return false;
  if (value.phone !== undefined && (typeof value.phone !== 'string' || value.phone.length > 60)) return false;
  if (value.message !== undefined && (typeof value.message !== 'string' || value.message.length > 4000)) return false;
  if (value.totalChf !== undefined && (typeof value.totalChf !== 'number' || !Number.isFinite(value.totalChf))) return false;
  return true;
}

export function createApp({ databasePath = path.join(root, 'data', 'sauna.sqlite'), serveFrontend = false } = {}) {
  if (databasePath !== ':memory:') mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS designs (id TEXT PRIMARY KEY, configuration TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;');
  database.exec(`CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, message TEXT,
    configuration TEXT NOT NULL, total_chf REAL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL
  ) STRICT;`);
  const insert = database.prepare('INSERT INTO designs(id, configuration, created_at) VALUES (?, ?, ?)');
  const select = database.prepare('SELECT id, configuration, created_at FROM designs WHERE id = ?');
  const insertQuote = database.prepare('INSERT INTO quotes(id, name, email, phone, message, configuration, total_chf, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, \'new\', ?)');
  const selectQuote = database.prepare('SELECT id, name, email, phone, message, configuration, total_chf, status, created_at FROM quotes WHERE id = ?');
  // Shared designs: a short unique id that resolves to the full configurator
  // state, so customers get a compact link (/?d=abc123) instead of a URL blob.
  database.exec('CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, configuration TEXT NOT NULL, total_chf REAL, created_at TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0) STRICT;');
  const insertShare = database.prepare('INSERT INTO shares(id, configuration, total_chf, created_at) VALUES (?, ?, ?, ?)');
  const selectShare = database.prepare('SELECT id, configuration, total_chf, created_at FROM shares WHERE id = ?');
  const bumpShare = database.prepare('UPDATE shares SET hits = hits + 1 WHERE id = ?');
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  // Bound write frequency and memory; the app does not trust forwarded IP headers.
  const writes = new Map();
  app.use('/api', (req, res, next) => {
    if (req.method !== 'POST') return next();
    const now = Date.now();
    for (const [key, entry] of writes) if (now > entry.until) writes.delete(key);
    const key = req.ip;
    const entry = writes.get(key) ?? { count: 0, until: now + 60000 };
    if (entry.count >= 60 || (!writes.has(key) && writes.size >= 10000)) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    entry.count++; writes.set(key, entry); next();
  });
  app.get('/api/health', (req, res) => { database.prepare('SELECT 1').get(); res.json({ status: 'ok' }); });
  app.get('/api/catalog', (req, res) => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'output/blender/assets/asset-manifest.json'), 'utf8'));
    res.json({ id: 'sauna-140', name: 'Sauna 140', dimensions: cabin, powerKw: 3.6, assets: manifest.assets.map(({ id, file, bytes, triangles, sha256 }) => ({ id, url: `/assets/${file}?v=${sha256.slice(0, 12)}`, bytes, triangles })) });
  });
  app.post('/api/designs', (req, res) => {
    if (!validateConfiguration(req.body?.configuration)) return res.status(400).json({ error: 'A valid door, heater, angle and lighting configuration is required.' });
    const id = randomBytes(12).toString('hex');
    const createdAt = new Date().toISOString();
    insert.run(id, JSON.stringify(req.body.configuration), createdAt);
    res.status(201).json({ id, configuration: req.body.configuration, createdAt, path: `/?design=${id}` });
  });
  app.get('/api/designs/:id', (req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(404).json({ error: 'This design could not be found.' });
    const row = select.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'This design could not be found.' });
    res.json({ id: row.id, configuration: JSON.parse(row.configuration), createdAt: row.created_at });
  });
  app.post('/api/quotes', (req, res) => {
    if (!validateQuote(req.body)) return res.status(400).json({ error: 'A name, valid email and sauna configuration are required.' });
    const id = randomBytes(12).toString('hex');
    const createdAt = new Date().toISOString();
    const { name, email, phone, message, configuration, totalChf } = req.body;
    insertQuote.run(id, name.trim(), email.trim(), phone?.trim() || null, message?.trim() || null, JSON.stringify(configuration), totalChf ?? null, createdAt);
    console.log(`[quote] ${createdAt} new quote ${id} from ${email} - CHF ${totalChf ?? '?'}`);
    res.status(201).json({ id, createdAt });
  });
  app.post('/api/shares', (req, res) => {
    const configuration = req.body?.configuration;
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration) || typeof configuration.family !== 'string') {
      return res.status(400).json({ error: 'A sauna configuration is required.' });
    }
    const totalChf = typeof req.body.totalChf === 'number' && Number.isFinite(req.body.totalChf) ? req.body.totalChf : null;
    const id = randomBytes(6).toString('base64url');
    insertShare.run(id, JSON.stringify(configuration), totalChf, new Date().toISOString());
    res.status(201).json({ id, path: `/?d=${id}` });
  });
  app.get('/api/shares/:id', (req, res) => {
    if (!/^[A-Za-z0-9_-]{6,16}$/.test(req.params.id)) return res.status(404).json({ error: 'This shared design could not be found.' });
    const row = selectShare.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'This shared design could not be found.' });
    bumpShare.run(req.params.id);
    res.json({ id: row.id, configuration: JSON.parse(row.configuration), totalChf: row.total_chf, createdAt: row.created_at });
  });
  app.get('/api/quotes/:id', (req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(404).json({ error: 'This quote could not be found.' });
    const row = selectQuote.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'This quote could not be found.' });
    res.json({ id: row.id, name: row.name, email: row.email, phone: row.phone, message: row.message, configuration: JSON.parse(row.configuration), totalChf: row.total_chf, status: row.status, createdAt: row.created_at });
  });
  app.post('/api/fit', (req, res) => {
    const value = req.body;
    if (!value || ['width', 'depth', 'height'].some(key => typeof value[key] !== 'number') ||
      ['rotate', 'door'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean')) return res.status(400).json({ error: 'Provide numeric dimensions in centimetres and boolean options.' });
    const result = checkFit(value);
    res.status(result.status === 'invalid' ? 400 : 200).json(result);
  });
  // Google Scene Viewer and iOS Quick Look load the model themselves, so the selected
  // configuration has to exist as one file at a real URL rather than an in-page blob.
  const models = path.join(root, 'data', 'ar');
  mkdirSync(models, { recursive: true });
  app.post('/api/ar-model', express.raw({ type: 'model/gltf-binary', limit: '25mb' }), (req, res) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 12 || body.toString('utf8', 0, 4) !== 'glTF') return res.status(400).json({ error: 'A binary glTF body is required.' });
    const id = createHash('sha256').update(body).digest('hex').slice(0, 32);
    const file = path.join(models, `${id}.glb`);
    if (!existsSync(file)) writeFileSync(file, body);
    console.log(`[ar] ${new Date().toISOString()} published ${id}.glb ${body.length} bytes`);
    res.status(201).json({ id, path: `/ar/${id}.glb` });
  });
  // Scene Viewer fetches the model from the ARCore app, not the page, so logging this
  // request is the only way to tell a failed intent launch from a failed render.
  app.use('/ar', (req, res, next) => {
    const agent = req.get('user-agent') || 'none';
    const range = req.get('range') || '-';
    res.on('finish', () => console.log(`[ar] ${new Date().toISOString()} ${req.method} ${req.path} -> ${res.statusCode} range=${range} sent=${res.get('content-length') || '?'} ua="${agent}"`));
    next();
  });
  app.use('/ar', express.static(models, {
    maxAge: '1h', index: false, dotfiles: 'deny',
    setHeaders: res => { res.setHeader('Content-Type', 'model/gltf-binary'); res.setHeader('Access-Control-Allow-Origin', '*'); },
  }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  if (serveFrontend && existsSync(path.join(root, 'dist/index.html'))) {
    app.use(express.static(path.join(root, 'dist'), { maxAge: '1h', setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get('/', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
  }
  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    console.error('Request failed:', error.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return { app, close: () => database.close() };
}
