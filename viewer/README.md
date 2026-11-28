# Viewer

A framework-free 3D model viewer built with Three.js. It shows the models produced by our photogrammetry pipeline (GLB, or the PLY mesh the pipeline exports today), with PBR lighting, HDR environments and a soft contact shadow. It will gain a measuring ruler (W04) and annotation pins (W05). The web frontend embeds it through a small API, so the frontend never depends on Three.js types.

## Requirements

- Node.js `>=22.18.0`. The unit tests run TypeScript files directly, which needs Node 22.18 or newer.
- A browser with WebGPU. Browsers without it fall back to WebGL 2 automatically.

## Run it

```powershell
npm ci
npm run dev         # Dev server. The viewer page is http://localhost:5173/viewer
npm test            # Unit tests, with Node's built-in test runner
npm run typecheck   # Type-check the source and the tests
npm run build       # Type-check, then build into dist/
npm run check       # Type-check, tests and build. Run it before committing.
```

`index.html` is the frontend's entry page (React). Its `/viewer` route, in `src/pages/viewerpage.tsx`, embeds the viewer.

On the viewer page:

- Add `?webgl` to the URL to force the WebGL 2 fallback.
- Drop a `.glb` or `.ply` file anywhere on the page to load it. This is the quickest way to test a pipeline export. A dropped `.ply` is flipped with `up: [0, -1, 0]`, because COLMAP's +Y points down.
- The model "eagle (pipeline PLY)" is Rafał's pipeline output (`public/models/eagle-dense.ply`, 3.2 million triangles). Its `up` is the normal of the ground it stands on, measured with PCA, so it stands level.
- The model "missing file (error test)" fails on purpose, so you can see how an error looks.

## API reference

Types are in [`src/types.ts`](src/types.ts). Everything is exported from [`src/index.ts`](src/index.ts).

### Functions and methods

| API | Status | Target week |
|---|---|---|
| `createViewer(container, options?)` | implemented | W01 |
| `viewer.backend` | implemented | W01 |
| `viewer.load(url, options?)` | implemented; `options` added in W02, `.ply` files in W03 | W01–W03 |
| `viewer.resetView()` | implemented: back to the default view of the current model | W02 |
| `viewer.setAutoRotate(on)` | implemented: one turn in 30 seconds, pauses while the user drags | W02 |
| `viewer.setLighting(update)` | implemented | W01 |
| `viewer.setEnvironment(options)` | partial: presets `studio` and `outdoor` missing | W06 |
| `viewer.enableMeasure(on)` | stub: stores the flag and logs a warning | W04 |
| `viewer.addPin(pin)` / `viewer.removePin(id)` | stub: stores the pin and logs a warning, draws nothing | W05 |
| `viewer.on(type, handler)` | implemented, returns an unsubscribe function | W01 |
| `viewer.dispose()` | implemented, a second call does nothing | W01 |

### Options

| Option | Type | Status | Target week |
|---|---|---|---|
| `ViewerOptions.forceWebGL` | `boolean` | implemented | W01 |
| `ViewerOptions.environment` | `EnvironmentOptions`, default `{ preset: 'room' }` | implemented | W01 |
| `LoadOptions.format` | `'gltf' \| 'ply'`, default from the URL path: `.ply` is `'ply'`, anything else `'gltf'`. Needed for `blob:` URLs | implemented | W03 |
| `LoadOptions.up` | `Vec3`, the model's up direction in its own coordinates; the viewer turns the model so it points up | implemented | W03 |
| `LoadOptions.headers` | `Record<string, string>`, sent with the request, for example `Authorization` | implemented | W02 |
| `LoadOptions.withCredentials` | `boolean`, sends cookies to another origin | implemented | W02 |
| `LightingUpdate.exposure` | `number` | implemented | W01 |
| `LightingUpdate.toneMapping` | `'neutral' \| 'aces' \| 'agx' \| 'none'` | implemented | W01 |
| `LightingUpdate.keyLight` | `{ intensity, color, direction }`, all optional | implemented | W01 |
| `LightingUpdate.groundShadow` | `{ opacity }`, 0 hides the shadow, 1 is the darkest, starts at 0.5 | implemented | W02 |
| `EnvironmentOptions.hdrUrl` | `string`, takes precedence over `preset` | implemented | W01 |
| `EnvironmentOptions.preset` | `'room'`, `'none'` | implemented | W01 |
| `EnvironmentOptions.preset` | `'studio'`, `'outdoor'` | not implemented: logs a warning and keeps the current environment | W06 |
| `EnvironmentOptions.intensity` | `number`, starts at 1 | implemented | W01 |
| `EnvironmentOptions.showBackground` | `boolean`, starts as `false`: the canvas is transparent | implemented | W01 |

### Events

| Event | Payload | Status | Target week |
|---|---|---|---|
| `progress` | `{ url, loaded, total }`, `total` is `null` when the size is unknown or cannot be trusted | implemented | W01 |
| `loaded` | `{ url, triangles, size, center }` | implemented | W01 |
| `error` | `{ code, message, httpStatus?, cause? }`, `code` is `'load'`, `'environment'` or `'device-lost'` | implemented; `code` and `httpStatus` added in W02 | W01, W02 |
| `measure` | `{ start, end, distance }` | not emitted yet | W04 |
| `pin-click` | `{ id }` | not emitted yet | W05 |

### Behaviour to rely on

- **Container size:** the canvas fills the container, so the container needs a height. It follows container resizes automatically.
- **Transparent canvas:** the viewer draws only the model and its shadow. The container's CSS background is what shows behind them. `showBackground: true` shows the HDR panorama instead.
- **Camera fit:** the whole model fits in any container shape, including a tall, narrow panel, with a 20 % margin. When the container resizes, the camera refits, until the user first drags or zooms. From then on their view stays. `load()` and `resetView()` give the framing back to the viewer.
- **Camera limits:** panning keeps the orbit centre within one model radius of the model's centre, so the model cannot be lost. The mouse wheel zooms towards the pointer.
- **PLY files:** a PLY with faces (the pipeline's Poisson mesh) becomes a lit mesh with its vertex colours, and normals are computed when the file has none. A PLY without faces (a sparse export) becomes a 1-pixel point cloud: WebGPU draws no bigger points.
- **Failed load:** `load()` rejects and emits `error` with `code: 'load'`, and the current model stays on screen. If the server answered, `httpStatus` holds its status (404, 401, ...). A model whose vertex positions are NaN or infinite fails the same way.
- **Overlapping loads:** a newer `load()`, or `dispose()`, cancels the download in progress. The replaced call rejects with an `Error` whose `name` is `'AbortError'` and emits no `error` event. Handle it with `if (error.name === 'AbortError') return;`.
- **Progress:** `total` is `null` unless the server sent a size and `loaded` has not passed it. A compressed response announces its compressed size, while `loaded` counts the uncompressed bytes.
- **Lost graphics device:** `error` fires with `code: 'device-lost'` and the canvas stops updating. There is no automatic recovery, so offer a reload.
- **Partial updates:** `setEnvironment()` and `setLighting()` change only the fields you pass.
- **Failed creation:** if the initial environment fails to load, `createViewer()` cleans up and rejects. No `error` event is possible at that point because there is no viewer to subscribe to yet.
- **After `dispose()`:** `load()` and `setEnvironment()` reject.

## Usage from the frontend

The frontend lives in this folder too, and Vite builds both together. Import only from [`src/index.ts`](src/index.ts), with a path relative to the importing file:

```ts
import { createViewer } from '../index';

const viewer = await createViewer(container);

const offError = viewer.on('error', ({ code, httpStatus, message }) => showError(code, httpStatus, message));
viewer.on('progress', ({ loaded, total }) => updateProgressBar(total ? loaded / total : null));

try {
  const info = await viewer.load(modelUrl);
  console.log(`${info.triangles} triangles`);
} catch (error) {
  // A newer load() replaced this one: not a failure. Other failures were shown by the listener.
  if ((error as Error).name !== 'AbortError') console.debug(error);
}

// When leaving the page:
offError();
viewer.dispose();
```

## Units and coordinates

Positions and distances are in metres (glTF convention: 1 unit = 1 m), and +Y is up. Models are not recentred or rescaled. `ModelInfo.size` and `center` are true metres only once the pipeline outputs real scale (W05). The contact shadow lies under the model's lowest point, so a model that is not +Y up gets its shadow on the wrong plane.

COLMAP output is not +Y up: it keeps the first photo's camera frame, where +Y points down, and the camera's tilt. Until the pipeline turns models upright (W05), pass `load(url, { up })`. `up` only turns the model: `ModelInfo.size` and `center` are measured after the turn, while pins stay in the file's own coordinates and distances do not change.

## Folder layout

```text
viewer/
├─ index.html          Frontend entry page (React)
├─ vite.config.ts      The dev server answers 404 for missing model and HDR files
├─ tsconfig.json       TypeScript settings for src/
├─ tsconfig.test.json  The same settings plus Node's types, for test/
├─ README.md           This file
├─ public/
│  ├─ models/          DamagedHelmet.glb, eagle-dense.ply (Rafał's pipeline output)
│  └─ hdr/             studio_small_09_1k.hdr
├─ src/
│  ├─ index.ts         Public entry: createViewer and all API types
│  ├─ types.ts         The API contract, free of Three.js types
│  ├─ events.ts        Small typed event emitter
│  ├─ viewer.ts        The viewer: renderer, scene, camera, controls, loading
│  ├─ model.ts         Loaded-model helpers: free memory, count triangles, prepare textures,
│  │                   build a PLY mesh, turn a model upright
│  ├─ shadow.ts        Ground contact shadow
│  ├─ loading.ts       Model format, progress payload and error helpers
│  ├─ framing.ts       Camera distance maths
│  ├─ main.tsx, app.tsx, app.css   Frontend shell and routes
│  └─ pages/           Frontend pages: gallery, viewer page with lil-gui controls
└─ test/               Unit tests for events.ts, model.ts, loading.ts and framing.ts
```

Only `viewer.ts`, `model.ts` and `shadow.ts` import three. `loading.ts` and `framing.ts` have no three import, so Node tests them without a browser.

## Asset credits

- **DamagedHelmet:** © 2018 ctxwing, [CC BY 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode). Based on an earlier model © 2016 theblueturtle_, [CC BY-NC 4.0 International](https://creativecommons.org/licenses/by-nc/4.0/legalcode) (non-commercial use only; this is coursework). Source: [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DamagedHelmet).
- **studio_small_09 HDRI:** [Poly Haven](https://polyhaven.com/a/studio_small_09), CC0.

## Open decisions to agree with Hanna

- **Who draws what:** proposed: the viewer draws the model and the 3D overlays, the frontend draws the panels and the backdrop, as `src/pages/viewerpage.tsx` does now.
- **Event payloads:** are the fields in `ViewerEvents` enough for the frontend?
- **Display units:** millimetres or centimetres for measurements shown to users.
