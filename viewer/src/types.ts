/**
 * Public API contract of the viewer.
 * Units: positions and distances are in metres (glTF convention: 1 unit = 1 m).
 * No Three.js types appear here on purpose: the frontend must not depend on three.
 */

export type Vec3 = [number, number, number];

export type RendererBackend = 'webgpu' | 'webgl2';

export type ToneMappingName = 'neutral' | 'aces' | 'agx' | 'none';

export type EnvironmentPreset = 'room' | 'studio' | 'outdoor' | 'none';

export interface ViewerOptions {
  /** Force the WebGL 2 backend even when WebGPU is available (to test the fallback). */
  forceWebGL?: boolean;
  /** Environment applied right after creation. Default: { preset: 'room' }. */
  environment?: EnvironmentOptions;
}

export interface ModelInfo {
  url: string;
  triangles: number;
  /** Bounding-box size in model units. True metres once the pipeline outputs real scale (W05). */
  size: Vec3;
  /** Bounding-box centre in model units. */
  center: Vec3;
}

export interface KeyLightOptions {
  intensity: number;
  /** CSS colour string, e.g. '#ffffff'. */
  color: string;
  /** Direction the light comes FROM (does not need to be normalised). */
  direction: Vec3;
}

export interface LightingUpdate {
  exposure?: number;
  toneMapping?: ToneMappingName;
  keyLight?: Partial<KeyLightOptions>;
}

export interface EnvironmentOptions {
  /** URL of an equirectangular .hdr file. Takes precedence over preset. */
  hdrUrl?: string;
  preset?: EnvironmentPreset;
  /** Multiplier for image-based lighting strength. Default 1. */
  intensity?: number;
  /** Show the HDR panorama behind the model. Default false. */
  showBackground?: boolean;
}

export interface Pin {
  /** Backend annotation id. */
  id: string;
  /** Point on the surface, in model space. */
  position: Vec3;
  /** Surface normal at that point, in model space. */
  normal: Vec3;
  title: string;
  text?: string;
}

export interface ViewerEvents {
  progress: { url: string; loaded: number; total: number | null };
  loaded: ModelInfo;
  error: { message: string; cause?: unknown };
  measure: { start: Vec3; end: Vec3; distance: number };
  'pin-click': { id: string };
}

export type Unsubscribe = () => void;

export interface Viewer {
  /** Which GPU backend is actually in use. */
  readonly backend: RendererBackend;
  /** Load a .glb/.gltf, replacing the current model, and frame the camera on it. */
  load(url: string): Promise<ModelInfo>;
  /** Partial update: only the given fields change. */
  setLighting(update: LightingUpdate): void;
  /** Change image-based lighting / background. Resolves when the new environment is active. */
  setEnvironment(options: EnvironmentOptions): Promise<void>;
  /** Turn the two-click ruler on/off. STUB until W04. */
  enableMeasure(on: boolean): void;
  /** Show a pin. STUB until W05 (stores the pin, draws nothing yet). */
  addPin(pin: Pin): void;
  /** Remove a pin. STUB until W05. */
  removePin(id: string): void;
  /** Subscribe to an event. Returns a function that unsubscribes. */
  on<K extends keyof ViewerEvents>(type: K, handler: (event: ViewerEvents[K]) => void): Unsubscribe;
  /** Stop rendering, free GPU memory, remove listeners and the canvas. */
  dispose(): void;
}
