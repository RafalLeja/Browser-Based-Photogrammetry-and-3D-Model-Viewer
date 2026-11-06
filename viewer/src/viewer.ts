// The only file that imports three. Everything else talks to the public API in types.ts,
// so the frontend never depends on Three.js types.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { Emitter } from './events';
import type {
  EnvironmentOptions,
  EnvironmentPreset,
  LightingUpdate,
  ModelInfo,
  Pin,
  RendererBackend,
  ToneMappingName,
  Unsubscribe,
  Vec3,
  Viewer,
  ViewerEvents,
  ViewerOptions,
} from './types';

// The background also passes through tone mapping, and Neutral crushes very dark values:
// '#1e1e1e' would display as near-black. This value displays as about #1e1e1e at exposure 1,
// and it moves with the exposure and tone-mapping settings like the rest of the image.
const BACKGROUND_COLOR = '#3c3c3c';

/** Distance used to place the key light until a model has been framed. */
const DEFAULT_LIGHT_DISTANCE = 5;

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
  private readonly backgroundColor = new THREE.Color(BACKGROUND_COLOR);
  private readonly keyLight = new THREE.DirectionalLight('#ffffff', 1);
  private readonly keyLightDirection = new THREE.Vector3(1, 2, 1.5).normalize();
  /** Holds the current glTF scene, so replacing a model never touches lights or camera. */
  private readonly modelRoot = new THREE.Group();
  private readonly pins = new Map<string, Pin>();

  private lightDistance = DEFAULT_LIGHT_DISTANCE;
  /** PMREM result we own: it lights the model through scene.environment. */
  private envTarget: THREE.CubeRenderTarget | null = null;
  /** Original panorama we own: PMREM output is too blurry to use as a background. */
  private equirect: THREE.Texture | null = null;
  private showBackground = false;
  private measureEnabled = false;
  private disposed = false;
  // Counters that let the newest request win when downloads overlap,
  // for example when a user switches models before the previous one has finished.
  private loadRequest = 0;
  private envRequest = 0;

  constructor(container: HTMLElement, renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;

    // Narrow cast: @types/three declares this flag only on the WebGPUBackend subclass,
    // while renderer.backend is typed as the shared base class.
    const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
    this.backend = isWebGPU ? 'webgpu' : 'webgl2';

    // Capped because phone and laptop screens can reach 3x or more, which multiplies
    // the pixels shaded per frame with little visible gain.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    this.scene.background = this.backgroundColor;
    this.scene.add(this.modelRoot);

    // A light's direction runs from its position to its target, so the target must be
    // in the scene as well for its transform to update.
    this.scene.add(this.keyLight, this.keyLight.target);
    this.updateKeyLightPosition();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // Stops the camera flipping over the bottom pole.
    this.controls.maxPolarAngle = Math.PI * 0.95;

    // Created after init() and reused, because it holds its own GPU resources.
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return; // For example a hidden tab panel.
      // false: leave the canvas CSS at 100%, so the container alone controls its size.
      renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(container);

    // Damping needs controls.update() every frame. Render-on-demand comes in W07.
    void renderer.setAnimationLoop(() => {
      this.controls.update();
      renderer.render(this.scene, this.camera);
    });
  }

  async load(url: string): Promise<ModelInfo> {
    if (this.disposed) throw new Error('[viewer] load() called after dispose()');

    const request = ++this.loadRequest;
    let gltfScene: THREE.Group;
    try {
      const gltf = await new GLTFLoader().loadAsync(url, (event) => {
        this.emitter.emit('progress', {
          url,
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : null,
        });
      });
      gltfScene = gltf.scene;
    } catch (cause) {
      throw this.fail(`Failed to load model "${url}"`, cause);
    }

    if (request !== this.loadRequest) {
      // A newer load() or dispose() happened during the download. Not an error for the
      // page, so no "error" event, but this promise must not claim the model is shown.
      disposeObject(gltfScene);
      throw new Error(`[viewer] load("${url}") was superseded`);
    }

    // The old model is removed only now, so a failed load keeps the current model on screen.
    disposeObject(this.modelRoot);
    this.modelRoot.clear();

    // The model is not recentred or rescaled: pins are stored in model space and the
    // ruler needs true scale. The camera moves to the model instead.
    this.modelRoot.add(gltfScene);

    const box = new THREE.Box3().setFromObject(this.modelRoot);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // An empty model reports radius -1. Falling back to 1 keeps the camera maths valid.
    const radius = sphere.radius > 0 ? sphere.radius : 1;

    this.frameCamera(center, radius);

    const info: ModelInfo = {
      url,
      triangles: countTriangles(this.modelRoot),
      size: toVec3(size),
      center: toVec3(center),
    };
    this.emitter.emit('loaded', info);
    return info;
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
      throw this.fail(`Failed to set environment "${options.hdrUrl ?? options.preset}"`, cause);
    }

    if (options.intensity !== undefined) this.scene.environmentIntensity = options.intensity;
    if (options.showBackground !== undefined) this.showBackground = options.showBackground;
    this.scene.background =
      this.showBackground && this.equirect ? this.equirect : this.backgroundColor;
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

    // Makes any download still in flight discard its result when it finishes.
    this.loadRequest++;
    this.envRequest++;

    void this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();

    disposeObject(this.modelRoot);
    this.modelRoot.clear();
    this.replaceEnvironment(null, null);
    this.pmrem.dispose();

    void this.renderer.dispose(); // Asynchronous since r186; nothing here depends on it finishing.
    this.renderer.domElement.remove();
    this.emitter.clear();
  }

  /** Moves the camera so the whole bounding sphere fits on screen. */
  private frameCamera(center: THREE.Vector3, radius: number): void {
    // Right triangle: camera to centre is the hypotenuse, the radius is the side opposite
    // half the field of view, so sin(fov / 2) = radius / distance. The factor 1.2 adds margin.
    // shortcut: uses the vertical FOV only, so a portrait container can crop the model.
    // Include the horizontal FOV if the frontend embeds the viewer in a tall, narrow panel.
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (radius / Math.sin(fov / 2)) * 1.2;

    const viewDirection = new THREE.Vector3(1, 0.6, 1).normalize();
    this.camera.position.copy(center).addScaledVector(viewDirection, distance);

    // Scaling near and far with the model keeps depth precision usable for any model size.
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.2;
    this.controls.maxDistance = distance * 5;
    this.controls.update();

    this.keyLight.target.position.copy(center);
    this.lightDistance = distance;
    this.updateKeyLightPosition();
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
      this.scene.background = this.backgroundColor; // Never leave a disposed texture in use.
    }
    this.envTarget?.dispose();
    this.equirect?.dispose();
    this.envTarget = target;
    this.equirect = equirect;
  }

  /** Reports a failure to listeners and returns the Error the caller should reject with. */
  private fail(message: string, cause: unknown): Error {
    const reason = cause instanceof Error ? `: ${cause.message}` : '';
    const fullMessage = `${message}${reason}`;
    this.emitter.emit('error', { message: fullMessage, cause });
    return new Error(fullMessage, { cause });
  }
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

/** Frees GPU memory. JavaScript's garbage collector cannot release buffers and textures. */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!isMesh(object)) return;
    object.geometry.dispose();

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      // Textures sit on many properties (map, normalMap, ...), so check them all.
      for (const value of Object.values(material) as unknown[]) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function countTriangles(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    if (!isMesh(object)) return;
    const { index, attributes } = object.geometry;
    triangles += (index ? index.count : attributes.position.count) / 3;
  });
  return triangles;
}

function toVec3(vector: THREE.Vector3): Vec3 {
  return [vector.x, vector.y, vector.z];
}
