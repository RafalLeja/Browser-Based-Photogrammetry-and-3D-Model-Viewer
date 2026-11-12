import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FRAME_MARGIN, fitDistance } from '../src/framing.ts';

const FOV = Math.PI / 4; // 45 degrees, the viewer camera's vertical field of view.

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `expected ${expected}, got ${actual}`);
}

test('wide view: the vertical angle decides', () => {
  assertClose(fitDistance(1, FOV, 2), (1 / Math.sin(FOV / 2)) * FRAME_MARGIN);
  assertClose(fitDistance(1, FOV, 2), 3.1357511);
});

test('square view: same distance as a wide view', () => {
  assertClose(fitDistance(1, FOV, 1), fitDistance(1, FOV, 2));
});

test('tall view: the horizontal angle decides, so the camera moves back', () => {
  // sin(atan(t)) = t / hypot(1, t), with t = tan(fov / 2) * aspect.
  const t = Math.tan(FOV / 2) * 0.5;
  assertClose(fitDistance(1, FOV, 0.5), (Math.hypot(1, t) / t) * FRAME_MARGIN);
  assert.ok(fitDistance(1, FOV, 0.5) > fitDistance(1, FOV, 1));
});

test('distance grows in proportion to the radius', () => {
  assertClose(fitDistance(3, FOV, 1.5), 3 * fitDistance(1, FOV, 1.5));
});

test('a very narrow view still gives a finite distance', () => {
  assert.ok(Number.isFinite(fitDistance(1, FOV, 0.01)));
});
