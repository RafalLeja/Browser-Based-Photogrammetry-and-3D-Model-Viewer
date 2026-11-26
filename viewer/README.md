# Web app and viewer

This folder holds two things that Vite builds together:

- the **viewer library** (`src/viewer.ts` and friends): a framework-free Three.js viewer with
  WebGPU and a WebGL 2 fallback, a ruler, annotation pins, sections, lighting and screenshots;
- the **web app** (`src/app.tsx`, `src/pages/`): the React product that uses it.

The web app talks to the viewer only through the public API in [`src/types.ts`](src/types.ts),
so no page depends on Three.js.

## Run it

Requires Node.js `>=22.18.0` and the API running on `http://127.0.0.1:8000` (see the root README).

```bash
npm ci
npm run dev         # http://localhost:5173 (proxies /api to the API; VITRINE_API overrides the target)
npm test            # Unit tests with Node's test runner
npm run typecheck   # Types for the app, the unit tests and the e2e tests
npm run build       # Production build into dist/
npm run e2e         # Playwright end-to-end tests (starts its own API and dev server)
npm run check       # typecheck + test + build
npm run optimize -- in.glb out.glb [--ratio 0.5]    # meshopt-compress a GLB
```

Add `?webgl` to a URL to force the WebGL 2 fallback.

## Viewer API

Everything is exported from [`src/index.ts`](src/index.ts).

```ts
import { createViewer, formatLength } from '../index';

const viewer = await createViewer(container, { environment: { preset: 'studio' }, label: '3D view of the eagle' });
viewer.on('measure', (m) => console.log(formatLength(m.distance)));
viewer.on('pin-click', ({ id }) => viewer.focusPin(id));
await viewer.load('/api/v1/objects/1/model', { trueScale: false });
viewer.setPins([{ id: '1', position: [0.25, 2.8, 0.18], normal: [0.67, 0.67, 0.33], title: 'Head' }]);
viewer.setTool('measure');
// …
viewer.dispose();
```

### Methods

| Method | What it does |
|---|---|
| `createViewer(container, options?)` | Creates the renderer (WebGPU, or WebGL 2 when unavailable) inside `container` |
| `viewer.backend` | `'webgpu'` or `'webgl2'` |
| `load(url, options?)` | Loads `.glb`/`.gltf`/`.ply`, frames the camera, resolves with `ModelInfo`; a newer `load()` cancels it with an `AbortError` |
| `resetView()` | Flies back to the default view |
| `zoom(factor)` | Closer (< 1) or further (> 1) |
| `getView()` / `setView(view, { animate })` | Read or move the camera (`{ position, target }`); animated unless reduced motion is preferred |
| `setAutoRotate(on)` | Slow turntable; off under reduced motion |
| `setLighting(update)` | Exposure, tone mapping, key light intensity, colour and direction, ground shadow |
| `setEnvironment(options)` | `hdrUrl`, or a generated `preset`: `'studio'`, `'outdoor'`, `'room'`, `'none'`; `intensity`, `showBackground` |
| `setTool(tool)` / `tool` | `'orbit'`, `'measure'` (two clicks per distance) or `'annotate'` (a click emits `pin-place`); Escape returns to orbit |
| `getMeasurements()`, `undoMeasurement()`, `clearMeasurements()` | Ruler results in model space |
| `setPins(pins)`, `addPin(pin)`, `removePin(id)` | Numbered HTML pins, dimmed when hidden behind the model |
| `setActivePin(id)`, `focusPin(id, { animate })` | Highlight a pin; fly (or jump) the camera to it |
| `viewFrom(direction, { animate })` | Look at the whole model from a direction, e.g. `[0, 0.3, 1]` for the front |
| `setRenderMode(mode)` / `renderMode` | `'standard'`, `'clay'`, `'wireframe'` or `'normals'`; point clouds keep their colours |
| `setDimensions(show)` | Bounding box with its width, depth and height labelled |
| `exportModel('stl' \| 'obj', { scale })` | The model as a binary STL or OBJ `Blob`, turned to Z up; `scale: 1000` gives millimetres |
| `setSection({ enabled, axis, position, flip })` | Cut the model with a plane; `position` runs 0–1 across the model |
| `screenshot({ type, quality, maxSize, fit, aspect, background })` | The current view as a `Blob` (without pins and labels); `fit: 'subject'` crops to the model |
| `on(event, handler)` | Subscribe; returns an unsubscribe function |
| `dispose()` | Stops rendering and frees GPU memory |

### Load options

| Option | Meaning |
|---|---|
| `format` | `'gltf'` or `'ply'`; default from the URL path. Needed for `blob:` URLs. |
| `up` | The model's own up direction, for raw COLMAP output. The model is turned; pins stay in file coordinates. |
| `trueScale` | Whether 1 unit = 1 m (default `true`); `false` makes the ruler show plain units |
| `headers`, `withCredentials` | Passed to the download |

### Events

| Event | Payload |
|---|---|
| `progress` | `{ url, loaded, total }`; `total` is `null` when the size cannot be trusted |
| `loaded` | `{ url, triangles, stats, radius, size, center }`; `stats` counts meshes, points, vertices, materials, textures and tells whether colours are per vertex |
| `error` | `{ code: 'load' \| 'environment' \| 'device-lost', message, httpStatus?, cause? }` |
| `measure` | `{ id, start, end, distance }` when a measurement completes |
| `measurements-change` | `{ measurements }` after add, undo or clear |
| `tool-change` | `{ tool }`, also after Escape |
| `pin-click` | `{ id }` |
| `pin-place` | `{ position, normal }` in model space (annotate tool) |
| `view-change` | `{ position, target }` after the user moves the camera or a flight ends |
| `camera-move` | `{ position, target }` on every frame the camera moves, for linking two viewers |

### Behaviour to rely on

- **Units:** 1 unit = 1 m, +Y up. Models are never recentred or rescaled; the camera moves instead.
- **Inside a page:** `createViewer(container, { cooperativeGestures: true })` lets the page keep
  its scrolling: a plain wheel scrolls, Ctrl/⌘ + wheel zooms, a vertical swipe scrolls the page.
- **Render on demand:** frames are drawn only when something changes, so an idle viewer costs
  almost nothing.
- **Fast picking:** a bounding-volume tree is built per mesh the first time a tool needs it.
- **Overlays:** pins, ruler lines and labels are HTML/SVG in `.vw-overlay`; style them with the
  public classes `.vw-pin`, `.vw-measure`, `.vw-measure-label`, `.vw-dot` and the
  `data-active` / `data-occluded` / `data-pending` / `data-kind` attributes (`data-kind` comes from
  a pin's `kind`, and is `dimension` on the bounding-box labels).
- **Accessibility:** the canvas is focusable with an accessible name; arrow keys pan and
  Shift + arrows rotate; pins are buttons named after their notes.
- **Compressed models:** meshopt is built in; Draco and KTX2 decoders are fetched from
  `decoderPath` (default `/decoders/`, copied there by the Vite config) only when a file needs them.
- **Failures:** a failed `load()` keeps the current model on screen and emits `error` with the
  HTTP status when there is one. A lost GPU emits `device-lost`; offer a reload.

## Web app structure

```text
src/
├─ app.tsx, main.tsx        Routes and providers
├─ api.ts                   Typed API client (fetch; XHR for upload progress)
├─ auth.tsx                 Session state and the curator route guard
├─ styles.css               Design tokens (light and dark) and all styles
├─ components/              Layout, icons, toasts, dialogs, ModelStage (React wrapper of the viewer)
├─ components/palette.tsx   The Ctrl/⌘+K command palette
├─ pages/                   home, gallery, viewerpage + object-panels, report, compare, kiosk,
│                           dashboard, upload, jobs, guide, misc
├─ lib/                     Pure helpers tested in Node: formatting, photo selection and quality,
│                           museum vocabulary and citations, lighting, kiosk loop, job states
└─ viewer.ts, overlay.ts, environments.ts, measure.ts, model.ts, shadow.ts, …   The viewer
scripts/
├─ optimize-glb.mjs         meshopt compression, also run by the reconstruction worker
└─ screenshots.mjs          Regenerates the README screenshots and the home page's feature images
e2e/                        Playwright tests and the throw-away API they start
test/                       Unit tests
```

## Asset credits

- **DamagedHelmet:** © 2018 ctxwing, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode), based on a model © 2016 theblueturtle_, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/legalcode). Source: [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DamagedHelmet).
- **studio_small_09 HDRI:** [Poly Haven](https://polyhaven.com/a/studio_small_09), CC0.
- **Icons:** drawn after [Lucide](https://lucide.dev) (ISC).
