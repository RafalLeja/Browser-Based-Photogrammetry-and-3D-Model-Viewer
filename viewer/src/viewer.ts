// One of the files that import three (with model.ts, shadow.ts and environments.ts). The
// frontend talks only to the public API in types.ts, so it never depends on Three.js types.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

import { disposeScene, outdoorScene, studioScene } from './environments';
import { Emitter } from './events';
import { fitDistance } from './framing';
import { abortError, httpStatusOf, isAbortError, modelFormat, progressPayload } from './loading';
import { distance, easeInOutCubic, formatLength, isViewState, lerpVec3, sectionPlane } from './measure';
import { disposeModel, measureModel, orientUp, plyObject, prepareModel } from './model';
import { Overlay, type MeasureView, type PinView, type ScreenPoint } from './overlay';
import { ContactShadow } from './shadow';
import type {
  EnvironmentOptions,
  EnvironmentPreset,
  LightingUpdate,
  LoadOptions,
  Measurement,
  ModelInfo,
  Pin,
  RendererBackend,
  ScreenshotOptions,
  SectionOptions,
  ToneMappingName,
  Tool,
  Unsubscribe,
  Vec3,
  Viewer,
  ViewerErrorCode,
  ViewerEvents,
  ViewerOptions,
  ViewState,
} from './types';

/** Distance used to place the key light until a model has been framed. */
const DEFAULT_LIGHT_DISTANCE = 5;

/** From the model's centre towards the camera: front-right and a little above. */
const DEFAULT_VIEW_DIRECTION = new THREE.Vector3(1, 0.6, 1).normalize();

/** A pointer that moves less than this between press and release is a click, not a drag. */
const CLICK_SLOP_PX = 6;
const CLICK_MAX_MS = 500;
const FLIGHT_MS = 750;
/** Pins hidden behind the model are re-checked at most this often while the camera moves. */
const OCCLUSION_INTERVAL_MS = 120;

const TONE_MAPPING: Record<ToneMappingName, THREE.ToneMapping> = {
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  none: THREE.NoToneMapping,
};

type BvhGeometry = THREE.BufferGeometry & { boundsTree?: MeshBVH };

export async function createViewer(
  container: HTMLElement,
  options?: ViewerOptions,
): Promise<Viewer> {
  // The canvas has an alpha channel and clears to transparent by default, so the page behind
  // it shows wherever nothing is drawn. The page, not the viewer, chooses the backdrop.
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    forceWebGL: options?.forceWebGL ?? false,
  });

  // Asking the browser for a GPU device is asynchronous, so the renderer is not usable
  // until init() resolves. PMREMGenerator throws if it runs before this point.
  // If WebGPU is unavailable, init() also switches to the WebGL 2 backend here.
  await renderer.init();

  const viewer = new ViewerImpl(container, renderer, options);
  try {
    await viewer.setEnvironment(options?.environment ?? { preset: 'room' });
  } catch (err) {
    // The caller never receives a Viewer in this case, so it could not clean up itself.
    viewer.dispose();
    throw err;
  }
  return viewer;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

class ViewerImpl implements Viewer {
  readonly backend: RendererBackend;

  private readonly emitter = new Emitter<ViewerEvents>();
  private readonly renderer: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly resizeObserver: ResizeObserver;
  private readonly timer = new THREE.Timer();
  private readonly keyLight = new THREE.DirectionalLight('#ffffff', 1);
  private readonly keyLightDirection = new THREE.Vector3(1, 2, 1.5).normalize();
  /** Holds the current model, so replacing it never touches lights or camera. It also clips sections. */
  private readonly modelRoot = new THREE.ClippingGroup();
  private readonly sectionPlane = new THREE.Plane();
  private readonly shadow = new ContactShadow();
  private readonly overlay: Overlay;
  private readonly raycaster = new THREE.Raycaster() as THREE.Raycaster & { firstHitOnly?: boolean };
  private readonly pins = new Map<string, Pin>();
  private readonly occluded = new Set<string>();
  /** Texture sharpness at flat viewing angles: 8 looks sharp and stays cheap on any GPU. */
  private readonly anisotropy: number;
  private readonly decoderPath: string;
  private readonly removeListeners: () => void;

  private draco: DRACOLoader | null = null;
  private ktx2: KTX2Loader | null = null;
  /** The loaded model inside modelRoot. Pins and measurements live in its coordinates. */
  private model: THREE.Object3D | null = null;
  private modelBox = new THREE.Box3();
  private trueScale = true;
  private lightDistance = DEFAULT_LIGHT_DISTANCE;
  /** Bounding sphere of the current model; null until the first load(). */
  private modelSphere: THREE.Sphere | null = null;
  /** Set by the user's first drag or wheel turn; from then on a resize keeps their view. */
  private userMovedCamera = false;
  /** PMREM result we own: it lights the model through scene.environment. */
  private envTarget: THREE.CubeRenderTarget | null = null;
  /** Original panorama we own: PMREM output is too blurry to use as a background. */
  private equirect: THREE.Texture | null = null;
  private showBackground = false;
  private disposed = false;
  /** Belongs to the newest load(). Aborting it cancels that download. */
  private loadManager: THREE.LoadingManager | null = null;
  // Lets the newest environment win when HDR downloads overlap.
  private envRequest = 0;

  private currentTool: Tool = 'orbit';
  private measurements: Measurement[] = [];
  private measureCount = 0;
  private pendingStart: Vec3 | null = null;
  private hoverPoint: Vec3 | null = null;
  private pointerDown: { x: number; y: number; time: number } | null = null;
  private hoverFrame = 0;
  private activePin: string | null = null;
  private flight: { from: ViewState; to: ViewState; start: number } | null = null;
  /** Render-on-demand: set whenever the picture may have changed. */
  private needsRender = true;
  private lastOcclusion = 0;
  private occlusionStale = false;

  constructor(container: HTMLElement, renderer: THREE.WebGPURenderer, options?: ViewerOptions) {
    this.renderer = renderer;
    this.decoderPath = options?.decoderPath ?? '/decoders/';

    // Narrow cast: @types/three declares this flag only on the WebGPUBackend subclass,
    // while renderer.backend is typed as the shared base class.
    const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
    this.backend = isWebGPU ? 'webgpu' : 'webgl2';
    this.anisotropy = Math.min(8, renderer.getMaxAnisotropy());

    // three's own handler logs the loss and stops drawing. This adds an event for the page.
    const reportToThree = renderer.onDeviceLost;
    renderer.onDeviceLost = (info) => {
      reportToThree.call(renderer, info); // three's handler uses `this`.
      this.emitter.emit('error', {
        code: 'device-lost',
        message: `The graphics device was lost (${info.api}): ${info.message}`,
        cause: info,
      });
    };

    // Neutral keeps base colours closest to the real object, which matters for scans.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    canvas.tabIndex = 0;
    canvas.setAttribute(
      'aria-label',
      `${options?.label ?? '3D model viewer'}. Drag to rotate, scroll or pinch to zoom. With the view focused, arrow keys pan and Shift with arrow keys rotates.`,
    );
    container.appendChild(canvas);
    this.overlay = new Overlay(container, (id) => this.emitter.emit('pin-click', { id }));

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.camera.position.set(3, 2, 3); // Replaced by auto-framing on the first load().

    this.modelRoot.enabled = false;
    this.modelRoot.clippingPlanes = [this.sectionPlane];
    this.scene.add(this.modelRoot, this.shadow.mesh);

    // A light's direction runs from its position to its target, so the target must be
    // in the scene as well for its transform to update.
    this.scene.add(this.keyLight, this.keyLight.target);
    this.updateKeyLightPosition();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // Stops the camera flipping over the bottom pole.
    this.controls.maxPolarAngle = Math.PI * 0.95;
    // The wheel zooms towards the point under the pointer, so a detail is one gesture away.
    this.controls.zoomToCursor = true;
    // A grab hand over the canvas shows that the model can be dragged.
    this.controls.cursorStyle = 'grab';
    this.controls.listenToKeyEvents(canvas);
    // 'start' fires on the first pointer or wheel input of a gesture.
    this.controls.addEventListener('start', () => {
      this.userMovedCamera = true;
      this.flight = null; // The user takes over from a running flight.
    });
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });
    this.controls.addEventListener('end', () => this.emitter.emit('view-change', this.getView()));

    this.raycaster.firstHitOnly = true;

    // Created after init() and reused, because it holds its own GPU resources.
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return; // For example a hidden tab panel.
      // Read on every resize, because browser zoom changes the pixel ratio. Capped because
      // phone and laptop screens can reach 3x or more, which multiplies the pixels shaded per
      // frame with little visible gain.
      // shortcut: a move to a monitor with another pixel ratio but the same CSS size does not trigger a resize; add a matchMedia('(resolution: …dppx)') listener if users report a blurry image.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      // false: leave the canvas CSS at 100%, so the container alone controls its size.
      renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      // A layout that settles after loading must not leave the model cropped, so the camera
      // refits along its current direction. Once the user has moved it, their view stays.
      if (!this.userMovedCamera) {
        this.placeCamera(this.camera.position.clone().sub(this.controls.target).normalize());
      }
      this.needsRender = true;
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(container);

    this.removeListeners = this.listenForClicks(canvas);

    // The timer measures the time between frames, so auto-rotate turns at the same speed on a
    // 60 Hz and a 120 Hz display. connect() makes it ignore time spent in a background tab.
    this.timer.connect(document);
    void renderer.setAnimationLoop((time) => this.frame(time));
  }

  get tool(): Tool {
    return this.currentTool;
  }

  async load(url: string, options?: LoadOptions): Promise<ModelInfo> {
    if (this.disposed) throw new Error('[viewer] load() called after dispose()');

    // The newest load() wins. Aborting the manager cancels the download that is still running.
    this.loadManager?.abort();
    const manager = new THREE.LoadingManager();
    this.loadManager = manager;

    const format = options?.format ?? modelFormat(url);
    const loader = format === 'ply' ? new PLYLoader(manager) : this.gltfLoader(manager);
    if (options?.headers) loader.setRequestHeader(options.headers);
    if (options?.withCredentials) loader.setWithCredentials(true);

    const onProgress = (event: ProgressEvent) => {
      this.emitter.emit('progress', progressPayload(url, event.loaded, event.total, event.lengthComputable));
    };

    let model: THREE.Object3D;
    try {
      model =
        loader instanceof PLYLoader
          ? plyObject(await loader.loadAsync(url, onProgress))
          : (await loader.loadAsync(url, onProgress)).scene;
    } catch (cause) {
      // Replaced by a newer load() or by dispose(). Not an error for the page: no "error" event.
      if (this.loadManager !== manager) throw abortError(url);
      // Still the newest load, yet cancelled: three shares one download between requests for
      // the same URL, and this one joined a download that an older load() cancelled. three has
      // already forgotten that download, so starting again opens a fresh one, which only a
      // newer load() or dispose() can cancel.
      if (isAbortError(cause)) return this.load(url, options);
      throw this.fail('load', `Failed to load model "${url}"`, cause);
    }

    if (this.loadManager !== manager) {
      // The download finished, but a newer load() or dispose() happened while it was being read.
      disposeModel(model);
      throw abortError(url);
    }

    // Turned before measuring, so the box, the shadow and the camera all see it upright.
    if (options?.up) orientUp(model, options.up);

    // Measured before the swap, so a model that cannot be shown is rejected like a failed
    // download and the current model stays on screen.
    let measured: ReturnType<typeof measureModel>;
    try {
      measured = measureModel(model);
    } catch (cause) {
      disposeModel(model);
      throw this.fail('load', `Failed to load model "${url}"`, cause);
    }
    const { box, triangles } = measured;

    prepareModel(model, this.anisotropy);

    // The old model is removed only now, so a failed load keeps the current model on screen.
    disposeModel(this.modelRoot);
    this.modelRoot.clear();
    this.clearTools();

    // The model is not recentred or rescaled: pins are stored in model space and the
    // ruler needs true scale. The camera moves to the model instead.
    // modelRoot sits at the origin unrotated, so the box measured above is still correct.
    this.modelRoot.add(model);
    model.updateWorldMatrix(true, true);
    this.model = model;
    this.modelBox = box.clone();
    this.trueScale = options?.trueScale ?? true;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // An empty model reports radius -1. Falling back to 1 keeps the camera maths valid.
    const radius = sphere.radius > 0 ? sphere.radius : 1;

    // Baked once here: the model never moves, so the shadow never needs redrawing per frame.
    this.shadow.update(this.renderer, this.scene, this.modelRoot, box);

    this.modelSphere = new THREE.Sphere(center, radius);
    this.raycaster.params.Points.threshold = radius * 0.005;
    this.placeCamera(DEFAULT_VIEW_DIRECTION);
    this.overlay.syncPins([...this.pins.values()]);
    this.needsRender = true;

    const info: ModelInfo = {
      url,
      triangles,
      radius,
      size: toVec3(size),
      center: toVec3(center),
    };
    this.emitter.emit('loaded', info);
    return info;
  }

  resetView(): void {
    if (!this.modelSphere) return;
    const { center, radius } = this.modelSphere;
    const distanceToFit = fitDistance(radius, THREE.MathUtils.degToRad(this.camera.fov), this.camera.aspect);
    const position = center.clone().addScaledVector(DEFAULT_VIEW_DIRECTION, distanceToFit);
    this.setView({ position: toVec3(position), target: toVec3(center) });
    this.userMovedCamera = false;
  }

  setAutoRotate(on: boolean): void {
    // OrbitControls turns 30 seconds per turn at its default speed and pauses while dragged.
    this.controls.autoRotate = on && !prefersReducedMotion();
    this.needsRender = true;
  }

  zoom(factor: number): void {
    if (!(factor > 0)) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const length = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).addScaledVector(offset.normalize(), length);
    this.controls.update();
    this.userMovedCamera = true;
    this.needsRender = true;
    this.emitter.emit('view-change', this.getView());
  }

  getView(): ViewState {
    return { position: toVec3(this.camera.position), target: toVec3(this.controls.target) };
  }

  setView(view: ViewState, options?: { animate?: boolean }): void {
    if (!isViewState(view)) return;
    this.userMovedCamera = true;
    if ((options?.animate ?? true) && !prefersReducedMotion()) {
      this.flight = { from: this.getView(), to: view, start: performance.now() };
    } else {
      this.flight = null;
      this.applyView(view);
      this.emitter.emit('view-change', this.getView());
    }
    this.needsRender = true;
  }

  setLighting(update: LightingUpdate): void {
    if (update.exposure !== undefined) {
      this.renderer.toneMappingExposure = update.exposure;
    }
    if (update.toneMapping !== undefined) {
      this.renderer.toneMapping = TONE_MAPPING[update.toneMapping];
    }

    const key = update.keyLight;
    if (key?.intensity !== undefined) this.keyLight.intensity = key.intensity;
    if (key?.color !== undefined) this.keyLight.color.set(key.color);
    if (key?.direction !== undefined) {
      this.keyLightDirection.set(...key.direction).normalize();
      this.updateKeyLightPosition();
    }

    if (update.groundShadow?.opacity !== undefined) {
      this.shadow.setOpacity(update.groundShadow.opacity);
    }
    this.needsRender = true;
  }

  /**
   * Fields left out keep their current value, so `{ intensity: 2 }` changes only the
   * intensity. An `hdrUrl` wins over `preset`.
   */
  async setEnvironment(options: EnvironmentOptions): Promise<void> {
    if (this.disposed) throw new Error('[viewer] setEnvironment() called after dispose()');

    try {
      if (options.hdrUrl !== undefined) {
        const request = ++this.envRequest;
        const equirect = await new HDRLoader().loadAsync(options.hdrUrl);
        if (request !== this.envRequest) {
          equirect.dispose(); // A newer environment or dispose() won while this downloaded.
          return;
        }
        // Tells three this flat image is a full 360° panorama, not an ordinary texture.
        equirect.mapping = THREE.EquirectangularReflectionMapping;
        // The renderer would do this automatically since r131 if scene.environment were
        // the panorama. We call it explicitly to learn it and to own the disposal.
        this.replaceEnvironment(this.pmrem.fromEquirectangular(equirect), equirect);
      } else if (options.preset !== undefined) {
        this.applyPreset(options.preset);
      }
    } catch (cause) {
      throw this.fail('environment', `Failed to set environment "${options.hdrUrl ?? options.preset}"`, cause);
    }

    if (options.intensity !== undefined) this.scene.environmentIntensity = options.intensity;
    if (options.showBackground !== undefined) this.showBackground = options.showBackground;
    this.scene.background = this.showBackground && this.equirect ? this.equirect : null;
    this.needsRender = true;
  }

  setTool(tool: Tool): void {
    if (tool === this.currentTool) return;
    this.currentTool = tool;
    this.pendingStart = null;
    this.hoverPoint = null;
    // The grab hand says "drag me"; a crosshair says "click a point".
    this.controls.cursorStyle = tool === 'orbit' ? 'grab' : 'auto';
    this.renderer.domElement.style.cursor = tool === 'orbit' ? '' : 'crosshair';
    if (tool !== 'orbit') this.ensureBvh();
    this.needsRender = true;
    this.emitter.emit('tool-change', { tool });
  }

  getMeasurements(): Measurement[] {
    return this.measurements.map((m) => ({ ...m }));
  }

  undoMeasurement(): void {
    if (this.pendingStart) {
      this.pendingStart = null;
    } else if (this.measurements.length > 0) {
      this.measurements = this.measurements.slice(0, -1);
      this.emitter.emit('measurements-change', { measurements: this.getMeasurements() });
    }
    this.needsRender = true;
  }

  clearMeasurements(): void {
    this.pendingStart = null;
    if (this.measurements.length > 0) {
      this.measurements = [];
      this.emitter.emit('measurements-change', { measurements: [] });
    }
    this.needsRender = true;
  }

  setPins(pins: Pin[]): void {
    this.pins.clear();
    for (const pin of pins) this.pins.set(pin.id, pin);
    this.overlay.syncPins(pins);
    if (pins.length > 0) this.ensureBvh();
    this.occlusionStale = true;
    this.needsRender = true;
  }

  addPin(pin: Pin): void {
    this.pins.set(pin.id, pin);
    this.setPins([...this.pins.values()]);
  }

  removePin(id: string): void {
    this.pins.delete(id);
    if (this.activePin === id) this.setActivePin(null);
    this.setPins([...this.pins.values()]);
  }

  setActivePin(id: string | null): void {
    this.activePin = id;
    this.overlay.setActivePin(id);
  }

  focusPin(id: string): void {
    const pin = this.pins.get(id);
    if (!pin || !this.model || !this.modelSphere) return;
    const point = this.toWorld(pin.position);
    const normal = this.toWorldDirection(pin.normal);
    const current = this.camera.position.clone().sub(this.controls.target).normalize();
    // Mostly in front of the surface, keeping a little of the current angle so the move feels natural.
    const direction = normal.multiplyScalar(0.75).add(current.multiplyScalar(0.25)).normalize();
    const close = Math.max(this.modelSphere.radius * 1.1, this.controls.minDistance * 1.2);
    this.setView({ position: toVec3(point.clone().addScaledVector(direction, close)), target: toVec3(point) });
    this.setActivePin(id);
  }

  setSection(options: SectionOptions): void {
    this.modelRoot.enabled = options.enabled;
    if (options.enabled) {
      const plane = sectionPlane(
        toVec3(this.modelBox.min),
        toVec3(this.modelBox.max),
        options.axis ?? 'y',
        options.position ?? 0.5,
        options.flip ?? false,
      );
      this.sectionPlane.normal.set(...plane.normal);
      this.sectionPlane.constant = plane.constant;
    }
    this.raycaster.firstHitOnly = !options.enabled; // Hits on the cut-away side must be skipped.
    this.occlusionStale = true;
    this.needsRender = true;
  }

  screenshot(options?: ScreenshotOptions): Promise<Blob> {
    const canvas = this.renderer.domElement;
    // Render and copy in the same task: the drawing buffer is only guaranteed until it is shown.
    this.renderer.render(this.scene, this.camera);
    const scale = options?.maxSize ? Math.min(1, options.maxSize / Math.max(canvas.width, canvas.height)) : 1;
    const copy = document.createElement('canvas');
    copy.width = Math.round(canvas.width * scale);
    copy.height = Math.round(canvas.height * scale);
    copy.getContext('2d')?.drawImage(canvas, 0, 0, copy.width, copy.height);
    return new Promise((resolve, reject) => {
      copy.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('[viewer] The browser could not encode the screenshot'))),
        options?.type ?? 'image/webp',
        options?.quality ?? 0.9,
      );
    });
  }

  on<K extends keyof ViewerEvents>(
    type: K,
    handler: (event: ViewerEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(type, handler);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Cancels a model download still in flight, and makes an HDR download discard its result.
    this.loadManager?.abort();
    this.loadManager = null;
    this.envRequest++;

    void this.renderer.setAnimationLoop(null);
    cancelAnimationFrame(this.hoverFrame);
    this.removeListeners();
    this.timer.dispose();
    this.resizeObserver.disconnect();
    this.controls.dispose();

    disposeModel(this.modelRoot);
    this.modelRoot.clear();
    this.model = null;
    this.shadow.dispose();
    this.replaceEnvironment(null, null);
    this.pmrem.dispose();
    this.draco?.dispose();
    this.ktx2?.dispose();
    this.overlay.dispose();

    void this.renderer.dispose(); // Asynchronous since r186; nothing here depends on it finishing.
    this.renderer.domElement.remove();
    this.emitter.clear();
  }

  // ---------------------------------------------------------------------------------------------

  private frame(time: number): void {
    this.timer.update(time);
    const now = performance.now();
    if (this.flight) {
      const t = Math.min(1, (now - this.flight.start) / FLIGHT_MS);
      const eased = easeInOutCubic(t);
      this.applyView({
        position: lerpVec3(this.flight.from.position, this.flight.to.position, eased),
        target: lerpVec3(this.flight.from.target, this.flight.to.target, eased),
      });
      if (t >= 1) {
        this.flight = null;
        this.emitter.emit('view-change', this.getView());
      }
      this.needsRender = true;
    }
    // update() returns true while damping or auto-rotate still moves the camera.
    const moved = this.controls.update(this.timer.getDelta());
    if (moved) this.occlusionStale = true;
    const occlusionDue = this.occlusionStale && now - this.lastOcclusion > OCCLUSION_INTERVAL_MS;
    if (!moved && !this.needsRender && !occlusionDue) return; // Nothing changed: skip the frame.
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
    if (occlusionDue) {
      this.updateOcclusion();
      this.lastOcclusion = now;
      this.occlusionStale = moved;
    }
    this.renderOverlay();
  }

  private applyView(view: ViewState): void {
    this.camera.position.set(...view.position);
    this.controls.target.set(...view.target);
    this.controls.update();
    this.keyLight.target.position.copy(this.controls.target);
    this.updateKeyLightPosition();
  }

  private gltfLoader(manager: THREE.LoadingManager): GLTFLoader {
    // Decoders are created on the first glTF load and fetched only if a file needs them.
    this.draco ??= new DRACOLoader().setDecoderPath(`${this.decoderPath}draco/`);
    this.ktx2 ??= new KTX2Loader().setTranscoderPath(`${this.decoderPath}basis/`).detectSupport(this.renderer);
    return new GLTFLoader(manager).setDRACOLoader(this.draco).setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
  }

  private listenForClicks(canvas: HTMLCanvasElement): () => void {
    const onDown = (event: PointerEvent) => {
      if (event.button === 0) this.pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
    };
    const onUp = (event: PointerEvent) => {
      const down = this.pointerDown;
      this.pointerDown = null;
      if (!down || event.button !== 0 || this.currentTool === 'orbit') return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (moved < CLICK_SLOP_PX && performance.now() - down.time < CLICK_MAX_MS) this.onClick(event);
    };
    const onMove = (event: PointerEvent) => {
      if (this.currentTool !== 'measure' || !this.pendingStart || this.pointerDown) return;
      cancelAnimationFrame(this.hoverFrame);
      const { clientX, clientY } = event;
      // At most one raycast per frame while the pointer moves.
      this.hoverFrame = requestAnimationFrame(() => {
        const hit = this.pick(clientX, clientY);
        this.hoverPoint = hit ? this.toModel(hit.point) : null;
        this.needsRender = true;
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || this.currentTool === 'orbit') return;
      if (this.pendingStart) {
        this.pendingStart = null;
        this.hoverPoint = null;
        this.needsRender = true;
      } else {
        this.setTool('orbit');
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }

  private onClick(event: PointerEvent): void {
    const hit = this.pick(event.clientX, event.clientY);
    if (!hit) return;
    const point = this.toModel(hit.point);
    if (this.currentTool === 'annotate') {
      const faceNormal = hit.face?.normal ?? new THREE.Vector3(0, 1, 0);
      const worldNormal = faceNormal.clone().transformDirection(hit.object.matrixWorld);
      // A surface seen from behind (double-sided scans) should get a pin facing the camera.
      if (worldNormal.dot(this.raycaster.ray.direction) > 0) worldNormal.negate();
      this.emitter.emit('pin-place', { position: point, normal: this.toModelDirection(worldNormal) });
      return;
    }
    if (!this.pendingStart) {
      this.pendingStart = point;
    } else {
      const measurement: Measurement = {
        id: `m${++this.measureCount}`,
        start: this.pendingStart,
        end: point,
        distance: distance(this.pendingStart, point),
      };
      this.measurements = [...this.measurements, measurement];
      this.pendingStart = null;
      this.hoverPoint = null;
      this.emitter.emit('measure', { ...measurement });
      this.emitter.emit('measurements-change', { measurements: this.getMeasurements() });
    }
    this.needsRender = true;
  }

  /** Builds a bounding-volume tree per mesh once, so each raycast takes microseconds, not a full scan. */
  private ensureBvh(): void {
    this.model?.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry as BvhGeometry;
      if (!geometry.boundsTree) {
        geometry.boundsTree = new MeshBVH(geometry);
        mesh.raycast = acceleratedRaycast;
      }
    });
  }

  private pick(clientX: number, clientY: number): THREE.Intersection | null {
    if (!this.model) return null;
    this.ensureBvh();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.firstVisibleHit(this.raycaster.intersectObject(this.model, true));
  }

  private firstVisibleHit(hits: THREE.Intersection[]): THREE.Intersection | null {
    if (!this.modelRoot.enabled) return hits[0] ?? null;
    return hits.find((hit) => this.sectionPlane.distanceToPoint(hit.point) >= 0) ?? null;
  }

  private updateOcclusion(): void {
    this.occluded.clear();
    if (!this.model || this.pins.size === 0) return;
    const origin = this.camera.position;
    const tolerance = (this.modelSphere?.radius ?? 1) * 0.02;
    for (const pin of this.pins.values()) {
      const point = this.toWorld(pin.position);
      const toPin = point.clone().sub(origin);
      const length = toPin.length();
      this.raycaster.set(origin, toPin.divideScalar(length));
      this.raycaster.far = length;
      const hit = this.firstVisibleHit(this.raycaster.intersectObject(this.model, true));
      if (hit && hit.distance < length - tolerance) this.occluded.add(pin.id);
    }
    this.raycaster.far = Infinity;
  }

  private renderOverlay(): void {
    const pins: PinView[] = [...this.pins.values()].map((pin) => {
      const world = this.toWorld(pin.position);
      const point = this.project(world);
      // A pin on the part a section cuts away would float in the air, so it is hidden.
      if (this.modelRoot.enabled && this.sectionPlane.distanceToPoint(world) < 0) point.visible = false;
      return { id: pin.id, title: pin.title, point, occluded: this.occluded.has(pin.id) };
    });
    const measures: MeasureView[] = this.measurements.map((m) => ({
      id: m.id,
      a: this.project(this.toWorld(m.start)),
      b: this.project(this.toWorld(m.end)),
      label: formatLength(m.distance, this.trueScale),
    }));
    if (this.pendingStart) {
      const a = this.project(this.toWorld(this.pendingStart));
      const end = this.hoverPoint ?? this.pendingStart;
      measures.push({
        id: 'pending',
        a,
        b: this.project(this.toWorld(end)),
        label: this.hoverPoint ? formatLength(distance(this.pendingStart, this.hoverPoint), this.trueScale) : '',
        pending: true,
      });
    }
    this.overlay.render(pins, measures);
  }

  private project(world: THREE.Vector3): ScreenPoint {
    const ndc = world.clone().project(this.camera);
    const canvas = this.renderer.domElement;
    return {
      x: ((ndc.x + 1) / 2) * canvas.clientWidth,
      y: ((1 - ndc.y) / 2) * canvas.clientHeight,
      visible: ndc.z > -1 && ndc.z < 1,
    };
  }

  private toWorld(point: Vec3): THREE.Vector3 {
    const vector = new THREE.Vector3(...point);
    return this.model ? this.model.localToWorld(vector) : vector;
  }

  private toModel(world: THREE.Vector3): Vec3 {
    return toVec3(this.model ? this.model.worldToLocal(world.clone()) : world);
  }

  private toWorldDirection(direction: Vec3): THREE.Vector3 {
    const vector = new THREE.Vector3(...direction);
    return this.model ? vector.transformDirection(this.model.matrixWorld) : vector.normalize();
  }

  private toModelDirection(world: THREE.Vector3): Vec3 {
    const inverse = this.model ? this.model.matrixWorld.clone().invert() : new THREE.Matrix4();
    return toVec3(world.clone().transformDirection(inverse));
  }

  private clearTools(): void {
    this.measurements = [];
    this.pendingStart = null;
    this.hoverPoint = null;
    this.occluded.clear();
    this.flight = null;
    this.emitter.emit('measurements-change', { measurements: [] });
  }

  /**
   * Moves the camera so the whole model fits on screen, looking at it from `direction`
   * (a unit vector from the model's centre towards the camera; it is not modified).
   */
  private placeCamera(direction: THREE.Vector3): void {
    if (!this.modelSphere) return; // Nothing to frame before the first load().
    const { center, radius } = this.modelSphere;

    const distanceToFit = fitDistance(radius, THREE.MathUtils.degToRad(this.camera.fov), this.camera.aspect);
    this.camera.position.copy(center).addScaledVector(direction, distanceToFit);

    // Scaling near and far with the model keeps depth precision usable for any model size.
    // near comes from the radius, not the distance: a narrow container moves the camera back,
    // and a near plane taken from that distance could cut into the model when zooming in.
    this.camera.near = radius / 100;
    this.camera.far = distanceToFit * 100;
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(center);
    // The target may move at most one radius from the centre, so panning cannot lose the model.
    this.controls.cursor.copy(center);
    this.controls.maxTargetRadius = radius;
    this.controls.minDistance = radius * 0.2;
    this.controls.maxDistance = distanceToFit * 5;
    this.controls.update();

    this.keyLight.target.position.copy(center);
    this.lightDistance = distanceToFit;
    this.updateKeyLightPosition();

    // load() hands the framing back to the viewer until the user moves again.
    this.userMovedCamera = false;
    this.needsRender = true;
  }

  private updateKeyLightPosition(): void {
    this.keyLight.position
      .copy(this.keyLight.target.position)
      .addScaledVector(this.keyLightDirection, this.lightDistance);
  }

  private applyPreset(preset: EnvironmentPreset): void {
    this.envRequest++;
    if (preset === 'none') {
      this.replaceEnvironment(null, null);
      return;
    }
    if (preset === 'room') {
      const room = new RoomEnvironment();
      const target = this.pmrem.fromScene(room, 0.04);
      room.dispose(); // Only needed to bake the PMREM, which is now a separate texture.
      this.replaceEnvironment(target, null);
      return;
    }
    const scene = preset === 'studio' ? studioScene() : outdoorScene();
    const target = this.pmrem.fromScene(scene, 0.04);
    disposeScene(scene);
    this.replaceEnvironment(target, null);
  }

  private replaceEnvironment(
    target: THREE.CubeRenderTarget | null,
    equirect: THREE.Texture | null,
  ): void {
    this.scene.environment = target?.texture ?? null;
    if (this.scene.background === this.equirect) {
      this.scene.background = null; // Never leave a disposed texture in use.
    }
    this.envTarget?.dispose();
    this.equirect?.dispose();
    this.envTarget = target;
    this.equirect = equirect;
    this.needsRender = true;
  }

  /** Reports a failure to listeners and returns the Error the caller should reject with. */
  private fail(code: ViewerErrorCode, message: string, cause: unknown): Error {
    const reason = cause instanceof Error ? `: ${cause.message}` : '';
    const fullMessage = `${message}${reason}`;
    this.emitter.emit('error', { code, message: fullMessage, httpStatus: httpStatusOf(cause), cause });
    return new Error(fullMessage, { cause });
  }
}

function toVec3(vector: THREE.Vector3): Vec3 {
  return [vector.x, vector.y, vector.z];
}
