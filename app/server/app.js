import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

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
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  database.exec(`CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, message TEXT,
    configuration TEXT NOT NULL, total_chf REAL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL
  ) STRICT;`);
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

  app.post('/api/quotes', (req, res) => {
    if (!validateQuote(req.body)) return res.status(400).json({ error: 'A name, valid email and sauna configuration are required.' });
    const id = randomBytes(12).toString('hex');
    const createdAt = new Date().toISOString();
    const { name, email, phone, message, configuration, totalChf } = req.body;
    insertQuote.run(id, name.trim(), email.trim(), phone?.trim() || null, message?.trim() || null, JSON.stringify(configuration), totalChf ?? null, createdAt);
    console.log(`[quote] ${createdAt} new quote ${id} from ${email} - CHF ${totalChf ?? '?'}`);
    res.status(201).json({ id, createdAt });
  });
  app.get('/api/quotes/:id', (req, res) => {
    if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(404).json({ error: 'This quote could not be found.' });
    const row = selectQuote.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'This quote could not be found.' });
    res.json({ id: row.id, name: row.name, email: row.email, phone: row.phone, message: row.message, configuration: JSON.parse(row.configuration), totalChf: row.total_chf, status: row.status, createdAt: row.created_at });
  });

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
