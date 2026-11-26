import assert from 'node:assert/strict';
import { test } from 'node:test';

import { errorMessage } from '../src/api.ts';
import { escapeHtml, formatBytes, formatCount, formatDimensions, formatDuration, formatRelative, initials, safeNext } from '../src/lib/format.ts';
import { DEFAULT_LIGHT, lightAngles, lightDirection, sharedLight } from '../src/lib/light.ts';
import { stageStates } from '../src/lib/jobs.ts';
import { coverageLevel, readyToUpload, selectPhotos, type FileLike } from '../src/lib/photos.ts';

const photo = (name: string, size = 1000, type = 'image/jpeg'): FileLike => ({ name, size, type });

test('formatters read like a person would write them', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2.2 * 1024 * 1024), '2.2 MB');
  assert.equal(formatBytes(null), '–');
  assert.equal(formatCount(299981), '300 k');
  assert.equal(formatCount(3_220_819), '3.2 M');
  assert.equal(formatCount(1234), '1,234');
  assert.equal(formatDuration(0.4), '<1 s');
  assert.equal(formatDuration(75), '1 min 15 s');
  assert.equal(formatDuration(3720), '1 h 2 min');
  assert.equal(formatDimensions([245, 180, 120]), '24.5 × 18.0 × 12.0 cm');
  assert.equal(formatDimensions([1500, 800, 600]), '1.5 × 0.8 × 0.6 m');
  assert.equal(formatDimensions(null), '–');
  assert.equal(initials('Mara Chen'), 'MC');
  assert.equal(initials('curator'), 'CU');
});

test('formatRelative counts back from now', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  assert.equal(formatRelative('2026-11-26T11:59:40Z', now), 'just now');
  assert.equal(formatRelative('2026-11-26T11:30:00Z', now), '30 min ago');
  assert.equal(formatRelative('2026-11-25T12:00:00Z', now), 'yesterday');
  assert.equal(formatRelative('not a date', now), '–');
});

test('safeNext only follows same-site paths after login', () => {
  assert.equal(safeNext('/create'), '/create');
  assert.equal(safeNext('//evil.example'), '/collection');
  assert.equal(safeNext('/\\evil.example'), '/collection');
  assert.equal(safeNext('https://evil.example'), '/collection');
  assert.equal(safeNext(null), '/collection');
});

test('selectPhotos keeps photos and zips, skips duplicates and explains rejections', () => {
  const first = selectPhotos([], [photo('a.jpg'), photo('b.png', 1000, 'image/png'), photo('set.zip', 5000, 'application/zip')]);
  assert.equal(first.photoCount, 2);
  assert.equal(first.zipCount, 1);
  const second = selectPhotos(first.accepted, [photo('a.jpg'), photo('c.heic', 10, ''), photo('notes.txt', 10, 'text/plain'), photo('.DS_Store', 10, '')]);
  assert.equal(second.accepted.length, 3); // a.jpg again is a duplicate
  assert.deepEqual(
    second.rejected.map((r) => r.file.name),
    ['c.heic', 'notes.txt'],
  );
  assert.match(second.rejected[0].reason, /Convert to JPEG/);
});

test('selectPhotos enforces the per-photo size limit', () => {
  const big = photo('big.jpg', 41 * 1024 * 1024);
  const result = selectPhotos([], [big]);
  assert.equal(result.accepted.length, 0);
  assert.match(result.rejected[0].reason, /40 MB/);
});

test('readyToUpload needs enough photos unless a zip is included', () => {
  assert.equal(readyToUpload(selectPhotos([], [])).ok, false);
  assert.equal(readyToUpload(selectPhotos([], [photo('a.jpg'), photo('b.jpg')])).ok, false);
  assert.equal(readyToUpload(selectPhotos([], [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')])).ok, true);
  assert.equal(readyToUpload(selectPhotos([], [photo('set.zip', 10, 'application/zip')])).ok, true);
});

test('coverageLevel rewards more overlapping photos', () => {
  assert.deepEqual([2, 3, 19, 20, 49, 50].map(coverageLevel), [0, 1, 1, 2, 2, 3]);
});

test('stageStates marks finished, running, failed and pending stages', () => {
  const stages = [{ key: 'upload' }, { key: 'features' }, { key: 'matching' }];
  assert.deepEqual(stageStates({ status: 'running', stage: 'features' }, stages), ['done', 'active', 'pending']);
  assert.deepEqual(stageStates({ status: 'failed', stage: 'matching' }, stages), ['done', 'done', 'failed']);
  assert.deepEqual(stageStates({ status: 'queued', stage: null }, stages), ['pending', 'pending', 'pending']);
  assert.deepEqual(stageStates({ status: 'done', stage: 'matching' }, stages), ['done', 'done', 'done']);
});

test('errorMessage reads FastAPI errors and falls back to plain words', () => {
  assert.equal(errorMessage(401, { detail: 'Wrong login or password.' }), 'Wrong login or password.');
  assert.equal(errorMessage(422, { detail: [{ loc: ['body', 'title'], msg: 'Field required' }] }), 'title: Field required');
  assert.match(errorMessage(0, null), /Cannot reach the server/);
  assert.match(errorMessage(502, null), /server had a problem/);
});

test('an embed code cannot be broken or hijacked by a title', () => {
  assert.equal(escapeHtml('The "Thinker" & <friends>'), 'The &quot;Thinker&quot; &amp; &lt;friends&gt;');
  assert.equal(escapeHtml(`x" onload="alert(1)`), 'x&quot; onload=&quot;alert(1)');
  assert.equal(escapeHtml("Rodin's"), 'Rodin&#39;s');
});

test('a shared link restores the key light direction it saved', () => {
  for (const [azimuth, elevation] of [[45, 40], [300, 8], [0, 85], [180, 2]]) {
    assert.deepEqual(lightAngles(lightDirection(azimuth, elevation)), { azimuth, elevation });
  }
  const restored = sharedLight({ position: [0, 0, 3], target: [0, 0, 0], light_direction: lightDirection(270, 10), exposure: 1.4 }, DEFAULT_LIGHT);
  assert.equal(restored.azimuth, 270);
  assert.equal(restored.elevation, 10);
  assert.equal(restored.exposure, 1.4);
  assert.equal(restored.environment, DEFAULT_LIGHT.environment); // Not in the link: kept.
});
