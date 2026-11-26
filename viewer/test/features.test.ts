import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Annotation } from '../src/api.ts';
import { fuzzyMatch, niceTicks } from '../src/lib/format.ts';
import { nextPhase } from '../src/lib/kiosk.ts';
import { citation, licenseBadge, reportOrder } from '../src/lib/museum.ts';
import {
  assessPhotos,
  differenceHash,
  exposure,
  grayscale,
  hammingDistance,
  laplacianVariance,
  type PhotoMeasure,
} from '../src/lib/photo-quality.ts';

const W = 96;
const H = 72;

/** A greyscale test card: an 8-pixel checkerboard, optionally box-blurred, at a given contrast. */
function card({ blur = 0, low = 30, high = 220, shift = 0 } = {}): Float32Array {
  let gray = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) gray[y * W + x] = (Math.floor((x + shift) / 8) + Math.floor(y / 8)) % 2 ? high : low;
  for (let pass = 0; pass < blur; pass++) {
    const next = new Float32Array(gray);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += gray[(y + dy) * W + x + dx];
        next[y * W + x] = sum / 9;
      }
    gray = next;
  }
  return gray;
}

function measure(gray: Float32Array, megapixels = 12): PhotoMeasure {
  return { sharpness: laplacianVariance(gray, W, H), ...exposure(gray), hash: differenceHash(gray, W, H), megapixels };
}

test('greyscale follows Rec. 601 luma', () => {
  const gray = grayscale([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255], 3, 1);
  assert.deepEqual([...gray].map((v) => Math.round(v)), [76, 150, 29]);
});

test('blur lowers the Laplacian variance a lot', () => {
  const sharp = laplacianVariance(card(), W, H);
  const blurred = laplacianVariance(card({ blur: 3 }), W, H);
  assert.ok(blurred < sharp * 0.2, `sharp ${sharp}, blurred ${blurred}`);
});

test('identical photos hash the same and a different photo does not', () => {
  assert.equal(hammingDistance(differenceHash(card(), W, H), differenceHash(card(), W, H)), 0);
  assert.ok(hammingDistance(differenceHash(card(), W, H), differenceHash(card({ shift: 4 }), W, H)) > 8);
  assert.equal(hammingDistance(0b1011n, 0b0001n), 2);
});

test('a photo set flags the blurry, the dark, the duplicate and the small photo, and passes the rest', () => {
  const set = [
    measure(card()),
    measure(card({ shift: 2 })),
    measure(card({ shift: 4 })),
    measure(card({ blur: 3, shift: 6 })),
    measure(card({ low: 0, high: 20, shift: 1 })),
    measure(card()), // the same photo twice
    measure(card({ shift: 3 }), 1.2),
  ];
  const issues = assessPhotos(set);
  assert.deepEqual(issues[0], []);
  assert.deepEqual(issues[1], []);
  assert.ok(issues[3].includes('blurry'));
  assert.ok(issues[4].includes('dark'));
  assert.ok(issues[5].includes('duplicate'));
  assert.ok(issues[6].includes('small'));
});

test('a citation leaves out what the record does not have', () => {
  const object = { id: 7, title: 'Amphora', created_at: '2026-11-26T10:00:00Z', record: { maker: 'Unknown potter', date: 'c. 450 BC', accession_number: '1987.12.4' } };
  const { text, bibtex } = citation(object, 'https://vitrine.example/objects/7', new Date('2026-11-26T12:00:00Z'));
  assert.equal(text, 'Unknown potter, “Amphora”, c. 450 BC, 1987.12.4. 3D model, Vitrine. https://vitrine.example/objects/7 (accessed 26 November 2026).');
  assert.match(bibtex, /^@misc\{vitrine-7,/);
  assert.match(bibtex, /year = \{450\}/);
  assert.match(bibtex, /note = \{3D model; accession number 1987.12.4\}/);
  const bare = citation({ ...object, record: {} }, 'u', new Date('2026-01-01'));
  assert.equal(bare.text, '“Amphora”. 3D model, Vitrine. u (accessed 1 January 2026).');
  assert.doesNotMatch(bare.bibtex, /author/);
});

test('licence badges are short', () => {
  assert.equal(licenseBadge('cc0'), 'CC0');
  assert.equal(licenseBadge('cc-by-nc'), 'CC BY-NC');
  assert.equal(licenseBadge('all-rights-reserved'), '©');
});

test('a condition report reads damage first, the most severe first', () => {
  const note = (id: number, category: Annotation['category'], severity: Annotation['severity'] = null) => ({ id, category, severity }) as Annotation;
  const ordered = reportOrder([note(1, 'note'), note(2, 'damage', 'slight'), note(3, 'detail'), note(4, 'damage', 'extreme'), note(5, 'repair')]);
  assert.deepEqual(
    ordered.map((n) => n.id),
    [4, 2, 5, 3, 1],
  );
});

test('the palette matches every typed word anywhere in the text', () => {
  assert.ok(fuzzyMatch('Damaged Helmet', 'hel dam'));
  assert.ok(fuzzyMatch('Anything', '   '));
  assert.ok(!fuzzyMatch('Damaged Helmet', 'eagle'));
});

test('chart ticks are whole, round numbers that reach the maximum', () => {
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(7), [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks(23), [0, 5, 10, 15, 20, 25]);
});

test('the kiosk loop turns the object, tours its notes, then moves on', () => {
  assert.deepEqual(nextPhase({ kind: 'turn' }, 2), { kind: 'note', index: 0 });
  assert.deepEqual(nextPhase({ kind: 'note', index: 0 }, 2), { kind: 'note', index: 1 });
  assert.equal(nextPhase({ kind: 'note', index: 1 }, 2), 'next-object');
  assert.equal(nextPhase({ kind: 'turn' }, 0), 'next-object');
});
