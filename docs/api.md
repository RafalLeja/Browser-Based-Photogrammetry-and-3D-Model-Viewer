# REST API

Base URL: `/api/v1`. Interactive documentation (OpenAPI): `/api/docs` while the API runs.

Requests and responses are JSON unless noted. Writes need a curator session: sign in with
`POST /auth/login`, and the browser keeps the HttpOnly `vitrine_session` cookie. Errors have the
form `{"detail": "Readable message."}` (validation errors: `{"detail": [{"loc": [...], "msg": "..."}]}`).

## Auth

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/auth/login` | anyone, 10 tries/min per IP | `{login, password}` → user, sets the session cookie |
| POST | `/auth/logout` | anyone | Ends the session (204) |
| GET | `/auth/me` | curator | The signed-in user, or 401 |

## Objects

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/objects` | anyone | Query: `q`, `tag`, `sort` (`newest`, `oldest`, `title`), `status` (curators: `ready`, `processing`, `failed`, `all`), `page`, `page_size` (≤ 60). Visitors only see `ready` objects. |
| GET | `/objects/tags` | anyone | Tags of published objects with counts |
| GET | `/objects/{id}` | anyone (drafts: curator) | One object |
| PATCH | `/objects/{id}` | curator | `title`, `description`, `tags`, `up`, `dimensions_mm`, `record`, `license`, `alt_text` (for the last three `null` clears the value) |
| DELETE | `/objects/{id}` | curator | Deletes the object, its notes, jobs and shared views, and its files: photos, model, cover and COLMAP workspace |
| GET | `/objects/{id}/model` | anyone (drafts: curator) | The model file; `ETag` + `Cache-Control: no-cache`, 304 when unchanged |
| GET | `/objects/{id}/download` | visitors: open licences only; curators: always | The model file as an attachment named after the title |
| POST | `/objects/{id}/visit` | anyone | Counts a visit (204). The same visitor counts once per object per 30 minutes; curators are not counted. |
| GET | `/objects/{id}/thumbnail` | anyone | Cover image |
| PUT | `/objects/{id}/thumbnail` | curator | Raw PNG, JPEG or WebP body, ≤ 3 MB |

Object fields: `id, title, description, tags, record, license, downloadable, alt_text, visits,
status, model_url, model_format, up, dimensions_mm, triangles, file_size, thumbnail_url, is_demo,
job_id, annotation_count, created_at, updated_at`.

- `record`: the museum record, any of `accession_number, maker, date, place, material,
  credit_line, provenance` (free text; empty fields are dropped; unknown fields are refused).
  Search (`q`) also looks in these fields.
- `license`: `cc0, cc-by, cc-by-sa, cc-by-nc, cc-by-nc-nd, all-rights-reserved`, or `null` (not
  stated). `downloadable` is true for the open (Creative Commons) licences.
- `alt_text`: a text alternative for screen readers (WCAG 1.1.1), up to 1000 characters.
- `model_url` changes only when the model file does, so editing details never reloads the model.

## Uploads

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/uploads` | curator, 30/hour | Multipart: `title` (required), `description`, `tags` (comma-separated), `real_height_mm`, and `files` (JPEG/PNG photos or zips of them). Returns `{object, job, skipped_files}` with status 201. |

Rules: 3–500 photos, ≤ 40 MB each, ≤ 4 GB in total. Files are recognised by content, not name.
Zip entry names are never used as paths; non-photo entries are skipped and counted.

## Jobs

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/jobs` | curator | Newest 200; `status` = `all`, `active`, `done`, `failed` |
| GET | `/jobs/{id}` | curator | One job including its log |
| POST | `/jobs/{id}/cancel` | curator | Queued: cancelled at once. Running: stopped at the next check (the child process is terminated). |
| POST | `/jobs/{id}/retry` | curator | Failed or cancelled jobs go back to the queue |
| GET | `/pipeline` | anyone | Pipeline mode (`colmap`, `demo`, `detecting`), the reason, the stage list and upload limits |

Job statuses: `queued → running → done | failed | cancelled`. Stages: `upload, features,
matching, sparse, dense, mesh, optimize, publish`. `stage_times` holds seconds per finished stage.

## Annotations

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/objects/{id}/annotations` | anyone | Notes in creation order |
| POST | `/objects/{id}/annotations` | curator | `{position: [x,y,z], normal: [x,y,z], title (≤ 80), text (≤ 2000), category, severity}`; at most 200 per object |
| PATCH | `/annotations/{id}` | curator | Any of the fields above (`severity: null` clears it) |
| DELETE | `/annotations/{id}` | curator | 204 |

Positions are in model space (metres when the model is true to scale). `category` is one of
`note` (default), `detail`, `inscription`, `damage`, `repair`. `severity` (`negligible, slight,
moderate, marked, extreme`, the scale of museum condition reports) is kept for damage only.

## Shared views

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/objects/{id}/views` | anyone who can see the object, 30/min per IP | `{position, target, environment?, exposure?, light_intensity?, light_direction?, background?}` → `{id, …}` |
| GET | `/views/{id}` | anyone who can see the object | The stored state |

The web app turns a view into `/objects/{id}?view={viewId}` and an embed URL `/embed/{id}?view={viewId}`.

## Dashboard

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/stats` | curator | Object counts by status, notes by category, shared views, visits, storage per folder, job counts, median reconstruction time, average seconds per stage, finished jobs per day for 30 days, the five most visited objects and the five newest jobs |

## Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{status: "ok", version}` |
