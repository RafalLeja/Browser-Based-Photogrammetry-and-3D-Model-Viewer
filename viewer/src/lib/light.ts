// Lighting of the object page as plain data, and how it maps to the viewer's key light and to
// shared links. Pure functions, tested in Node.
import type { EnvironmentName, SharedViewState } from '../api';

export interface LightState {
  environment: EnvironmentName;
  exposure: number;
  intensity: number;
  /** Where the key light comes from, in degrees around the model and above the horizon. */
  azimuth: number;
  elevation: number;
  shadow: number;
  background: boolean;
}

export const DEFAULT_LIGHT: LightState = { environment: 'studio', exposure: 1, intensity: 1, azimuth: 45, elevation: 40, shadow: 0.5, background: false };

/**
 * Raking light, as conservators use it: one strong light a few degrees above the surface, no fill,
 * so every bump casts a shadow and relief, tool marks and cracks stand out.
 */
export const RAKING_LIGHT: Partial<LightState> = { environment: 'none', intensity: 3.2, elevation: 6, shadow: 0.15, exposure: 1.1, background: false };

/** Light coming from `azimuth` degrees around the model and `elevation` degrees above the horizon. */
export function lightDirection(azimuth: number, elevation = DEFAULT_LIGHT.elevation): [number, number, number] {
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
}

/** The inverse of lightDirection, rounded to whole degrees, for restoring a shared view. */
export function lightAngles(direction: [number, number, number]): { azimuth: number; elevation: number } {
  const [x, y, z] = direction;
  const length = Math.hypot(x, y, z) || 1;
  const azimuth = Math.round(((Math.atan2(z, x) * 180) / Math.PI + 360) % 360);
  const elevation = Math.round((Math.asin(Math.max(-1, Math.min(1, y / length))) * 180) / Math.PI);
  return { azimuth: azimuth === 360 ? 0 : azimuth, elevation };
}

/** The lighting a shared link restores, on top of the current lighting for fields it leaves out. */
export function sharedLight(state: SharedViewState, current: LightState): LightState {
  return {
    ...current,
    environment: state.environment ?? current.environment,
    exposure: state.exposure ?? current.exposure,
    intensity: state.light_intensity ?? current.intensity,
    background: state.background ?? current.background,
    ...(state.light_direction ? lightAngles(state.light_direction) : {}),
  };
}
