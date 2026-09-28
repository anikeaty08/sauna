import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
// @ts-expect-error - plain JS module
import { createApp } from '../../app/server/app.js';
import { defaultConfiguration, zirbe6eck } from '../../packages/configuration-core/index.ts';

let server: Server, base = '', close: () => void;
before(async () => {
  const made = createApp({ databasePath: ':memory:' });
  close = made.close;
  server = made.app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/studio`;
});
after(() => { server.close(); close(); });

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  ({ method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });

test('catalog endpoints list the model and its modules', async () => {
  const saunas = await (await fetch(`${base}/saunas`)).json();
  assert.equal(saunas[0].id, 'zirbe-6eck');
  const detail = await (await fetch(`${base}/saunas/zirbe-6eck`)).json();
  assert.ok(detail.modules.some((m: { id: string }) => m.id === 'glass-door'));
  assert.equal((await fetch(`${base}/saunas/nope`)).status, 404);
});

test('save re-prices on the server and ignores any client total', async () => {
  const configuration = { ...defaultConfiguration(zirbe6eck), heaterSet: 'harvia-virta-9', totalChf: 1 };
  const res = await fetch(`${base}/configurations`, json('POST', { configuration }));
  assert.equal(res.status, 201);
  const saved = await res.json();
  assert.equal(saved.price.total, 19990 + 1181 + 1156 + 2425);
  const read = await (await fetch(`${base}/configurations/${saved.id}`)).json();
  assert.equal(read.configuration.heaterSet, 'harvia-virta-9');
});

test('invalid configurations are rejected with issues', async () => {
  const res = await fetch(`${base}/configurations`, json('POST', { configuration: { ...defaultConfiguration(zirbe6eck), dimensions: { widthCm: 999, depthCm: 200 } } }));
  assert.equal(res.status, 400);
  assert.ok((await res.json()).issues.length > 0);
});

test('updating needs the edit token; quote requests need a saved configuration', async () => {
  const saved = await (await fetch(`${base}/configurations`, json('POST', { configuration: defaultConfiguration(zirbe6eck) }))).json();
  const next = { ...defaultConfiguration(zirbe6eck), accessories: ['led-5m'] };
  assert.equal((await fetch(`${base}/configurations/${saved.id}`, json('PUT', { configuration: next }, { 'X-Edit-Token': 'wrong' }))).status, 403);
  assert.equal((await fetch(`${base}/configurations/${saved.id}`, json('PUT', { configuration: next }, { 'X-Edit-Token': saved.editToken }))).status, 200);
  assert.equal((await fetch(`${base}/quote-requests`, json('POST', { configurationId: 'x', name: 'A', email: 'a@b.ch' }))).status, 400);
  assert.equal((await fetch(`${base}/quote-requests`, json('POST', { configurationId: saved.id, name: 'A', email: 'a@b.ch' }))).status, 201);
});

test('the legacy demo endpoints still answer', async () => {
  const health = await fetch(base.replace('/studio', '/health'));
  assert.equal(health.status, 200);
});

test('shared links get link-preview tags for that design', async () => {
  const { studioPageHtml, createStudioRouter } = await import('../../app/server/studio-api/index.ts');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  createStudioRouter(db);
  db.prepare('INSERT INTO studio_configurations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('abcdefghijkl', 'zirbe-6eck', '1.0.0',
    JSON.stringify({ ...defaultConfiguration(zirbe6eck), dimensions: { widthCm: 200, depthCm: 220 }, heaterSet: 'harvia-virta-9' }), 0, 0, 'x', 'now', 'now');
  const shell = '<title>Old</title><meta name="description" content="x" /><meta property="og:title" content="x" /><meta property="og:description" content="x" />';
  const html = studioPageHtml(db, shell, 'abcdefghijkl');
  assert.match(html, /<title>Designsauna Zirbe 6-Eck 200 × 220 cm — shared design<\/title>/);
  assert.match(html, /og:description" content="Harvia Virta 9 kW · Aspen \(Espe\) benches · CHF 23&#39;925 incl\. VAT"/);
  assert.match(studioPageHtml(db, shell, '<script>'), /<title>Designsauna Zirbe 6-Eck — 3D configurator<\/title>/);
});

test('AR files: write-once, checked, served with the right type', async () => {
  const saved = await (await fetch(`${base}/configurations`, json('POST', { configuration: defaultConfiguration(zirbe6eck) }))).json();
  const url = `${base}/configurations/${saved.id}/ar/model.glb`;
  assert.equal((await fetch(url)).status, 404);
  const glb = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(60)]);
  assert.equal((await fetch(url, { method: 'PUT', body: Buffer.from('nope-not-a-model-at-all'), headers: { 'Content-Type': 'model/gltf-binary' } })).status, 400);
  assert.equal((await fetch(url, { method: 'PUT', body: glb, headers: { 'Content-Type': 'model/gltf-binary' } })).status, 201);
  assert.equal((await fetch(url, { method: 'PUT', body: glb, headers: { 'Content-Type': 'model/gltf-binary' } })).status, 409);
  const got = await fetch(url);
  assert.equal(got.status, 200);
  assert.match(got.headers.get('content-type') ?? '', /model\/gltf-binary/);
  assert.match(got.headers.get('cache-control') ?? '', /immutable/);
  assert.equal((await fetch(`${base}/configurations/${saved.id}/ar/evil.sh`, { method: 'PUT', body: glb })).status, 404);
});

test('quotation PDF is generated from the saved design and downloaded', async () => {
  const saved = await (await fetch(`${base}/configurations`, json('POST', { configuration: { ...defaultConfiguration(zirbe6eck), heaterSet: 'harvia-virta-9' } }))).json();
  const res = await fetch(`${base}/configurations/${saved.id}/quote.pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition') ?? '', /^attachment; filename="HolzSauna-Quotation-/);
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await fetch(`${base}/configurations/AAAAAAAAAAAA/quote.pdf`)).status, 404);
});
