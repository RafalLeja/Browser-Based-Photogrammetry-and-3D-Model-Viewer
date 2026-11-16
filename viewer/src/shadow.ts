// Soft "contact shadow" on the ground under the model.
//
// How it works: a camera placed under the model looks straight up and draws the model into
// a small off-screen image. Each pixel stores how close the surface above it is to the ground.
// That image is blurred once, then shown on a flat plane at ground level. The model never
// moves, so all of this runs once per load, not once per frame.
import * as THREE from 'three/webgpu';
import { positionWorld, texture, uniform, vec2, vec4 } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

/**
 * The shadow camera sees only this layer, and update() puts the model on it. Anything else in
 * the scene (this shadow plane, and later the ruler and pins) stays out of the shadow image.
 */
const SHADOW_LAYER = 1;

/** Side of the square off-screen images, in pixels. The blur hides the low resolution. */
const RESOLUTION = 512;
/** Shadow area relative to the model's footprint. The extra room lets the blur fade out. */
const AREA_SCALE = 1.6;
/** Only the lowest part of the model darkens the ground: this fraction of its height. */
const HEIGHT_FRACTION = 0.6;
/** Blur strength, in pixels of the off-screen image. */
const BLUR_SIGMA = 14;

export class ContactShadow {
  /** The ground plane that shows the shadow. Add it to the scene once. */
  readonly mesh: THREE.Mesh;

  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly heightTarget = new THREE.RenderTarget(RESOLUTION, RESOLUTION);
  private readonly blurTarget = new THREE.RenderTarget(RESOLUTION, RESOLUTION);
  private readonly heightMaterial = new THREE.NodeMaterial();
  private readonly blur: ReturnType<typeof gaussianBlur>;
  private readonly blurMaterial = new THREE.NodeMaterial();
  private readonly blurQuad = new THREE.QuadMesh(this.blurMaterial);
  private readonly material = new THREE.MeshBasicNodeMaterial({
    color: 0x000000,
    transparent: true,
    depthWrite: false,
  });

  // Uniforms are values the shaders read. Changing `.value` needs no shader rebuild.
  private readonly groundY = uniform(0);
  private readonly range = uniform(1);
  private readonly areaMin = uniform(new THREE.Vector2());
  private readonly areaSide = uniform(1);
  private readonly opacity = uniform(0.5);

  private baked = false;

  constructor() {
    this.camera.layers.set(SHADOW_LAYER);
    // rotation.x = 90° turns the default view direction (-Z) to +Y: the camera looks up.
    // Its image then has world +X to the right and world +Z up.
    this.camera.rotation.set(Math.PI / 2, 0, 0);

    // 1 at ground level, fading to 0 at `range` above the ground. Stored in alpha.
    const closeness = positionWorld.y.sub(this.groundY).div(this.range).oneMinus().clamp(0, 1);
    this.heightMaterial.fragmentNode = vec4(0, 0, 0, closeness);
    // Scans are often open surfaces, so faces must count from both sides.
    this.heightMaterial.side = THREE.DoubleSide;

    this.blur = gaussianBlur(texture(this.heightTarget.texture), null, BLUR_SIGMA);
    // The blur node normally re-runs once per animation frame. RENDER makes it run on every
    // render that uses it, which is what a one-off bake needs.
    this.blur.updateBeforeType = THREE.NodeUpdateType.RENDER;
    this.blurMaterial.fragmentNode = this.blur;

    // The plane finds its pixel in the shadow image from its world position, so the image
    // and the ground always line up, whatever the plane's own UV layout is.
    // Full-screen passes such as the blur use image coordinates that start at the top, so
    // the blurred image is upside down compared with the camera's view. 1 - v undoes that.
    const area = positionWorld.xz.sub(this.areaMin).div(this.areaSide);
    const shadowUv = vec2(area.x, area.y.oneMinus());
    this.material.opacityNode = texture(this.blurTarget.texture, shadowUv).a.mul(this.opacity);

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.material);
    this.mesh.visible = false;
  }

  /**
   * Redraws the shadow. Call after the model changes.
   * `model` must be inside `scene`, and `box` is its bounding box in world space.
   */
  update(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    model: THREE.Object3D,
    box: THREE.Box3,
  ): void {
    model.traverse((object) => object.layers.enable(SHADOW_LAYER));

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const side = Math.max(size.x, size.z) * AREA_SCALE;
    const range = size.y * HEIGHT_FRACTION;

    this.baked = side > 0 && range > 0; // False for an empty or perfectly flat model.
    if (!this.baked) {
      this.mesh.visible = false;
      return;
    }

    this.groundY.value = box.min.y;
    this.range.value = range;
    this.areaMin.value.set(center.x - side / 2, center.z - side / 2);
    this.areaSide.value = side;

    // Start a little below the ground so the lowest points are not cut by the near plane.
    const below = range * 0.05;
    const half = side / 2;
    this.camera.left = -half;
    this.camera.right = half;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.near = 0;
    this.camera.far = range + below;
    this.camera.position.set(center.x, box.min.y - below, center.z);
    this.camera.updateProjectionMatrix();

    this.mesh.position.set(center.x, box.min.y, center.z);
    this.mesh.scale.set(side, 1, side);

    // Off-screen passes borrow the renderer and the scene, so remember what we change.
    const previousTarget = renderer.getRenderTarget();
    const previousClearAlpha = renderer.getClearAlpha();
    const previousBackground = scene.background;

    scene.background = null; // A panorama background must not end up in the shadow image.
    scene.overrideMaterial = this.heightMaterial; // Draw every object with the height material.
    renderer.setClearAlpha(0); // Empty pixels must mean "no shadow".

    // finally: if a pass throws, the viewer must not keep drawing every frame into the
    // off-screen image or with the height material.
    try {
      renderer.setRenderTarget(this.heightTarget);
      renderer.render(scene, this.camera);

      renderer.setRenderTarget(this.blurTarget);
      this.blurQuad.render(renderer);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearAlpha(previousClearAlpha);
      scene.overrideMaterial = null;
      scene.background = previousBackground;
    }

    this.mesh.visible = this.opacity.value > 0;
  }

  /** 0 hides the shadow, 1 is the darkest. */
  setOpacity(value: number): void {
    this.opacity.value = Math.min(Math.max(value, 0), 1);
    this.mesh.visible = this.baked && this.opacity.value > 0;
  }

  dispose(): void {
    this.heightTarget.dispose();
    this.blurTarget.dispose();
    this.blur.dispose();
    this.heightMaterial.dispose();
    this.blurMaterial.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
