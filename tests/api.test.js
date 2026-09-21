import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { checkFit, defaults } from '../src/state.js';

test('fit considers height, door sweep and rotation instead of area alone', () => {
  assert.equal(checkFit({ width: 140, depth: 182, height: 202 }).status, 'fits');
  assert.equal(checkFit({ width: 140, depth: 181, height: 202 }).status, 'small');
  assert.equal(checkFit({ width: 140, depth: 120, height: 202, door: false }).status, 'fits');
  assert.equal(checkFit({ width: 182, depth: 140, height: 202 }).orientation, 'turned');
  assert.equal(checkFit({ width: 182, depth: 140, height: 202, rotate: false }).status, 'small');
  assert.equal(checkFit({ width: 300, depth: 300, height: 201 }).status, 'small');
  for (const width of [0, -1, Infinity, 'bad']) assert.equal(checkFit({ width, depth: 300, height: 240 }).status, 'invalid');
});

test('API validates input, saves immutable configurations, and persists after reopening', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sauna-test-'));
  const databasePath = path.join(directory, 'test.sqlite');
  let service, server;
  async function start() { service = createApp({ databasePath }); server = service.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); return `http://127.0.0.1:${server.address().port}`; }
  async function stop() { await new Promise(resolve => server.close(resolve)); service.close(); }
  let base = await start();
  const post = (endpoint, body) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await post('/api/designs', { configuration: { ...defaults, door: 'ceiling' } })).status, 400);
    assert.equal((await post('/api/designs', { configuration: { ...defaults, angle: '90' } })).status, 400);
    assert.equal((await post('/api/designs', { configuration: { ...defaults, privateData: 'ignored?' } })).status, 400);
    assert.equal((await post('/api/fit', { width: 140, depth: 182, height: 202, rotate: 'false' })).status, 400);
    assert.equal((await post('/api/fit', { width: 140, depth: 182, height: 202 })).status, 200);
    assert.equal((await fetch(base + '/api/designs/bad')).status, 404);
    const ids = [];
    for (const door of ['left','right']) for (const heater of ['integrated','external']) {
      const configuration = { ...defaults, door, heater, angle: 45 };
      const response = await post('/api/designs', { configuration }); assert.equal(response.status, 201);
      const saved = await response.json(); ids.push({ id: saved.id, configuration });
      assert.deepEqual((await (await fetch(base + `/api/designs/${saved.id}`)).json()).configuration, configuration);
    }
    await stop(); base = await start();
    for (const { id, configuration } of ids) assert.deepEqual((await (await fetch(base + `/api/designs/${id}`)).json()).configuration, configuration);
    const malformed = await fetch(base + '/api/designs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' }); assert.equal(malformed.status, 400);
  } finally { await stop(); rmSync(directory, { recursive: true, force: true }); }
});
