
import logging

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from app.api.routes.health import router as health_router
from app.core.logging_config import setup_logging

from app.api.routes.objects import router as objects_router
from app.api.routes.uploads import router as uploads_router
from app.api.routes.jobs import router as jobs_router

from pathlib import Path
from fastapi.staticfiles import StaticFiles

setup_logging()

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Browser-Based Photogrammetry & 3D Viewer",
    description="Backend API for managing 3D objects and photogrammetry.",
    version="1.0.0",
)

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        routes=app.routes,
    )

    schemas = openapi_schema.get("components", {}).get("schemas", {})

    for schema in schemas.values():
        properties = schema.get("properties", {})

        for prop in properties.values():
            items = prop.get("items", {})

            if items.get("contentMediaType") == "application/octet-stream":
                items.pop("contentMediaType")
                items["format"] = "binary"

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi

PROJECT_ROOT = Path(__file__).resolve().parents[2]
IMAGES_DIRECTORY = PROJECT_ROOT / "images"

app.mount(
    "/files/images",
    StaticFiles(directory=IMAGES_DIRECTORY),
    name="images"
)

app.include_router(health_router)
app.include_router(objects_router)
app.include_router(uploads_router)
app.include_router(jobs_router)


@app.on_event("startup")
async def startup_event():
    logger.info("Application started")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Application shutting down")
