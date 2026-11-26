import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distance, easeInOutCubic, formatLength, isViewState, lerpVec3, sectionPlane } from '../src/measure.ts';

test('a known-size cube gives the correct distances (1 unit = 1 m)', () => {
  // Corners of a 0.25 m cube: edge, face diagonal and space diagonal.
  assert.equal(distance([0, 0, 0], [0.25, 0, 0]), 0.25);
  assert.ok(Math.abs(distance([0, 0, 0], [0.25, 0.25, 0]) - 0.25 * Math.SQRT2) < 1e-12);
  assert.ok(Math.abs(distance([0, 0, 0], [0.25, 0.25, 0.25]) - 0.25 * Math.sqrt(3)) < 1e-12);
  assert.equal(formatLength(distance([0, 0, 0], [0.25, 0, 0])), '25.0 cm');
});

test('formatLength picks millimetres, centimetres or metres', () => {
  assert.equal(formatLength(0.0042), '4.2 mm');
  assert.equal(formatLength(0.125), '12.5 cm');
  assert.equal(formatLength(1.5), '1.50 m');
  assert.equal(formatLength(0.5, false), '0.500 units');
  assert.equal(formatLength(Number.NaN), '–');
});

test('easeInOutCubic starts and ends still and is symmetric', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(-1), 0);
  assert.equal(easeInOutCubic(2), 1);
  assert.ok(Math.abs(easeInOutCubic(0.25) + easeInOutCubic(0.75) - 1) < 1e-12);
});

test('lerpVec3 blends component-wise', () => {
  assert.deepEqual(lerpVec3([0, 0, 0], [2, 4, -6], 0.5), [1, 2, -3]);
});

test('isViewState accepts only finite, distinct camera and target points', () => {
  assert.equal(isViewState({ position: [1, 2, 3], target: [0, 0, 0] }), true);
  assert.equal(isViewState({ position: [1, 2, 3], target: [1, 2, 3] }), false);
  assert.equal(isViewState({ position: [1, 2], target: [0, 0, 0] }), false);
  assert.equal(isViewState({ position: [1, 2, Number.POSITIVE_INFINITY], target: [0, 0, 0] }), false);
  assert.equal(isViewState({ position: ['1', 2, 3], target: [0, 0, 0] }), false);
  assert.equal(isViewState(null), false);
});

test('sectionPlane keeps the low side by default and the high side when flipped', () => {
  const keep = (plane: { normal: number[]; constant: number }, p: number[]) =>
    plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] + plane.constant >= 0;
  const plane = sectionPlane([0, 0, 0], [2, 4, 2], 'y', 0.25, false); // cut at y = 1
  assert.equal(keep(plane, [0, 0.5, 0]), true);
  assert.equal(keep(plane, [0, 1.5, 0]), false);
  const flipped = sectionPlane([0, 0, 0], [2, 4, 2], 'y', 0.25, true);
  assert.equal(keep(flipped, [0, 0.5, 0]), false);
  assert.equal(keep(flipped, [0, 1.5, 0]), true);
  const x = sectionPlane([-1, 0, 0], [1, 1, 1], 'x', 2, false); // position clamps to 1 -> x = 1
  assert.equal(keep(x, [0.99, 0, 0]), true);
});
