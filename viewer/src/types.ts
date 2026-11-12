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

export interface LoadOptions {
  /** Extra HTTP request headers, for example `{ Authorization: 'Bearer <token>' }`. */
  headers?: Record<string, string>;
  /** Send cookies with a cross-origin request. Default false. */
  withCredentials?: boolean;
}

export interface KeyLightOptions {
  intensity: number;
  /** CSS colour string, e.g. '#ffffff'. */
  color: string;
  /** Direction the light comes FROM (does not need to be normalised). */
  direction: Vec3;
}

export interface GroundShadowOptions {
  /** 0 hides the shadow, 1 is the darkest. Default 0.5. */
  opacity: number;
}

export interface LightingUpdate {
  exposure?: number;
  toneMapping?: ToneMappingName;
  keyLight?: Partial<KeyLightOptions>;
  /** Soft shadow on the ground under the model. */
  groundShadow?: Partial<GroundShadowOptions>;
}

export interface EnvironmentOptions {
  /** URL of an equirectangular .hdr file. Takes precedence over preset. */
  hdrUrl?: string;
  preset?: EnvironmentPreset;
  /** Multiplier for image-based lighting strength. Default 1. */
  intensity?: number;
  /** Show the HDR panorama behind the model. Default false: the canvas is transparent. */
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

/**
 * What failed:
 * - 'load': a model could not be downloaded or read.
 * - 'environment': an HDR environment could not be downloaded or read.
 * - 'device-lost': the browser took the GPU away, and the viewer has stopped drawing.
 */
export type ViewerErrorCode = 'load' | 'environment' | 'device-lost';

export interface ViewerEvents {
  progress: { url: string; loaded: number; total: number | null };
  loaded: ModelInfo;
  /** `httpStatus` is set when a download failed with an HTTP status, e.g. 404. */
  error: { code: ViewerErrorCode; message: string; httpStatus?: number; cause?: unknown };
  measure: { start: Vec3; end: Vec3; distance: number };
  'pin-click': { id: string };
}

export type Unsubscribe = () => void;

export interface Viewer {
  /** Which GPU backend is actually in use. */
  readonly backend: RendererBackend;
  /**
   * Load a .glb/.gltf, replacing the current model, and frame the camera on it.
   * A newer load() or dispose() cancels this one: the promise then rejects with an Error
   * whose `name` is 'AbortError', and no `error` event is emitted.
   */
  load(url: string, options?: LoadOptions): Promise<ModelInfo>;
  /** Move the camera back to the default view of the current model. */
  resetView(): void;
  /** Slowly turn the camera around the model. It pauses while the user drags. */
  setAutoRotate(on: boolean): void;
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
