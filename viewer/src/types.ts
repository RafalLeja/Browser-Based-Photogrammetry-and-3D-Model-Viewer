/**
 * Public API contract of the viewer.
 * Units: positions and distances are in metres (glTF convention: 1 unit = 1 m).
 * No Three.js types appear here on purpose: the frontend must not depend on three.
 */

export type Vec3 = [number, number, number];

export type RendererBackend = 'webgpu' | 'webgl2';

export type ToneMappingName = 'neutral' | 'aces' | 'agx' | 'none';

/** 'studio' (soft boxes), 'outdoor' (sky and sun) and 'room' are generated, so they need no download. */
export type EnvironmentPreset = 'room' | 'studio' | 'outdoor' | 'none';

export interface ViewerOptions {
  /** Force the WebGL 2 backend even when WebGPU is available (to test the fallback). */
  forceWebGL?: boolean;
  /** Environment applied right after creation. Default: { preset: 'room' }. */
  environment?: EnvironmentOptions;
  /**
   * Folder (URL, ending in '/') with the Draco and Basis decoders, copied there by
   * `npm run decoders`. Fetched only when a model uses those compressions. Default '/decoders/'.
   */
  decoderPath?: string;
  /** Accessible name of the 3D view for screen readers. Default '3D model viewer'. */
  label?: string;
  /**
   * Share gestures with the page around the viewer, for a model inside a longer page (a landing
   * page, an embed): the wheel zooms only with Ctrl or ⌘ held (a trackpad pinch counts), so a
   * plain scroll moves the page, and on touch screens a vertical swipe scrolls the page while a
   * sideways swipe turns the model and a pinch zooms. Default false: the viewer owns every gesture.
   */
  cooperativeGestures?: boolean;
}

/**
 * What a click on the model does:
 * - 'orbit': nothing, dragging turns the camera (the default),
 * - 'measure': two clicks measure a distance,
 * - 'annotate': a click reports the surface point as a 'pin-place' event.
 */
export type Tool = 'orbit' | 'measure' | 'annotate';

export interface Measurement {
  id: string;
  /** End points on the surface, in model space (metres when the model is true to scale). */
  start: Vec3;
  end: Vec3;
  /** Straight-line distance between start and end, in model units. */
  distance: number;
}

/** A camera placement: where it is and what it looks at, in world space. */
export interface ViewState {
  position: Vec3;
  target: Vec3;
}

export type SectionAxis = 'x' | 'y' | 'z';

export interface SectionOptions {
  enabled: boolean;
  axis?: SectionAxis;
  /** Where the cut lies across the model, from 0 (its low side) to 1 (its high side). */
  position?: number;
  /** Keep the other side of the cut. */
  flip?: boolean;
}

export interface ScreenshotOptions {
  /** Image type for canvas.toBlob, e.g. 'image/webp' (default) or 'image/png'. */
  type?: string;
  quality?: number;
  /** Longest side of the image in pixels. Default: the canvas size. */
  maxSize?: number;
}

export interface ModelInfo {
  url: string;
  triangles: number;
  /** Bounding-sphere radius in world units; useful to scale UI hints. */
  radius: number;
  /** Bounding-box size in model units. True metres once the pipeline outputs real scale (W05). */
  size: Vec3;
  /** Bounding-box centre in model units. */
  center: Vec3;
}

/** 'gltf' covers .glb and .gltf. 'ply' is what the photogrammetry pipeline exports today. */
export type ModelFormat = 'gltf' | 'ply';

export interface LoadOptions {
  /**
   * File format. Default: 'ply' when the URL path ends in .ply, otherwise 'gltf'.
   * Needed for URLs without an extension, such as a blob: URL of a dropped file.
   */
  format?: ModelFormat;
  /**
   * The model's up direction in its own coordinates (any length). The viewer turns the model
   * so this points up. For scans that are not +Y up yet: COLMAP output has +Y pointing down,
   * so `[0, -1, 0]` flips it. Pins and distances stay in the file's own coordinates.
   */
  up?: Vec3;
  /**
   * Whether 1 unit is 1 metre. False for a scan that has not been scaled yet: the ruler then
   * shows plain units instead of millimetres. Default true (the glTF convention).
   */
  trueScale?: boolean;
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
  /** A measurement was completed. */
  measure: Measurement;
  /** The list of measurements changed (added, undone or cleared). */
  'measurements-change': { measurements: Measurement[] };
  /** The active tool changed, for example after Escape. */
  'tool-change': { tool: Tool };
  /** A pin label was clicked or activated with the keyboard. */
  'pin-click': { id: string };
  /** In the 'annotate' tool, the surface point the user clicked, in model space. */
  'pin-place': { position: Vec3; normal: Vec3 };
  /** The user finished moving the camera, or a camera flight ended. */
  'view-change': ViewState;
}

export type Unsubscribe = () => void;

export interface Viewer {
  /** Which GPU backend is actually in use. */
  readonly backend: RendererBackend;
  /**
   * Load a .glb/.gltf/.ply, replacing the current model, and frame the camera on it.
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
  /** Move the camera closer (factor < 1) or further away (factor > 1). */
  zoom(factor: number): void;
  /** Current camera placement, for example to share it in a link. */
  getView(): ViewState;
  /** Move the camera; animated unless `animate` is false or the user prefers reduced motion. */
  setView(view: ViewState, options?: { animate?: boolean }): void;
  /** Choose what a click on the model does. Escape returns to 'orbit'. */
  setTool(tool: Tool): void;
  readonly tool: Tool;
  getMeasurements(): Measurement[];
  /** Remove the newest measurement (or the half-finished one). */
  undoMeasurement(): void;
  clearMeasurements(): void;
  /** Replace all pins. Pins are drawn as numbered labels in list order. */
  setPins(pins: Pin[]): void;
  addPin(pin: Pin): void;
  removePin(id: string): void;
  /** Highlight one pin (or none). */
  setActivePin(id: string | null): void;
  /** Fly the camera to a pin and highlight it. */
  focusPin(id: string): void;
  /** Cut the model open with a plane, to look inside. */
  setSection(options: SectionOptions): void;
  /** The current view as an image, without pins and labels. */
  screenshot(options?: ScreenshotOptions): Promise<Blob>;
  /** Subscribe to an event. Returns a function that unsubscribes. */
  on<K extends keyof ViewerEvents>(type: K, handler: (event: ViewerEvents[K]) => void): Unsubscribe;
  /** Stop rendering, free GPU memory, remove listeners and the canvas. */
  dispose(): void;
}
