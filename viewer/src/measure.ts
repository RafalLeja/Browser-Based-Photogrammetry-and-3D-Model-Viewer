// Small maths and formatting helpers for the ruler, pins and camera flights.
// No three import, so Node can test them.
import type { SectionAxis, Vec3, ViewState } from './types';

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * A length in metres as people read it: millimetres below 1 cm, centimetres below 1 m,
 * metres above. `trueScale` false means the model has no real size yet, so plain units.
 */
export function formatLength(metres: number, trueScale = true): string {
  if (!Number.isFinite(metres)) return '–';
  if (!trueScale) return `${metres.toPrecision(3)} units`;
  const abs = Math.abs(metres);
  if (abs < 0.01) return `${(metres * 1000).toFixed(1)} mm`;
  if (abs < 1) return `${(metres * 100).toFixed(1)} cm`;
  return `${metres.toFixed(2)} m`;
}

/** Smooth start and stop for camera flights, t from 0 to 1. */
export function easeInOutCubic(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Checks a view that came from outside (a link, the API) before the camera trusts it. */
export function isViewState(value: unknown): value is ViewState {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as Record<string, unknown>;
  if (!isVec3(view.position) || !isVec3(view.target)) return false;
  return distance(view.position, view.target) > 0; // The camera must stand somewhere else than its target.
}

const AXIS_INDEX: Record<SectionAxis, number> = { x: 0, y: 1, z: 2 };

/**
 * The cutting plane for a section: `normal` points at the part that is cut away, and
 * `constant` is the plane's offset in three's Plane form (normal · p + constant = 0).
 */
export function sectionPlane(
  min: Vec3,
  max: Vec3,
  axis: SectionAxis,
  position: number,
  flip: boolean,
): { normal: Vec3; constant: number } {
  const i = AXIS_INDEX[axis];
  const t = Math.min(Math.max(position, 0), 1);
  const at = min[i] + (max[i] - min[i]) * t;
  const sign = flip ? 1 : -1;
  const normal: Vec3 = [0, 0, 0];
  normal[i] = sign;
  // three keeps points where normal · p + constant >= 0, so the kept side is behind the normal.
  return { normal, constant: -sign * at };
}
