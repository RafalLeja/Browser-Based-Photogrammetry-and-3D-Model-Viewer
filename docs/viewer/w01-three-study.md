# W01 study notes: Three.js for the viewer

Topics: GLTFLoader, OrbitControls, HDR + PMREMGenerator, and WebGPURenderer.
All facts were checked against Three.js r187 (`three@0.187.0`), the version in `viewer/package.json`.

## 1. Core model

Every Three.js program has the same parts:

- **Renderer:** draws to a `<canvas>` using the GPU.
- **Scene:** a tree of objects. A child moves with its parent.
- **Camera:** where we look from. `PerspectiveCamera` makes distant things smaller, like an eye.
- **Mesh = geometry + material:** geometry is the shape (triangles), and material is how the surface reacts to light.
- **Render loop:** calls `renderer.render(scene, camera)` once per screen refresh. Nothing moves or updates between calls.

**Units and axes:** 1 unit = 1 metre and +Y is up. This comes from the glTF specification. The ruler (W04) relies on it.

## 2. GLTFLoader

**glTF vs GLB:** glTF is the standard format for delivering 3D assets. A `.gltf` file is JSON that points to separate binary and image files. A `.glb` packs the JSON and the binary data into one file, which is what we want from the pipeline.

**What is inside a glTF:**

| Part | Meaning |
|---|---|
| Nodes | The object tree, each with a position, rotation and scale |
| Meshes | Geometry made of one or more primitives |
| Attributes | Per-vertex data: `POSITION`, `NORMAL`, `TEXCOORD_0` |
| Materials | PBR values: base colour, metalness, roughness, normal map, emissive |
| Textures | Images, either embedded or referenced by a file name |

**Loading:** `loader.loadAsync(url, onProgress)` returns a promise. The result has a `.scene` to add to our scene. The progress callback receives a `ProgressEvent`. `total` is only meaningful when `lengthComputable` is true, so the viewer sends `total: null` otherwise.

**Compression (for W06):** large models use extensions that need an extra decoder set on the loader.

| Extension | Compresses | Loader method |
|---|---|---|
| `KHR_draco_mesh_compression` (Draco) | Geometry | `setDRACOLoader()` |
| `EXT_meshopt_compression` (meshopt) | Geometry and animation | `setMeshoptDecoder()` |
| `KHR_texture_basisu` (KTX2) | Textures | `setKTX2Loader()` |

**Unlit materials:** `KHR_materials_unlit` means "ignore all lighting". `GLTFLoader` turns these materials into `MeshBasicMaterial`. Our raw scan uses them (see section 8).

## 3. OrbitControls

**How it moves:** the camera orbits a point called `controls.target`. Internally it uses spherical coordinates: a distance and two angles around the target.

| Input | Action |
|---|---|
| Left drag | Rotate |
| Right drag (or Ctrl + left drag) | Pan, which moves the target |
| Wheel | Zoom, which changes the distance |

**Damping:** with `enableDamping`, motion glides to a stop after release. The speed is reduced a little on each `controls.update()` call, so `update()` must run every frame.

**Limits:** `minDistance` and `maxDistance` limit zoom. We set `maxPolarAngle = Math.PI * 0.95` so the camera cannot flip over the bottom pole.

**Auto-frame maths from `load()`:** we want the model's whole bounding sphere on screen. Draw a right triangle from the camera to the sphere centre and on to the point where the view edge touches the sphere:

```text
sin(fov / 2) = radius / distance
distance = radius / sin(fov / 2) * 1.2     (1.2 adds a margin)
camera position = center + normalize(1, 0.6, 1) * distance
```

`near` and `far` scale with the distance (`distance / 100` and `distance * 100`). A fixed range would either cut off small models or waste depth precision on large ones.

This uses the vertical field of view only, so a tall, narrow container could crop the model.

**Render on demand (W07):** `controls` fires a `change` event when the view moves. W07 can render only then, instead of on every frame, to save battery.

## 4. HDR, PMREMGenerator and tone mapping

**Why PBR needs image-based lighting:** PBR materials reflect their surroundings. Metal has almost no colour of its own, so without surroundings it looks black. A few point lights give only a few small highlights. An environment image gives light from every direction.

**Three terms:**

- **HDR:** stores real brightness, so a lamp can be thousands of times brighter than a wall. Normal images clip at 1.0.
- **RGBE:** the `.hdr` file encoding, which stores RGB plus a shared exponent.
- **Equirectangular:** a full 360° panorama stored as a flat 2:1 image, like a world map.

**What PMREM does:** a mirror reflects sharply and a rough surface reflects a blur. Blurring per pixel at render time would be far too slow. PMREM (Prefiltered Mipmapped Radiance Environment Map) prepares blurred versions in advance, and the shader reads the one that matches the surface's roughness.

**`scene.environment` vs `scene.background`:** they are independent.

- `scene.environment` lights the materials. It is never visible by itself.
- `scene.background` is what you see behind the model.

The PMREM result is too blurry to look at, so the original panorama is kept for the background.

**Automatic vs explicit PMREM:** since r131 the renderer prefilters `scene.environment` automatically. We still call `PMREMGenerator` explicitly, for two reasons: to learn how it works, and to own the result so we can dispose of it when the environment changes.

**Tone mapping:** the screen can only show 0–1, but HDR values go far above that. Tone mapping squeezes the range into what the screen can show.

| Option | Effect |
|---|---|
| `NeutralToneMapping` | Khronos PBR Neutral. Keeps base colours close to their true values |
| `ACESFilmicToneMapping` | Film look, shifts colours and adds contrast |
| `AgXToneMapping` | Soft highlights, lower contrast |
| `NoToneMapping` | Bright values simply clip |

We chose Neutral because a scan should look like the real object.

**Exposure:** `toneMappingExposure` multiplies brightness before tone mapping, like a camera setting.

**Things we learned from testing:**

- Tone mapping also affects the background colour. Neutral subtracts a small offset from dark values, so `#1e1e1e` displayed as `[2, 3, 2]`, which is near-black. `#3c3c3c` displays as exactly `[30, 30, 30]`, which is `#1e1e1e`, so the viewer uses that value.
- The background colour therefore changes with exposure and tone mapping, along with the rest of the image.

## 5. WebGPURenderer

**WebGPU vs WebGL 2:** WebGL 2 is the older, widely supported browser GPU API. WebGPU is the newer one, closer to how modern GPUs work, and it adds compute shaders. `WebGPURenderer` supports both, so we write one code path.

**Import:** `import * as THREE from 'three/webgpu'`. Addons still come from `three/addons/...`. They import `three`, but both builds share one core, so classes stay compatible.

**Async `init()`:** requesting a GPU device takes time, so `await renderer.init()` must finish first. Without it, `PMREMGenerator.fromEquirectangular()` and `.fromScene()` throw an error. The `...Async()` variants are deprecated.

**Fallback:** if WebGPU is unavailable, `init()` switches to WebGL 2 automatically. `forceWebGL: true` forces it for testing, and `renderer.backend.isWebGPUBackend` tells us which is active. In the demo, add `?webgl` to the URL.

**Node materials (TSL):** normal materials such as `MeshStandardMaterial` are converted to node-based versions automatically. Shaders are generated for whichever backend is active.

**What to avoid:** custom GLSL `ShaderMaterial` and the old `EffectComposer` are not supported. Use TSL and `RenderPipeline` if we need custom shaders or post-processing.

## 6. Version notes (r187)

Older tutorials often show patterns that have since changed:

| Since | Old | Now |
|---|---|---|
| r180 | `RGBELoader` | `HDRLoader` |
| r181 | `PMREMGenerator.fromSceneAsync()` and other `...Async()` methods | `await renderer.init()`, then the normal methods |
| r183 | `THREE.Clock` | `THREE.Timer` |
| r183 | `PostProcessing` | `RenderPipeline` |
| r186 | `renderer.dispose()` is synchronous | `renderer.dispose()` is asynchronous |

## 7. How our code uses each topic

Everything below is in `viewer/src/viewer.ts`, the only file that imports `three`.

**Renderer setup in `createViewer()`:**

```ts
const renderer = new THREE.WebGPURenderer({
  antialias: true,
  forceWebGL: options?.forceWebGL ?? false,
});
await renderer.init();
```

**GLTFLoader in `load()`:** the old model is removed only after the new one has loaded, so a failed load leaves the current model on screen.

```ts
const gltf = await new GLTFLoader().loadAsync(url, (event) => {
  this.emitter.emit('progress', {
    url,
    loaded: event.loaded,
    total: event.lengthComputable ? event.total : null,
  });
});
```

**OrbitControls in `frameCamera()`:**

```ts
const fov = THREE.MathUtils.degToRad(this.camera.fov);
const distance = (radius / Math.sin(fov / 2)) * 1.2;
this.controls.target.copy(center);
```

**HDR and PMREM in `setEnvironment()`:**

```ts
const equirect = await new HDRLoader().loadAsync(options.hdrUrl);
equirect.mapping = THREE.EquirectangularReflectionMapping;
this.replaceEnvironment(this.pmrem.fromEquirectangular(equirect), equirect);
```

**Tone mapping in the `ViewerImpl` constructor:**

```ts
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
```

**Disposal in `disposeObject()`:** JavaScript's garbage collector cannot free GPU memory, so geometries, materials and textures are disposed explicitly.

We do not recentre or rescale models. Pins are stored in model space and the ruler needs true scale, so the camera moves instead.

## 8. Observations

**Test setup:** 2026-11-06, Chrome 156 on Windows 11, viewport 1920 × 951, `npm run dev`.

Brightness below is the mean luminance (0–255) of the central part of the view with the helmet at its default framing. Pixel values are RGB, read from the canvas.

| # | Check | Result |
|---|---|---|
| 1 | Helmet visible, lit, emissive glow | Pass. 15,452 triangles, size 1.890 × 1.802 × 2.000 units |
| 2 | Rotate, pan, zoom, damping | Pass. Rotate and zoom used real mouse input. Pan used simulated right-button events. The image kept changing after release |
| 3 | WebGPU and `?webgl` | Pass. Labels are correct. Brightness 72.4 vs 72.3, background identical |
| 4 | Studio HDR, Room, None | Pass. Brightness 72.4, 98.8, 13.4. The helmet is much darker with None, while the emissive glow stays |
| 5 | Show background | Pass. Studio panorama appears, and turning it off restores the colour |
| 6 | Exposure and tone mapping | Pass. Exposure 0, 1, 3 gives 0, 72.4, 119.5. Neutral, ACES, AgX, none gives 72.4, 82.2, 87.1, 89.2 |
| 7 | Eagle scan | Loads with problems, listed below |
| 8 | Stub buttons | Pass. Each click prints its "not implemented yet" warning |
| 9 | Resize | Pass. Canvas follows the container (1920 × 951, 700 × 500, then back) with no stretching. A hidden container is skipped |
| 10 | Other console errors | None, apart from the eagle texture errors. No GPU validation errors on either backend |

**Problems with the eagle GLB** (`images/eagle/output/mvs/scene_textured.glb`, 8,684 triangles):

1. **External textures are missing.** The GLB refers to `scene_textured_0.png` and `scene_textured_1.png`, which are not in the repository. The console shows `THREE.GLTFLoader: Couldn't load texture scene_textured_0.png`. The Vite dev server answers the missing files with `index.html` (status 200, `text/html`) rather than a 404. A plain static host would return a 404. The model renders as a flat white silhouette.
2. **Materials are unlit.** `KHR_materials_unlit` becomes `MeshBasicMaterial`, so environment and key light have no effect (brightness stayed at 216.0). Exposure and tone mapping still change it (233.2 and 232.6), because they apply to the final image.
3. **The scale is arbitrary.** The size is 9.881 × 5.367 × 5.450 units, which is not real metres yet. The ruler needs real scale (W05).

**Status:** the export requirements for Rafał, including embedded textures, are in [integration.md](integration.md).

**Performance baseline:** a quick check of the requirement targets, not the full W07 evaluation. Same setup as above, viewport 1920 × 895, on a PC with a GTX 1050 Ti and a UHD Graphics 630. The browser did not report which GPU it used.

| Model | Backend | FPS | Load, ms | First frame, ms |
|---|---|---|---|---|
| DamagedHelmet, 3.6 MB, 15,452 triangles | WebGPU | 60 | 162–185 | 191–200 |
| DamagedHelmet, 3.6 MB, 15,452 triangles | WebGL 2 | 60 | 180–352 | 333–367 |
| Test sphere, 13.4 MB, 500,000 triangles | WebGPU | 60 | 34–84 | 47–105 |
| Test sphere, 13.4 MB, 500,000 triangles | WebGL 2 | 60 | 76–183 | 84–190 |

Limits of this check:

- 60 FPS is the display's cap, so the real limit is unknown.
- The sphere has no textures and was built in memory for this test, so it is not in the repository.
- Times are from three runs after the file was already available, so they exclude download time. They are the time from starting the load to the `loaded` event and to the next frames.
- Integrated-GPU laptops were not tested.

## 9. Open questions

- 
- 
- 

## 10. References

- [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [HDRLoader](https://threejs.org/docs/pages/HDRLoader.html)
- [PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html)
- [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)
- [WebGPURenderer manual](https://threejs.org/manual/#en/webgpurenderer)
- [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [Khronos PBR Neutral tone mapper](https://github.com/KhronosGroup/ToneMapping/tree/main/PBR_Neutral)
- [Khronos glTF sample assets](https://github.com/KhronosGroup/glTF-Sample-Assets)
- [DamagedHelmet model](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DamagedHelmet)
- [Poly Haven: studio_small_09](https://polyhaven.com/a/studio_small_09)
