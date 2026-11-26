# Deployment

## Docker Compose (demo or small installation)

```bash
CURATOR_PASSWORD='choose-a-strong-one' docker compose up --build
```

| Service | Image | Purpose |
|---|---|---|
| `db` | `postgres:17-alpine` | Database, volume `db-data` |
| `api` | `backend/Dockerfile` | FastAPI and the reconstruction worker, storage volume `storage` |
| `web` | `viewer/Dockerfile` | nginx: the built web app, `/api` proxy, gzip, CSP; port 8080 |

Environment variables are listed in [`backend/.env.example`](../backend/.env.example).

## Reconstruction on a GPU

The default API image is CPU-only, so `PIPELINE=auto` falls back to the demo pipeline.
To reconstruct real photos:

1. Base the API image on an NVIDIA CUDA runtime image and install a CUDA build of pycolmap.
2. Run the container with GPU access (`docker run --gpus all …`, or `deploy.resources.reservations.devices` in Compose) and the NVIDIA Container Toolkit on the host.
3. Install Node.js in the image (or a sidecar) so the worker can run `viewer/scripts/optimize-glb.mjs`; without it, models are published uncompressed and the job log says so.
4. Set `PIPELINE=colmap`, so a missing GPU fails jobs loudly instead of falling back.

On a workstation without containers, the simplest path is to run the API directly
(`uv run uvicorn app.main:app`) on the machine with the GPU.

## HTTPS and production settings

- Put the stack behind TLS (a reverse proxy such as Caddy or Traefik, or nginx with certificates)
  and set `COOKIE_SECURE=true`.
- Set `CORS_ORIGINS` to the public origin.
- Rate limits count requests per visitor address. nginx passes the address on in
  `X-Forwarded-For` (replacing any value the client sent) and the API trusts it, because only
  nginx can reach the API container. If another proxy terminates TLS in front of nginx, enable
  nginx's `real_ip` module for that proxy, or every visitor shares one limit.
- Choose a strong `CURATOR_PASSWORD` and `DB_PASSWORD`; never commit them.
- Add Alembic migrations before changing the schema on a database with real data.

## Backups

- Database: `docker compose exec db pg_dump -U vitrine vitrine > vitrine.sql`.
- Files: back up the `storage` volume (uploads, models, thumbnails). Uploaded photos can be
  deleted after a successful reconstruction if storage is tight; the models are what visitors see.
- Deleting an object removes its photos, model, cover and COLMAP workspace. A successful run
  deletes its COLMAP workspace (`~/.bbpa3mv/storage/<hash>`, often several GB); a failed run
  keeps it, so Retry resumes where it stopped.
