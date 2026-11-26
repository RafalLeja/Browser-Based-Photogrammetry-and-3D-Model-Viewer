# API and reconstruction worker. Build from the repository root:
#   docker build -f backend/Dockerfile -t vitrine-api .
# The image has no CUDA, so it runs the labelled demo pipeline; reconstruction needs a CUDA
# base image and the CUDA build of pycolmap (see docs/deployment.md).
FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

WORKDIR /srv
COPY photogrammetry-lib ./photogrammetry-lib
COPY backend/pyproject.toml backend/uv.lock ./backend/
RUN cd backend && uv sync --frozen --no-dev
COPY backend ./backend
COPY samples ./samples

RUN useradd --system --create-home vitrine && mkdir -p /data && chown vitrine /data
USER vitrine
ENV STORAGE_DIR=/data SAMPLES_DIR=/srv/samples
WORKDIR /srv/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health')"
# Only nginx can reach this container, and it replaces X-Forwarded-For with the real client
# address, so the header is trusted: rate limits then count each visitor, not the proxy.
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
