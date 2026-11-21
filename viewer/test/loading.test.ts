import assert from 'node:assert/strict';
import { test } from 'node:test';

import { abortError, httpStatusOf, isAbortError, modelFormat, progressPayload } from '../src/loading.ts';

test('modelFormat reads .ply from the path, in any case, ignoring query and hash', () => {
  assert.equal(modelFormat('models/eagle-dense.ply'), 'ply');
  assert.equal(modelFormat('models/EAGLE.PLY'), 'ply');
  assert.equal(modelFormat('http://localhost:8000/exported_models/eagle.ply?v=2#top'), 'ply');
});

test('modelFormat falls back to gltf for .glb, .gltf and URLs without an extension', () => {
  assert.equal(modelFormat('models/DamagedHelmet.glb'), 'gltf');
  assert.equal(modelFormat('models/scene.gltf'), 'gltf');
  assert.equal(modelFormat('blob:http://localhost:5173/0b6c1a52-7c1e-4d3b-9a43-2f5e1c9d8e7a'), 'gltf');
  assert.equal(modelFormat('http://localhost:8000/objects/eagle'), 'gltf');
  // ".ply" must be the file's extension, not part of a folder name or the query.
  assert.equal(modelFormat('models/ply/helmet.glb'), 'gltf');
  assert.equal(modelFormat('models/helmet.glb?from=scan.ply'), 'gltf');
});

test('progress: a known size is passed through', () => {
  assert.deepEqual(progressPayload('a.glb', 50, 200, true), {
    url: 'a.glb',
    loaded: 50,
    total: 200,
  });
  assert.equal(progressPayload('a.glb', 200, 200, true).total, 200);
});

test('progress: total is null when the server sent no size', () => {
  assert.equal(progressPayload('a.glb', 50, 0, false).total, null);
  assert.equal(progressPayload('a.glb', 50, 0, true).total, null);
});

test('progress: total is null once loaded passes it (compressed response)', () => {
  assert.equal(progressPayload('a.glb', 300, 200, true).total, null);
});

test('isAbortError recognises cancelled downloads only', () => {
  assert.equal(isAbortError(new DOMException('cancelled', 'AbortError')), true);
  assert.equal(isAbortError(abortError('a.glb')), true);
  assert.equal(isAbortError(new Error('network')), false);
  assert.equal(isAbortError(null), false);
  assert.equal(isAbortError('AbortError'), false);
});

test('httpStatusOf reads the status of a failed response', () => {
  assert.equal(httpStatusOf({ response: { status: 404 } }), 404);
  assert.equal(httpStatusOf(new Error('network')), undefined);
  assert.equal(httpStatusOf({ response: { status: '404' } }), undefined);
  assert.equal(httpStatusOf(null), undefined);
});

test('abortError is an Error named AbortError that mentions the url', () => {
  const error = abortError('a.glb');
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'AbortError');
  assert.match(error.message, /a\.glb/);
});
