# Vitrine API

FastAPI service for the collection, photo uploads, reconstruction jobs, annotations and shared
views. A background worker thread runs reconstructions one at a time.

## Run

```bash
cp .env.example .env     # set CURATOR_PASSWORD
uv sync
uv run uvicorn app.main:app --reload --reload-dir app
```

- API: `http://127.0.0.1:8000/api/v1`, interactive docs: `http://127.0.0.1:8000/api/docs`
- Data: SQLite in `storage/vitrine.db`, files in `storage/` (both ignored by Git). Set
  `DATABASE_URL` for Postgres; the older `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` variables
  also work.
- On start the API creates the tables, the curator account from `.env`, and the showcase objects
  from `../samples/` when the collection is empty. `uv run python seed.py` does the same without
  starting the server.

## Pipeline modes

| `PIPELINE` | Behaviour |
|---|---|
| `auto` (default) | COLMAP when pycolmap loads and sees a CUDA GPU, otherwise the demo pipeline |
| `colmap` | Always COLMAP; without a GPU, jobs fail with a clear error |
| `demo` | Simulated stages, then the sample scan is published, flagged `is_demo` |

The real pipeline runs `photogrammetry-lib/cli.py` and `photogrammetry_lib.postprocess` as child
processes, then `viewer/scripts/optimize-glb.mjs` when Node.js is available.

## Layout

```text
app/
├─ main.py            App factory, middleware (origin check, security headers), lifespan
├─ seed.py            Curator account and showcase objects
├─ core/              Settings (env), password hashing, sessions, rate limiter
├─ database/          Engine, sessions, declarative base
├─ models/            users, passwords, sessions, objects, jobs, annotations, saved_views
├─ schemas/           Request and response models; text cleaning and vector validation
├─ services/          Safe photo storage (magic bytes, zips), path resolution
├─ api/               Dependencies (current user, curator), serialisers, routes
└─ worker/            Job queue loop, demo and COLMAP pipelines, stage definitions
tests/                pytest suite (TestClient, temporary database and storage)
```

## Test

```bash
uv run pytest
```

See [docs/api.md](../docs/api.md) for the endpoints and [SECURITY.md](../SECURITY.md) for the
security mechanisms.
