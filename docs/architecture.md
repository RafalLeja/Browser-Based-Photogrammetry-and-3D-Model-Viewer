# Architecture

Vitrine has three parts that ship together: a **web app** with an embedded **viewer** library,
an **API** with a background **worker**, and the **photogrammetry pipeline**.

```mermaid
flowchart TB
  subgraph Client["Browser"]
    pages["React pages<br/>(viewer/src/pages)"]
    stage["ModelStage component"]
    viewer["Viewer library<br/>createViewer() → Viewer"]
    pages --> stage --> viewer
  end
  subgraph Server["API process (FastAPI)"]
    routes["Routes /api/v1/*"]
    worker["Worker thread<br/>(one job at a time)"]
    routes -- "notify()" --> worker
  end
  db[("Database<br/>SQLite or Postgres")]
  storage[("Storage dir<br/>uploads/ models/ thumbnails/")]
  samples[("samples/<br/>showcase files")]
  cli["photogrammetry-lib/cli.py<br/>(child process, pycolmap + CUDA)"]
  post["photogrammetry_lib.postprocess<br/>(child process)"]
  opt["viewer/scripts/optimize-glb.mjs<br/>(Node, meshopt)"]

  pages -- "fetch /api/v1 (cookie)" --> routes
  viewer -- "GET model file" --> routes
  routes --> db
  routes --> storage
  routes --> samples
  worker --> db
  worker --> cli --> storage
  worker --> post --> storage
  worker --> opt --> storage
```

## Request and job flow

```mermaid
sequenceDiagram
  actor Curator
  participant App as Web app
  participant API
  participant W as Worker
  participant P as Pipeline
  Curator->>App: Drop photos, enter title and height
  App->>App: Check types, sizes, count (lib/photos.ts)
  App->>API: POST /uploads (multipart, progress via XHR)
  API->>API: Sniff magic bytes, unpack zips safely, enforce limits
  API-->>App: 201 {object: processing, job: queued}
  API->>W: notify()
  W->>W: Claim job (UPDATE … WHERE status = 'queued')
  W->>P: cli.py --input photos --output raw.ply
  P-->>W: "[in_progress] step n/12: …" lines → stage + progress
  W->>P: postprocess raw.ply model.glb --sparse … --height-mm …
  P-->>W: manifest JSON (triangles, size, dimensions)
  W->>W: optimize-glb (meshopt), publish object
  loop every 1.5 s while active
    App->>API: GET /jobs/{id}
  end
  Curator->>App: Open model
  App->>API: GET /objects/{id}, /annotations
  App->>API: GET /objects/{id}/model (ETag, 304 when unchanged)
```

Without a CUDA GPU the worker runs `run_demo` instead of `run_colmap`: the same stages with short
pauses, then the sample scan is published with `is_demo = true`, which the UI labels everywhere.

## Data model

```mermaid
erDiagram
  users ||--|| passwords : has
  users ||--o{ sessions : "logs in"
  users ||--o{ objects : creates
  objects ||--o{ jobs : "reconstructed by"
  objects ||--o{ annotations : has
  objects ||--o{ saved_views : "shared as"
  users ||--o{ annotations : writes

  objects {
    int id PK
    string title
    text description
    json tags
    string status "processing | ready | failed"
    string model_path "storage-relative or samples:"
    string model_format "gltf | ply"
    json up "only for raw COLMAP output"
    json dimensions_mm
    int triangles
    bool is_demo
    json record "accession number, maker, date, place, material, credit line, provenance"
    string license "cc0 | cc-by | ... | all-rights-reserved"
    text alt_text "for screen readers"
    int visits
  }
  jobs {
    int id PK
    string status "queued | running | done | failed | cancelled"
    string current_stage
    int progress
    string pipeline "colmap | demo"
    json stage_times
    text log
    int attempts
    bool cancel_requested
  }
  annotations {
    int id PK
    json position "model space, metres"
    json normal
    string title
    text text
    string category "note | detail | inscription | damage | repair"
    string severity "damage only: negligible ... extreme"
  }
  saved_views {
    string id PK "8 random url-safe chars"
    json state "camera + lighting"
  }
  sessions {
    string token_hash PK "SHA-256 of the cookie"
    datetime expires_at
  }
```

## Viewer internals

- `viewer.ts` owns the renderer, camera, controls, lights, environment and the loaded model.
  It renders **only when something changed** (camera moved, damping, a flight, a tool update).
- `overlay.ts` draws pins, ruler lines and labels as HTML/SVG over the canvas, so they stay crisp
  and pins are real, focusable buttons.
- Raycasts use a bounding-volume tree (`three-mesh-bvh`), built once per model when a tool is
  first used, so clicks and pin occlusion checks stay fast on million-triangle scans.
- Pins and measurements are stored in **model space**; the viewer converts to world space for
  display, so turning a raw scan upright never moves a note off its spot.
- The section plane uses three's `ClippingGroup`, which works on both WebGPU and WebGL 2.
- `environments.ts` generates the studio and outdoor lighting from tiny scenes baked with PMREM,
  so they need no download.
- Render modes swap each mesh's material for a shared clay or normal material, and keep the
  model's own materials to put back; wireframe adds helper meshes that share the geometry and are
  skipped by picking, statistics and export.
- `camera-move` fires on every frame the camera moves; the compare page mirrors it into the other
  viewer with `mirrorView`, which keeps the angle and the zoom relative to each model's size.
- `screenshot({ fit: 'subject' })` crops to the model's projected bounding box, for covers and
  report images; `exportModel()` writes STL or OBJ from a shallow clone turned to Z up.

## Schema upgrades

`create_all` makes missing tables; `app/database/migrate.py` then adds columns that newer models
have and an older database lacks (nullable, or with a server default). Anything beyond additive
changes needs Alembic.

## Decisions

| Decision | Why | Revisit when |
|---|---|---|
| One FastAPI service with an in-process worker thread | One process to run and test; the worker still runs COLMAP in a child process, so a native crash cannot kill the API | Several GPUs or API replicas: move the queue to Redis/RQ (`EMBEDDED_WORKER=false` already disables the thread) |
| Session cookie instead of JWT | Revocable on logout, HttpOnly so scripts cannot read it, no token storage in the browser | A public API for third parties |
| `create_all` instead of migrations | The schema is still changing weekly | Before the first production deployment with real data: add Alembic |
| Vertex colours, not textures | Comes straight from COLMAP's Poisson mesh; meshopt compresses it well | Texturing (OpenMVS or Blender bake) is on the roadmap |
| Same-origin `/api` (Vite proxy, nginx) | Cookies work without cross-site settings; no CORS in production | Never, for the web app |
