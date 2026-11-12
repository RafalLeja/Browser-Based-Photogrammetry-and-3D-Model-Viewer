# W02 study notes: loading, camera, shadow and hand-off

Topics: camera fitting, cancelling downloads, progress, a transparent canvas, a contact shadow, OrbitControls additions, freeing memory, device loss, sharing the code, tests and CI.
All facts were checked against Three.js r187 (`three@0.187.0`), Vite 8.3.6, TypeScript 7.0.2 and Node 24.19.

## 1. Fitting the camera

A camera has two viewing angles: the vertical one (the camera's `fov`, 45° in the viewer) and the horizontal one, which depends on the container's shape:

```text
horizontal half angle = atan(tan(vertical half angle) × width / height)
```

The model's bounding sphere must fit inside both angles, so the smaller one decides. The right triangle from W01 still gives the distance:

```text
distance = radius / sin(smaller half angle) × 1.2     (1.2 leaves a 20 % margin)
```

| Container (width : height) | Distance, in model radii |
|---|---|
| 2 : 1 (wide) | 3.14 |
| 1 : 1 | 3.14 |
| 1 : 2 (tall) | 5.92 |
| 1 : 3 (very tall) | 8.77 |

W01 used the vertical angle only, so it stood at 3.14 radii in every container and cropped the model in a tall panel. The maths lives in `src/framing.ts`, which has no three import, so Node tests it.

**Near plane from the model.** W01 set `near = distance / 100`. In a tall container the camera stands far back, so `near` grew, and zooming in later cut into the model. Now `near = radius / 100`, which depends only on the model. `far` stays `distance × 100`.

**Refit on resize.** The camera refits along its current direction when the container changes size, until the user first drags or zooms. OrbitControls fires a `start` event on the first pointer or wheel input of a gesture, which sets the flag. `load()` and `resetView()` clear it. A layout that settles after the model has loaded therefore stays framed, and the user's own view is never overridden.

## 2. Cancelling a download

**`AbortController`** is the browser's standard way to cancel work: `controller.abort()` makes every `fetch` that got `controller.signal` stop and reject with a `DOMException` named `AbortError`.

**`LoadingManager.abort()`** wraps this in three.js. Every loader created with that manager passes the manager's signal to its downloads. The viewer creates one manager per `load()` and aborts the previous one, so a replaced download stops on the network instead of finishing in the background.

**The `AbortError` convention.** A replaced `load()` rejects with an `Error` named `AbortError` and emits no `error` event, like a cancelled `fetch`. The page writes `if (error.name === 'AbortError') return;`.

**A trap we hit: shared downloads.** three's `FileLoader` keeps one download per URL and lets later requests for the same URL join it. With cancelling, `load(a)` followed at once by `load(a)` made the second call join the first download, and aborting the first then cancelled both: no model at all. The viewer now restarts the newest load when it was cancelled although nothing newer replaced it. three forgets the cancelled download before it reports the error, so the restart opens a fresh one.

## 3. Honest progress

`FileLoader` reads the total size from the `X-File-Size` header, or else from `Content-Length`. When the server compresses the response, `Content-Length` is the compressed size, while `loaded` counts the uncompressed bytes, so a progress bar would pass 100 %.

The viewer sends `total: null` unless the server sent a size and `loaded` has not passed it. The backend should not compress GLB responses on the fly. If a proxy compresses anyway, `X-File-Size` with the uncompressed size keeps the percentage correct.

## 4. A transparent canvas

`WebGPURenderer` creates its canvas with an alpha channel and clears it to transparent (clear alpha 0). When `scene.background` is `null`, every pixel the model does not cover stays transparent, and the page behind the canvas shows through.

W01 painted a grey background. That colour went through tone mapping like the rest of the image, so it needed a workaround value (`#3c3c3c` to display as `#1e1e1e`) and still changed with exposure. Now the page owns the backdrop: a CSS gradient on `demo.html`, and whatever the frontend chooses. `showBackground: true` still shows the HDR panorama.

## 5. The contact shadow

**The idea.** A real object darkens the ground most where it nearly touches it. The viewer fakes this once per load:

1. An orthographic camera under the model looks straight up.
2. It draws the model into a small off-screen image (512 × 512). Each pixel stores how close the surface above it is to the ground: 1 at the ground, fading to 0 at 60 % of the model's height.
3. The image is blurred with a Gaussian blur (sigma 14 px).
4. A flat plane at the model's lowest point shows the blurred image as a dark, see-through patch.

**Layers.** Every object has a set of layers, and a camera draws only objects on its layers. The shadow camera sees layer 1 only, and the model is put on it, so the shadow plane itself and later the ruler and pins stay out of the shadow image.

**Override material.** `scene.overrideMaterial` draws every object with one material. The height material writes "closeness to the ground" into the alpha channel and ignores lights, textures and colours.

**Render targets.** A `RenderTarget` is an off-screen image the renderer can draw into instead of the canvas. The bake uses two: one for the height image, one for the blurred result.

**Saving and restoring state.** The bake borrows the real renderer and scene. It remembers the render target, clear alpha, background and override material, changes them, and puts them back afterwards. three has helper functions for this, but they are private and their type declarations do not match the code.

**Why `1 − v`.** A full-screen pass such as the blur reads its image starting at the top, while a camera image starts at the bottom. The blurred image is therefore upside down, on both backends. The shadow plane reads it at `1 − v` to turn it back. Without that, an asymmetric model gets a mirrored shadow.

**The blur runs on demand.** The blur node normally updates once per animation frame. For a one-off bake it is set to `NodeUpdateType.RENDER`, so it runs on the render that uses it.

**Cost.** The bake runs once per load, never per frame: about 21–23 ms the first time on WebGPU and 86–106 ms on WebGL 2 (shader compilation included), about 2 ms and 10 ms for later bakes (section 12). Drawing the shadow plane each frame costs one transparent quad.

An empty model or a perfectly flat one gets no shadow. The shadow assumes +Y is up.

## 6. Tone mapping

The Trello card asks for ACES tone mapping. The default stays **Neutral** (Khronos PBR Neutral), because it keeps base colours closest to their true values, which matters for a scan of a real object. ACES shifts colours and adds contrast for a film look.

ACES is one call away:

```ts
viewer.setLighting({ toneMapping: 'aces' });
```

The demo's "Tone mapping" menu switches between Neutral, ACES, AgX and none.

## 7. OrbitControls additions

| Property or event | What it does in the viewer |
|---|---|
| `cursor` and `maxTargetRadius` | `cursor` is the centre of a sphere the orbit target must stay inside. The viewer puts it at the model's centre, with a radius of one model radius, so panning cannot lose the model. |
| `zoomToCursor` | The wheel zooms towards the point under the pointer instead of the screen centre. Zooming towards an off-centre point leaves the target off-centre; `resetView()` recentres it. |
| `cursorStyle = 'grab'` | A grab hand over the canvas shows that the model can be dragged. |
| `autoRotate` | Turns the camera around the target at `autoRotateSpeed` (default 2: one turn in 30 seconds). It pauses while the user drags. |
| `update(deltaTime)` | With the time since the last frame in seconds, auto-rotate turns at the same speed on a 60 Hz and a 120 Hz display. |
| `start` event | Fires on the first pointer or wheel input of a gesture. The viewer uses it to stop refitting on resize. |

**`THREE.Timer`** measures the time between frames: `timer.update(time)` once per frame, then `timer.getDelta()` in seconds. `timer.connect(document)` makes it ignore time spent in a background tab, so the model does not jump when the user comes back. `THREE.Clock` is deprecated since r183.

## 8. Freeing memory

JavaScript's garbage collector cannot free GPU memory, so the viewer disposes each part of a replaced model by hand.

- **Points and lines** have a geometry and a material like meshes. W01 freed meshes only.
- **Textures** sit on many material properties (`map`, `normalMap`, `roughnessMap`, ...), so the viewer checks every property for a texture.
- **Decoded images.** `GLTFLoader` decodes images into `ImageBitmap` objects, which hold their memory until `close()` is called. `texture.dispose()` frees the GPU copy only.

## 9. Device loss

The GPU can be taken away from a page: a driver update or crash, a laptop switching graphics chips, or the system reclaiming memory. three's default handler logs the loss and stops drawing.

The viewer wraps `renderer.onDeviceLost` and emits `error` with `code: 'device-lost'`. There is no automatic recovery: the page should show a message and offer a reload. On WebGL 2 it can be tested with the `WEBGL_lose_context` extension. On WebGPU, `device.destroy()` does not trigger the handler, so a real WebGPU loss could not be tested.

## 10. Sharing the viewer with the frontend

The frontend (Hanna, branch `main-page`) lives inside `viewer/` as a React app in the same Vite project. It imports the viewer from `src/index.ts`, and Vite compiles both together, so the viewer needs no separate build or install step. A library build into `dist/viewer.js` was planned and dropped: nobody would consume it while both share one folder.

**One build, two pages.** `vite.config.ts` lists `index.html` (the frontend) and `demo.html` (the viewer test page) as build inputs. Both end up in `dist/`.

**Dev server 404s.** Vite answers an unknown path with `index.html`, so client-side routes such as `/viewer` survive a reload. For a missing model that hid the real problem: the viewer received a web page and reported "could not be read". A small plugin in `vite.config.ts` answers 404 for missing `.glb`, `.gltf`, `.bin` and `.hdr` files, after the files that exist have been served. It works in `npm run dev` only.

**Size.** The build writes one script shared by both pages: 964.32 kB, 261.74 kB gzipped. Almost all of it is three. Vite warns about scripts over 500 kB; splitting it is part of the W07 performance work.

## 11. Tests and CI

**Node's test runner.** `node --test "test/**/*.test.ts"` runs TypeScript test files directly: Node 22.18 and newer strip the types without any tool. Test files import source files with the `.ts` extension. `tsc -p tsconfig.test.json` type-checks the tests with Node's types.

| Test file | What it checks |
|---|---|
| `test/events.test.ts` | Listeners get their own event only, unsubscribe works, a throwing listener does not stop the others, `clear()` |
| `test/model.test.ts` | Triangle count (also for a mesh without positions), freeing meshes, points and textures, anisotropy, the unlit warning, measuring the bounds and rejecting NaN positions |
| `test/loading.test.ts` | `progress.total` rules, recognising `AbortError`, reading the HTTP status, the cancel error |
| `test/framing.test.ts` | Fit distance for wide, square, tall and very narrow containers |

Anything that needs a GPU (rendering, the shadow, the camera in a real page) is checked in the browser with the self-checks in section 12.

**CI.** `.github/workflows/viewer.yml` runs on pull requests and on pushes to `main` that touch `viewer/` or the workflow. One job on Ubuntu: checkout, Node 24, `npm ci`, `npm run check`. Read-only permissions.

**Lockfile and Linux.** `npm ci` installs exactly what `package-lock.json` lists. Vite and TypeScript ship native binaries per platform, so the lockfile must list the Linux ones (`@rolldown/binding-linux-x64-gnu`, `@typescript/typescript-linux-x64`) even when it was written on Windows.

## 12. Observations

**Test setup:** 2026-11-12, Brave 157 (Chromium 157) on Windows 11, viewport 1920 × 951, device pixel ratio 1, `npm run dev`, page `/demo.html`. Every check ran on WebGPU and on forced WebGL 2 (`?webgl`) unless marked.

"Solid" and "soft" pixels are canvas pixels with full and partial alpha, counted right after a frame.

| # | Check | Result |
|---|---|---|
| 1 | Two loads in a row, then a load followed by `dispose()` | Pass. Results `AbortError`, resolved, `AbortError`. Only the second model loaded. No `error` event |
| 2 | Same URL twice, and A → B → A, in one go | Pass after the fix in section 2. Before it, no model loaded at all |
| 3 | Error codes | Pass. Missing model: `load`, HTTP 404. An HTML page as model: `load`, no status. Missing HDR: `environment`, HTTP 404 |
| 4 | 300 × 900 container, then hidden, a load while hidden, then 900 × 300 | Pass. No solid pixel on the border in either shape. Solid pixels 15,477 tall, 13,802 wide on WebGPU (15,474 and 13,803 on WebGL 2), so the camera refitted |
| 5 | Zoom out with the wheel, resize, then `resetView()` (WebGL 2) | Pass. 5,091 solid pixels after zooming, 5,633 after the resize (taller box, same view), 27,180 after the reset |
| 6 | Odd models | Pass. Empty: 0 triangles, size `[0, 0, 0]`, nothing drawn. Flat triangle: 1 triangle, size `[1, 0, 1]`, no error. A NaN vertex position: `load()` rejects, `error` with `code: 'load'`, the previous model stays on screen. A mesh without positions: loads as an empty model, 0 triangles |
| 7 | Create and dispose five viewers quickly, each with a load in flight | Pass. No canvas left behind, every load rejected with `AbortError`, a second `dispose()` did nothing |
| 8 | Device loss (WebGL 2 only) | Pass. Status row: `Error (device-lost): The graphics device was lost (WebGL): Unknown reason` |
| 9 | Transparent canvas | Pass. Most pixels transparent, no solid pixel on the border. The gradient shows behind the helmet, and exposure no longer changes it |
| 10 | Shadow on and off | Pass. Soft pixels 6,466 with the shadow and 523 without on WebGPU (6,462 and 516 on WebGL 2). Solid pixels unchanged, so the model is drawn the same |
| 11 | Shadow bake time (CPU time of the bake, three runs) | First bake 21.2–23.4 ms on WebGPU, 86.1–106.2 ms on WebGL 2. Later bakes 1.9–2.8 ms and 10.0–11.1 ms |
| 12 | Helmet load, file already cached, bake included | 153–233 ms on WebGPU, 207–245 ms on WebGL 2 |
| 13 | Auto-rotate speed | Pass. Steady 11.99°/s on WebGPU, 12.00°/s on WebGL 2: 7.5 s per quarter turn, 30 s per turn. Averaged over the first 3 s it is 11.3°/s, because damping ramps the speed up |
| 14 | Background tab (simulated by faking `document.hidden`) | Pass. No jump on return: the largest step was 0.11° |
| 15 | Drag and drop (simulated with a `DataTransfer`) | Pass. A text file: `Error (load)`, the helmet stayed. `eagle.glb`: loaded with the unlit warning. `DamagedHelmet.glb`: loaded with its shadow |
| 16 | Dev server | Missing `.glb`: 404. Existing model and HDR: 200. The route `/viewer`: 200 |
| 17 | Unit tests and build | 22 of 22 tests pass. `npm ci` and `npm run check` pass on a clean copy of the files |
| 18 | Trial merge with the frontend branch | Conflicts only in `package.json` and `package-lock.json`. After resolving, `npm run check` passes |

## 13. Limits and open questions

- **Pipeline output.** The pipeline produces a sparse point cloud and no file yet. W03 needs Rafał's model in the viewer.
- **Browsers.** Only Chromium (Brave 157) was tested. Edge, Firefox and Safari are untested. A real WebGPU device loss could not be simulated.
- **Merge conflicts.** The frontend and the viewer share `package.json` and `package-lock.json`, so both branches touching dependencies will conflict. The integration guide lists the steps.
- **First shadow bake on WebGL 2** takes about 0.1 s, with shader compilation. It happens during loading, not during interaction.
- **Older browsers** without `AbortSignal.any` cannot cancel a download. The result is still ignored.
- **Production 404s.** The 404 plugin runs in the dev server only. A host with a client-side-routing fallback must also answer 404 for missing model files, or the page reports "could not be read" instead of "not found".
- **Model orientation.** A model that is not +Y up gets its shadow on the wrong plane.
- **Monitor change.** A move to a monitor with a different pixel ratio that keeps the CSS size does not trigger a resize, so the image keeps the old pixel ratio until the next resize.
- **Demo asset licence.** DamagedHelmet derives from a non-commercial (CC BY-NC) model. Fine for coursework; a commercial release needs another demo model.
- **Open with Hanna:** are the fields in `ViewerEvents` enough, and should measurements show millimetres or centimetres?

## 14. References

- [LoadingManager](https://threejs.org/docs/pages/LoadingManager.html)
- [FileLoader](https://threejs.org/docs/pages/FileLoader.html)
- [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [Timer](https://threejs.org/docs/pages/Timer.html)
- [RenderTarget](https://threejs.org/docs/pages/RenderTarget.html)
- [Layers](https://threejs.org/docs/pages/Layers.html)
- [NodeMaterial](https://threejs.org/docs/pages/NodeMaterial.html)
- [GaussianBlurNode](https://threejs.org/docs/pages/GaussianBlurNode.html)
- [QuadMesh](https://threejs.org/docs/pages/QuadMesh.html)
- [Texture](https://threejs.org/docs/pages/Texture.html) (anisotropy)
- [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)
- [MDN: AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [MDN: Content-Length](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Length)
- [Node.js test runner](https://nodejs.org/api/test.html)
- [Vite: building for production, multi-page apps](https://vite.dev/guide/build.html)
