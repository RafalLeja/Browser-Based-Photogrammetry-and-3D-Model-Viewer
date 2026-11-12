# Changelog

API changes are additions only, so code written for 0.1.0 still compiles.

## 0.2.0 – W02 (9–15 Nov 2026)

### Added

- Soft contact shadow under the model. `setLighting({ groundShadow: { opacity } })` sets its darkness; 0 turns it off.
- `load(url, { headers, withCredentials })` for files that need a sign-in header or a cookie.
- `resetView()` moves the camera back to the default view of the current model.
- `setAutoRotate(on)` turns the camera around the model, one turn in 30 seconds.
- The `error` event carries `code` (`'load'`, `'environment'` or `'device-lost'`) and, when the server answered, `httpStatus`.
- A lost graphics device emits `error` with `code: 'device-lost'`.
- Unit tests (`npm test`) and a CI workflow that runs `npm run check` on pull requests touching `viewer/`.
- `demo.html`, the viewer test page, with drag and drop of a `.glb` file, a "Reset view" button, an "Auto-rotate" switch, a "Ground shadow" slider and a "missing file" entry that shows an error on purpose.
- The dev server answers a missing `.glb`, `.gltf`, `.bin` or `.hdr` file with 404 instead of `index.html`.
- One console warning when a model has unlit materials.
- A model whose vertex positions are NaN or infinite is rejected with `error` code `load`, and the current model stays on screen.

### Changed

- The canvas is transparent. The page behind it is the backdrop, instead of a grey colour drawn by the viewer.
- A replaced `load()` is cancelled on the network and rejects with an `Error` named `AbortError`, without an `error` event.
- The camera fit uses the container's width as well as its height, and follows resizes until the user moves the camera.
- Panning keeps the orbit centre within one model radius of the model, and the mouse wheel zooms towards the pointer.
- The camera's near plane comes from the model's size, so a narrow container no longer cuts into the model when zooming in.
- Textures use anisotropic filtering (8×), which keeps them sharp on surfaces seen at a flat angle.
- `npm run build` builds both `index.html` and `demo.html` into `dist/`.
- Node.js `>=22.18.0` is required.

### Fixed

- `progress.total` could be smaller than `loaded` for a compressed response. It is now `null` in that case.
- Point clouds, lines and decoded images were not freed when a model was replaced.
- The pixel ratio was read only once, so browser zoom left the image blurry.

## 0.1.0 – W01

- First version: `createViewer()`, `load()` with `progress`, `loaded` and `error` events, OrbitControls with damping and limits, PBR with Neutral, ACES and AgX tone mapping and exposure, HDR environments through PMREM with the panorama as an optional background, WebGPU with a WebGL 2 fallback, and the demo page.
- Stubs for the ruler (W04) and pins (W05).
