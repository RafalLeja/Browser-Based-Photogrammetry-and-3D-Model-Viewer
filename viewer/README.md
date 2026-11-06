# Viewer

A framework-free 3D model viewer built with Three.js. It shows the GLB models produced by our photogrammetry pipeline, with PBR lighting and HDR environments. It will gain a measuring ruler (W04) and annotation pins (W05). The web frontend embeds it through a small API, so the frontend never depends on Three.js types.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- A browser with WebGPU. Browsers without it fall back to WebGL 2 automatically.

## Run it

```powershell
npm install
npm run dev         # Demo page. Add ?webgl to the URL to force the fallback.
npm run build       # Type-check and production build into dist/
npm run typecheck   # Type-check only
```

The demo's "eagle (raw scan)" model is not committed. To use it, run this inside `viewer/`:

```powershell
Copy-Item ../images/eagle/output/mvs/scene_textured.glb public/models/eagle.glb
```

## API reference

Types are in [`src/types.ts`](src/types.ts). Everything is exported from [`src/index.ts`](src/index.ts).

### Functions and methods

| API | Status | Target week |
|---|---|---|
| `createViewer(container, options?)` | implemented | W01 |
| `viewer.backend` | implemented | W01 |
| `viewer.load(url)` | implemented | W01 |
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
| `LightingUpdate.exposure` | `number` | implemented | W01 |
| `LightingUpdate.toneMapping` | `'neutral' \| 'aces' \| 'agx' \| 'none'` | implemented | W01 |
| `LightingUpdate.keyLight` | `{ intensity, color, direction }`, all optional | implemented | W01 |
| `EnvironmentOptions.hdrUrl` | `string`, takes precedence over `preset` | implemented | W01 |
| `EnvironmentOptions.preset` | `'room'`, `'none'` | implemented | W01 |
| `EnvironmentOptions.preset` | `'studio'`, `'outdoor'` | not implemented: logs a warning and keeps the current environment | W06 |
| `EnvironmentOptions.intensity` | `number`, starts at 1 | implemented | W01 |
| `EnvironmentOptions.showBackground` | `boolean`, starts as `false` | implemented | W01 |

### Events

| Event | Payload | Status | Target week |
|---|---|---|---|
| `progress` | `{ url, loaded, total }`, `total` is `null` when unknown | implemented | W01 |
| `loaded` | `{ url, triangles, size, center }` | implemented | W01 |
| `error` | `{ message, cause? }` | implemented | W01 |
| `measure` | `{ start, end, distance }` | not emitted yet | W04 |
| `pin-click` | `{ id }` | not emitted yet | W05 |

### Behaviour to rely on

- **Container size:** the canvas fills the container, so the container needs a height. It follows container resizes automatically.
- **Failed load:** `load()` rejects and emits `error`, and the current model stays on screen.
- **Overlapping loads:** the newest `load()` wins. An older call rejects without an `error` event, so a `.catch()` handles it.
- **Partial updates:** `setEnvironment()` and `setLighting()` change only the fields you pass.
- **Background colour:** it passes through tone mapping, so it changes with exposure and tone mapping.
- **Failed creation:** if the initial environment fails to load, `createViewer()` cleans up and rejects. No `error` event is possible at that point because there is no viewer to subscribe to yet.
- **After `dispose()`:** `load()` and `setEnvironment()` reject.

## Usage from the frontend

```ts
import { createViewer } from 'viewer'; // Import path still to be agreed, see Open decisions.

const viewer = await createViewer(container);

const offError = viewer.on('error', ({ message }) => showError(message));
viewer.on('progress', ({ loaded, total }) => updateProgressBar(total ? loaded / total : null));

const info = await viewer.load(modelUrl);
console.log(`${info.triangles} triangles`);

// When leaving the page:
offError();
viewer.dispose();
```

```tsx
/*
  React wrapper sketch, not compiled:

  function ModelViewer({ url }: { url: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      let viewer: Viewer | undefined;
      let unmounted = false;
      createViewer(ref.current!).then((created) => {
        if (unmounted) return created.dispose();
        viewer = created;
        return created.load(url);
      }).catch(reportError);
      return () => { unmounted = true; viewer?.dispose(); };
    }, [url]);
    return <div ref={ref} style={{ width: '100%', height: 500 }} />;
  }
*/
```

## Units and coordinates

Positions and distances are in metres (glTF convention: 1 unit = 1 m), and +Y is up. Models are not recentred or rescaled. `ModelInfo.size` and `center` are true metres only once the pipeline outputs real scale (W05).

## Folder layout

```text
viewer/
├─ index.html          Demo page (Vite entry)
├─ README.md           This file
├─ public/
│  ├─ models/          DamagedHelmet.glb, eagle.glb (local only, not committed)
│  └─ hdr/             studio_small_09_1k.hdr
└─ src/
   ├─ index.ts         Public entry: createViewer and all API types
   ├─ types.ts         The API contract
   ├─ events.ts        Small typed event emitter
   ├─ viewer.ts        Implementation, the only file that imports three
   └─ demo/main.ts     Demo page, uses only the public API and lil-gui
```

## Asset credits

- **DamagedHelmet:** © 2018 ctxwing, [CC BY 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode). Based on an earlier model © 2016 theblueturtle_, [CC BY-NC 4.0 International](https://creativecommons.org/licenses/by-nc/4.0/legalcode) (non-commercial use only; this is coursework). Source: [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/DamagedHelmet).
- **studio_small_09 HDRI:** [Poly Haven](https://polyhaven.com/a/studio_small_09), CC0.

## Open decisions to agree with Hanna

- **Import method:** Vite library mode with `"viewer": "file:../viewer"`, or npm workspaces.
- **Who draws what:** the proposal is that the viewer draws the 3D overlays and the frontend draws the panels.
- **Event payloads:** are the fields in `ViewerEvents` enough for the frontend?
- **Display units:** millimetres or centimetres for measurements shown to users.
