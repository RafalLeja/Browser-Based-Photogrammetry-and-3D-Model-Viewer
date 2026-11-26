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

/**
 * Three edges of a model's bounding box that show its width, depth and height, all starting at
 * the bottom corner nearest the camera, so the labels stay in front of the model.
 */
export function dimensionEdges(min: Vec3, max: Vec3, camera: Vec3): { width: [Vec3, Vec3]; depth: [Vec3, Vec3]; height: [Vec3, Vec3] } {
  const near = (axis: 0 | 2): [number, number] =>
    Math.abs(camera[axis] - min[axis]) <= Math.abs(camera[axis] - max[axis]) ? [min[axis], max[axis]] : [max[axis], min[axis]];
  const [x0, x1] = near(0);
  const [z0, z1] = near(2);
  const corner: Vec3 = [x0, min[1], z0];
  return {
    width: [corner, [x1, min[1], z0]],
    depth: [corner, [x0, min[1], z1]],
    height: [corner, [x0, max[1], z0]],
  };
}

/**
 * The part of an image to keep so a subject fills it: the box around the subject's projected
 * points, padded by `padding` (a fraction of its size), widened to `aspect`, kept inside the image.
 * Null when there are no points.
 */
export function subjectCrop(
  points: { x: number; y: number }[],
  width: number,
  height: number,
  aspect: number,
  padding = 0.08,
): { x: number; y: number; width: number; height: number } | null {
  if (points.length === 0 || !(aspect > 0)) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * padding;
  const left = Math.min(...xs) - pad;
  const right = Math.max(...xs) + pad;
  const top = Math.min(...ys) - pad;
  const bottom = Math.max(...ys) + pad;
  let w = right - left;
  let h = bottom - top;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  // Never larger than the image, keeping the aspect.
  const fit = Math.min(1, width / w, height / h);
  w *= fit;
  h *= fit;
  const x = Math.min(Math.max((left + right) / 2 - w / 2, 0), width - w);
  const y = Math.min(Math.max((top + bottom) / 2 - h / 2, 0), height - h);
  return { x, y, width: w, height: h };
}

/**
 * The same view of another model: the same viewing direction, and the same distance and target
 * offset relative to its size, so two different scans can be compared side by side.
 */
export function mirrorView(view: ViewState, from: { center: Vec3; radius: number }, to: { center: Vec3; radius: number }): ViewState {
  const k = from.radius > 0 ? to.radius / from.radius : 1;
  const target = [0, 1, 2].map((i) => to.center[i] + (view.target[i] - from.center[i]) * k) as Vec3;
  const position = [0, 1, 2].map((i) => target[i] + (view.position[i] - view.target[i]) * k) as Vec3;
  return { position, target };
}
