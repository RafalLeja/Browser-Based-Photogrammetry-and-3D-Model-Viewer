// One of three files that import three (with model.ts and shadow.ts). The frontend talks
// only to the public API in types.ts, so it never depends on Three.js types.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { Emitter } from './events';
import { fitDistance } from './framing';
import { abortError, httpStatusOf, isAbortError, progressPayload } from './loading';
import { disposeModel, measureModel, prepareModel } from './model';
import { ContactShadow } from './shadow';
import type {
  EnvironmentOptions,
  EnvironmentPreset,
  LightingUpdate,
  LoadOptions,
  ModelInfo,
  Pin,
  RendererBackend,
  ToneMappingName,
  Unsubscribe,
  Vec3,
  Viewer,
  ViewerErrorCode,
  ViewerEvents,
  ViewerOptions,
} from './types';

/** Distance used to place the key light until a model has been framed. */
const DEFAULT_LIGHT_DISTANCE = 5;

/** From the model's centre towards the camera: front-right and a little above. */
const DEFAULT_VIEW_DIRECTION = new THREE.Vector3(1, 0.6, 1).normalize();

const TONE_MAPPING: Record<ToneMappingName, THREE.ToneMapping> = {
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  none: THREE.NoToneMapping,
};

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

  const viewer = new ViewerImpl(container, renderer);
  try {
    await viewer.setEnvironment(options?.environment ?? { preset: 'room' });
  } catch (err) {
    // The caller never receives a Viewer in this case, so it could not clean up itself.
    viewer.dispose();
    throw err;
  }
  return viewer;
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
  /** Holds the current glTF scene, so replacing a model never touches lights or camera. */
  private readonly modelRoot = new THREE.Group();
  private readonly shadow = new ContactShadow();
  private readonly pins = new Map<string, Pin>();
  /** Texture sharpness at flat viewing angles: 8 looks sharp and stays cheap on any GPU. */
  private readonly anisotropy: number;

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
  private measureEnabled = false;
  private disposed = false;
  /** Belongs to the newest load(). Aborting it cancels that download. */
  private loadManager: THREE.LoadingManager | null = null;
  // Lets the newest environment win when HDR downloads overlap.
  private envRequest = 0;

  constructor(container: HTMLElement, renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;

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

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.camera.position.set(3, 2, 3); // Replaced by auto-framing on the first load().

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
    // 'start' fires on the first pointer or wheel input of a gesture.
    this.controls.addEventListener('start', () => {
      this.userMovedCamera = true;
    });

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
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(container);

    // Damping needs controls.update() every frame. Render-on-demand comes in W07.
    // The timer measures the time between frames, so auto-rotate turns at the same speed on a
    // 60 Hz and a 120 Hz display. connect() makes it ignore time spent in a background tab.
    this.timer.connect(document);
    void renderer.setAnimationLoop((time) => {
      this.timer.update(time);
      this.controls.update(this.timer.getDelta());
      renderer.render(this.scene, this.camera);
    });
  }

  async load(url: string, options?: LoadOptions): Promise<ModelInfo> {
    if (this.disposed) throw new Error('[viewer] load() called after dispose()');

    // The newest load() wins. Aborting the manager cancels the download that is still running.
    this.loadManager?.abort();
    const manager = new THREE.LoadingManager();
    this.loadManager = manager;

    const loader = new GLTFLoader(manager);
    if (options?.headers) loader.setRequestHeader(options.headers);
    if (options?.withCredentials) loader.setWithCredentials(true);

    let gltfScene: THREE.Group;
    try {
      const gltf = await loader.loadAsync(url, (event) => {
        this.emitter.emit(
          'progress',
          progressPayload(url, event.loaded, event.total, event.lengthComputable),
        );
      });
      gltfScene = gltf.scene;
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
      disposeModel(gltfScene);
      throw abortError(url);
    }

    // Measured before the swap, so a model that cannot be shown is rejected like a failed
    // download and the current model stays on screen.
    let measured: ReturnType<typeof measureModel>;
    try {
      measured = measureModel(gltfScene);
    } catch (cause) {
      disposeModel(gltfScene);
      throw this.fail('load', `Failed to load model "${url}"`, cause);
    }
    const { box, triangles } = measured;

    prepareModel(gltfScene, this.anisotropy);

    // The old model is removed only now, so a failed load keeps the current model on screen.
    disposeModel(this.modelRoot);
    this.modelRoot.clear();

    // The model is not recentred or rescaled: pins are stored in model space and the
    // ruler needs true scale. The camera moves to the model instead.
    // modelRoot sits at the origin unrotated, so the box measured above is still correct.
    this.modelRoot.add(gltfScene);

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // An empty model reports radius -1. Falling back to 1 keeps the camera maths valid.
    const radius = sphere.radius > 0 ? sphere.radius : 1;

    // Baked once here: the model never moves, so the shadow never needs redrawing per frame.
    this.shadow.update(this.renderer, this.scene, this.modelRoot, box);

    this.modelSphere = new THREE.Sphere(center, radius);
    this.placeCamera(DEFAULT_VIEW_DIRECTION);

    const info: ModelInfo = {
      url,
      triangles,
      size: toVec3(size),
      center: toVec3(center),
    };
    this.emitter.emit('loaded', info);
    return info;
  }

  resetView(): void {
    this.placeCamera(DEFAULT_VIEW_DIRECTION);
  }

  setAutoRotate(on: boolean): void {
    // OrbitControls turns 30 seconds per turn at its default speed and pauses while dragged.
    this.controls.autoRotate = on;
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
  }

  enableMeasure(on: boolean): void {
    this.measureEnabled = on;
    console.warn('[viewer] enableMeasure not implemented yet (W04)', {
      enabled: this.measureEnabled,
    });
  }

  addPin(pin: Pin): void {
    this.pins.set(pin.id, pin);
    console.warn('[viewer] addPin stores the pin but does not draw it yet (W05)');
  }

  removePin(id: string): void {
    this.pins.delete(id);
    console.warn('[viewer] removePin removes the stored pin; pins are not drawn yet (W05)');
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
    this.timer.dispose();
    this.resizeObserver.disconnect();
    this.controls.dispose();

    disposeModel(this.modelRoot);
    this.modelRoot.clear();
    this.shadow.dispose();
    this.replaceEnvironment(null, null);
    this.pmrem.dispose();

    void this.renderer.dispose(); // Asynchronous since r186; nothing here depends on it finishing.
    this.renderer.domElement.remove();
    this.emitter.clear();
  }

  /**
   * Moves the camera so the whole model fits on screen, looking at it from `direction`
   * (a unit vector from the model's centre towards the camera; it is not modified).
   */
  private placeCamera(direction: THREE.Vector3): void {
    if (!this.modelSphere) return; // Nothing to frame before the first load().
    const { center, radius } = this.modelSphere;

    const distance = fitDistance(radius, THREE.MathUtils.degToRad(this.camera.fov), this.camera.aspect);
    this.camera.position.copy(center).addScaledVector(direction, distance);

    // Scaling near and far with the model keeps depth precision usable for any model size.
    // near comes from the radius, not the distance: a narrow container moves the camera back,
    // and a near plane taken from that distance could cut into the model when zooming in.
    this.camera.near = radius / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(center);
    // The target may move at most one radius from the centre, so panning cannot lose the model.
    this.controls.cursor.copy(center);
    this.controls.maxTargetRadius = radius;
    this.controls.minDistance = radius * 0.2;
    this.controls.maxDistance = distance * 5;
    this.controls.update();

    this.keyLight.target.position.copy(center);
    this.lightDistance = distance;
    this.updateKeyLightPosition();

    // load() and resetView() hand the framing back to the viewer until the user moves again.
    this.userMovedCamera = false;
  }

  private updateKeyLightPosition(): void {
    this.keyLight.position
      .copy(this.keyLight.target.position)
      .addScaledVector(this.keyLightDirection, this.lightDistance);
  }

  private applyPreset(preset: EnvironmentPreset): void {
    switch (preset) {
      case 'room': {
        this.envRequest++;
        const room = new RoomEnvironment();
        const target = this.pmrem.fromScene(room);
        room.dispose(); // Only needed to bake the PMREM, which is now a separate texture.
        this.replaceEnvironment(target, null);
        break;
      }
      case 'none':
        this.envRequest++;
        this.replaceEnvironment(null, null);
        break;
      case 'studio':
      case 'outdoor':
        console.warn('[viewer] preset "studio"/"outdoor" not implemented yet (W06)');
        break;
    }
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
