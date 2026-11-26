import logging
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.annotations import router as annotations_router
from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.jobs import router as jobs_router
from app.api.routes.objects import router as objects_router
from app.api.routes.uploads import router as uploads_router
from app.api.routes.views import router as views_router
from app.core.config import Settings
from app.core.logging_config import setup_logging
from app.core.security import RateLimiter
from app.database.base import Base
from app.database.session import make_engine, make_sessionmaker
from app.seed import seed
from app.worker.runner import Worker, recover_interrupted

logger = logging.getLogger(__name__)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    for folder in ("uploads", "models", "thumbnails"):
        (settings.storage_dir / folder).mkdir(parents=True, exist_ok=True)

    engine = make_engine(settings.database_url)
    sessions = make_sessionmaker(engine)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # shortcut: create_all instead of migrations; add Alembic before the schema changes in production.
        Base.metadata.create_all(engine)
        with sessions() as db:
            seed(db, settings)
        if interrupted := recover_interrupted(sessions):
            logger.warning("Marked %d interrupted job(s) as failed", interrupted)
        if app.state.worker:
            app.state.worker.start()
        logger.info("Vitrine API started")
        yield
        if app.state.worker:
            app.state.worker.stop()
        engine.dispose()

    app = FastAPI(
        title="Vitrine API",
        description="Collection, photo uploads, reconstruction jobs, annotations and shared views.",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = sessions
    app.state.worker = Worker(sessions, settings) if settings.embedded_worker else None
    app.state.login_limiter = RateLimiter(settings.login_attempts_per_minute, 60)
    app.state.upload_limiter = RateLimiter(settings.uploads_per_hour, 3600)
    app.state.view_limiter = RateLimiter(30, 60)

    allowed_origins = set(settings.cors_origins)

    @app.middleware("http")
    async def guard(request: Request, call_next):  # noqa: ANN001, ANN202 - Starlette middleware signature
        # Second line of defence after SameSite cookies: a write must come from our own pages.
        origin = request.headers.get("origin")
        if request.method in UNSAFE_METHODS and origin:
            own = f"{request.url.scheme}://{request.url.netloc}"
            host = request.headers.get("host", "")
            if origin not in allowed_origins and origin != own and urlsplit(origin).netloc != host:
                return JSONResponse({"detail": "Cross-site request refused."}, status_code=403)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        if request.url.path.startswith("/api/v1/auth") or request.url.path.startswith("/api/v1/jobs"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )

    for router in (
        health_router,
        auth_router,
        objects_router,
        uploads_router,
        jobs_router,
        annotations_router,
        views_router,
    ):
        app.include_router(router, prefix="/api/v1")
    return app


setup_logging()
app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000)
