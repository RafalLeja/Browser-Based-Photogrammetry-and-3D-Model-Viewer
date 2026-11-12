# Viewer

A framework-free 3D model viewer built with Three.js. It shows the GLB models produced by our photogrammetry pipeline, with PBR lighting, HDR environments and a soft contact shadow. It will gain a measuring ruler (W04) and annotation pins (W05). The web frontend embeds it through a small API, so the frontend never depends on Three.js types.

## Requirements

- Node.js `>=22.18.0`. The unit tests run TypeScript files directly, which needs Node 22.18 or newer.
- A browser with WebGPU. Browsers without it fall back to WebGL 2 automatically.

## Run it

```powershell
npm ci
npm run dev         # Dev server. The viewer test page is http://localhost:5173/demo.html
npm test            # Unit tests, with Node's built-in test runner
npm run typecheck   # Type-check the source and the tests
npm run build       # Type-check, then build index.html and demo.html into dist/
npm run check       # Type-check, tests and build. CI runs this.
```

On the test page:

- Add `?webgl` to the URL to force the WebGL 2 fallback.
- Drop a `.glb` file anywhere on the page to load it. This is the quickest way to test a pipeline export.
- The model "missing file (error test)" fails on purpose, so you can see how an error looks.

`index.html` is the frontend's entry page. Until the frontend is merged, it shows the same test page without the backdrop.

The demo's "eagle (raw scan)" model is not committed. To use it, run this inside `viewer/`:

```powershell
Copy-Item ../images/eagle/output/mvs/scene_textured.glb public/models/eagle.glb
```

## API reference

Types are in [`src/types.ts`](src/types.ts). Everything is exported from [`src/index.ts`](src/index.ts). Changes per version are in [`CHANGELOG.md`](CHANGELOG.md).

### Functions and methods

| API | Status | Target week |
|---|---|---|
| `createViewer(container, options?)` | implemented | W01 |
| `viewer.backend` | implemented | W01 |
| `viewer.load(url, options?)` | implemented; `options` added in W02 | W01, W02 |
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

[`docs/viewer/integration.md`](../docs/viewer/integration.md) has a React component that survives StrictMode, the mapping from the wireframes to the API, and what the backend and the pipeline need to deliver.

## Units and coordinates

Positions and distances are in metres (glTF convention: 1 unit = 1 m), and +Y is up. Models are not recentred or rescaled. `ModelInfo.size` and `center` are true metres only once the pipeline outputs real scale (W05). The contact shadow lies under the model's lowest point, so a model that is not +Y up gets its shadow on the wrong plane.

## Folder layout

```text
viewer/
├─ index.html          Frontend entry page (until the frontend is merged: the test page)
├─ demo.html           Viewer test page, with a backdrop behind the transparent canvas
├─ vite.config.ts      Builds both pages; the dev server answers 404 for missing model and HDR files
├─ tsconfig.json       TypeScript settings for src/
├─ tsconfig.test.json  The same settings plus Node's types, for test/
├─ CHANGELOG.md        Changes per version
├─ README.md           This file
├─ public/
│  ├─ models/          DamagedHelmet.glb, eagle.glb (local only, not committed)
│  └─ hdr/             studio_small_09_1k.hdr
├─ src/
│  ├─ index.ts         Public entry: createViewer and all API types
│  ├─ types.ts         The API contract, free of Three.js types
│  ├─ events.ts        Small typed event emitter
│  ├─ viewer.ts        The viewer: renderer, scene, camera, controls, loading
│  ├─ model.ts         Loaded-model helpers: free memory, count triangles, prepare textures
│  ├─ shadow.ts        Ground contact shadow
│  ├─ loading.ts       Progress payload and error helpers
│  ├─ framing.ts       Camera distance maths
│  └─ demo/main.ts     Test page script, uses only the public API and lil-gui
└─ test/               Unit tests for events.ts, model.ts, loading.ts and framing.ts
```

Only `viewer.ts`, `model.ts` and `shadow.ts` import three. `loading.ts` and `framing.ts` have no three import, so Node tests them without a browser.

## Asset credits

- **DamagedHelmet:** © 2018 ctxwing, [CC BY 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode). Based on an earlier model © 2016 theblueturtle_, [CC BY-NC 4.0 International](https://creativecommons.org/licenses/by-nc/4.0/legalcode) (non-commercial use only; this is coursework). Source: [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DamagedHelmet).
- **studio_small_09 HDRI:** [Poly Haven](https://polyhaven.com/a/studio_small_09), CC0.

## Open decisions to agree with Hanna

- **Import method:** proposed in the [integration guide](../docs/viewer/integration.md): the frontend and the viewer share this folder, and the frontend imports from `src/index.ts`.
- **Who draws what:** proposed in the [integration guide](../docs/viewer/integration.md): the viewer draws the model and the 3D overlays, the frontend draws the panels and the backdrop.
- **Event payloads:** are the fields in `ViewerEvents` enough for the frontend?
- **Display units:** millimetres or centimetres for measurements shown to users.
