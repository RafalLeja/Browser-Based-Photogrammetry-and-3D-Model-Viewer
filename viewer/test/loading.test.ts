import assert from 'node:assert/strict';
import { test } from 'node:test';

import { abortError, httpStatusOf, isAbortError, progressPayload } from '../src/loading.ts';

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
