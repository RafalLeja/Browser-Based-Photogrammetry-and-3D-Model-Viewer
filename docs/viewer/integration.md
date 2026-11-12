# Viewer integration guide

What the frontend, the backend and the pipeline need to know to work with the viewer. Each section is a contract: if you need something different, tell Ali first, so the viewer and your side change together.

API details are in [`viewer/README.md`](../../viewer/README.md). Changes per version are in [`viewer/CHANGELOG.md`](../../viewer/CHANGELOG.md).

## Frontend (Hanna)

**Where the code lives.** The frontend and the viewer share `viewer/`: one Vite project and one `package.json`. Import from `src/index.ts` only, with a path relative to the importing file. From `src/pages/viewerpage.tsx` that is:

```ts
import { createViewer, type Viewer } from '../index';
```

There is no build or install step for the viewer: Vite compiles it together with the app. Do not import `three` or files such as `src/viewer.ts` directly. Only `src/index.ts` is the contract; everything behind it can change.

**Container.** It needs a height. The canvas fills it and follows its size. The canvas is transparent, so the container's CSS background is the backdrop.

**Lifecycle in React.** Create the viewer in an effect and dispose it in the effect's cleanup. In development, StrictMode runs the effect twice, and the first cleanup runs before `createViewer()` has finished, so handle that case. Ignore `AbortError` rejections: they only mean a newer `load()` replaced an older one.

The component below shows the pattern. It is a sketch and is not compiled in this repository.

```tsx
import { useEffect, useRef, useState } from 'react';
import { createViewer, type Viewer } from '../index';

export function ModelViewer({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);

  // Create once. In development, StrictMode runs this effect twice, and the cleanup
  // can run before createViewer() has finished.
  useEffect(() => {
    let unmounted = false;
    let created: Viewer | undefined;
    createViewer(container.current!)
      .then((ready) => {
        if (unmounted) return ready.dispose();
        created = ready;
        setViewer(ready);
      })
      .catch(reportError);
    return () => {
      unmounted = true;
      created?.dispose();
      setViewer(null);
    };
  }, []);

  // Load whenever the viewer is ready or the url changes. A newer load cancels the older one.
  useEffect(() => {
    if (!viewer) return;
    viewer.load(url).catch((error: Error) => {
      if (error.name !== 'AbortError') reportError(error);
    });
  }, [viewer, url]);

  return <div ref={container} style={{ width: '100%', height: 500 }} />;
}
```

The current `ViewerPage` on `main-page` guards its effect with a ref and never calls `viewer.dispose()`. Each visit to `/viewer` therefore leaves a canvas and its GPU memory behind. The pattern above fixes that.

**Smallest working example.** [`viewer/demo.html`](../../viewer/demo.html) with [`viewer/src/demo/main.ts`](../../viewer/src/demo/main.ts) is a plain page that uses the whole API: loading with progress and errors, lighting, environment, shadow, reset view, auto-rotate and drag and drop.

**Who draws what.** The viewer draws the model and, later, the 3D overlays (ruler line, pins). The frontend draws panels, buttons, the progress bar, error messages and the backdrop.

**Wireframe to API.**

| Wireframe element | API |
|---|---|
| Renderer badge | `viewer.backend` |
| Polygon count | `ModelInfo.triangles` |
| Auto-rotate | `setAutoRotate(on)` |
| Lighting | `setLighting()` and `setEnvironment()` |
| Measure | `enableMeasure(on)` (W04) |
| Pins | `addPin()`, `removePin()`, `pin-click` (W05) |
| Progress bar | `progress` event |
| Error message | `error` event |

**Errors.**

| `error` event | Suggested message |
|---|---|
| `code: 'load'`, `httpStatus` 401 or 403 | Ask the user to sign in |
| `code: 'load'`, `httpStatus` 404 | "Model not found" |
| `code: 'load'`, no `httpStatus` | "The file could not be read" |
| `code: 'environment'` | Not fatal: the lighting falls back. Optionally a small notice |
| `code: 'device-lost'` | Offer a reload |

**Merging `main-page` and `Ali`.** A trial merge on 12 Nov 2026 conflicted only in `package.json` and `package-lock.json`:

1. In `package.json`, keep both sides: the React packages from `main-page`, and `@types/node`, the scripts, the version and `engines` from `Ali`.
2. For `package-lock.json`, take either side, then run `npm install` to bring it up to date.
3. Check that `package-lock.json` still lists `@rolldown/binding-linux-x64-gnu` and `@typescript/typescript-linux-x64`. CI runs on Linux, and `npm ci` fails there without them.
4. Run `npm run check`. In the trial merge it passed: type-check including the React files, the unit tests, and both pages built.

After the merge, `/` is the frontend and `/demo.html` is the viewer test page. `vite.config.ts` keeps the client-side routes such as `/viewer` working on reload, and builds both pages.

## Backend (Wojciech)

- `GET /api/v1/models/{model_id}/file` returns the GLB bytes with `Content-Type: model/gltf-binary`.
- Send `Content-Length`. Without it the page cannot show a percentage.
- Do not compress the response on the fly. If a proxy compresses anyway, send the uncompressed size in `X-File-Size`.
- Use plain HTTP status codes for failures. The viewer forwards the status to the page.
- Authentication: a request header (the page calls `load(url, { headers })`) or a session cookie (`load(url, { withCredentials: true })`). Both work.
- If the API is on another origin: allow the origin, allow the `Authorization` header, send `Access-Control-Allow-Credentials: true` for cookies, and expose `X-File-Size` if it is used.
- Cache headers (`ETag` or `Cache-Control`) spare a repeat visitor a 20 MB download.
- One self-contained `.glb` per model, no side files.
- Annotation fields the viewer needs: `id` (string), `position` `[x, y, z]`, `normal` `[x, y, z]`, `title`, optional `text`. Position and normal are in model space: the model's own units (metres once the pipeline outputs real scale), +Y up.

## Pipeline (Rafał)

- One `.glb` file with textures embedded. No external images.
- Lit PBR materials. No `KHR_materials_unlit`: lights and the environment do not affect unlit materials.
- +Y up, resting on its lowest point. 1 unit = 1 metre once real scale is available.
- At most 500,000 triangles and 20 MB (the limits in the business requirements). Textures up to 4096 px.
- No Draco, meshopt or KTX2 compression until the viewer supports them (W06).
- Point clouds are not supported. The viewer needs a mesh.
- How to test: in `viewer/`, run `npm run dev`, open http://localhost:5173/demo.html and drop the file on the page. Open the browser console for warnings.
