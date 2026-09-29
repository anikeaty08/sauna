import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneViewerSafeGlb } from '../../app/server/studio-api/sceneViewerGlb.ts';

/** Minimal GLB: JSON chunk + a 4-byte BIN chunk. */
function glb(json: object): Buffer {
  let j = Buffer.from(JSON.stringify(json));
  if (j.length % 4) j = Buffer.concat([j, Buffer.alloc(4 - (j.length % 4), 0x20)]);
  const bin = Buffer.from([1, 2, 3, 4]);
  const out = Buffer.alloc(12 + 8 + j.length + 8 + bin.length);
  out.write('glTF', 0, 'latin1'); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(j.length, 12); out.writeUInt32LE(0x4e4f534a, 16); j.copy(out, 20);
  const b = 20 + j.length;
  out.writeUInt32LE(bin.length, b); out.writeUInt32LE(0x004e4942, b + 4); bin.copy(out, b + 8);
  return out;
}
const jsonOf = (b: Buffer) => JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));

test('Scene Viewer GLB: unsupported extensions removed, emissive strength folded in, binary kept', () => {
  const src = glb({
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_materials_emissive_strength', 'KHR_texture_transform'],
    materials: [{ name: 'led', emissiveFactor: [0.5, 0.25, 0.1], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 3 } } }],
  });
  const out = sceneViewerSafeGlb(src);
  const j = jsonOf(out);
  assert.deepEqual(j.extensionsUsed, ['KHR_texture_transform']);
  assert.equal(j.materials[0].extensions, undefined);
  assert.deepEqual(j.materials[0].emissiveFactor, [1, 0.75, 0.30000000000000004]);
  assert.equal(out.readUInt32LE(8), out.length, 'header length matches');
  assert.equal(out.readUInt32LE(12) % 4, 0, 'JSON chunk 4-byte aligned');
  assert.deepEqual([...out.subarray(out.length - 4)], [1, 2, 3, 4], 'BIN chunk kept');
});

test('Scene Viewer GLB: a clean model is returned untouched', () => {
  const src = glb({ asset: { version: '2.0' }, materials: [{ name: 'wood' }] });
  assert.equal(sceneViewerSafeGlb(src), src);
});
