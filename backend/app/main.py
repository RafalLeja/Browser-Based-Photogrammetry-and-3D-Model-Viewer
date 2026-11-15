
import logging

from fastapi import FastAPI

from app.api.routes.health import router as health_router
from app.core.logging_config import setup_logging

from app.api.routes.objects import router as objects_router

from pathlib import Path
from fastapi.staticfiles import StaticFiles

setup_logging()

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Browser-Based Photogrammetry & 3D Viewer",
    description="Backend API for managing 3D objects and photogrammetry.",
    version="1.0.0",
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
IMAGES_DIRECTORY = PROJECT_ROOT / "images"

app.mount(
    "/files/images",
    StaticFiles(directory=IMAGES_DIRECTORY),
    name="images"
)

app.include_router(health_router)
app.include_router(objects_router)


@app.on_event("startup")
async def startup_event():
    logger.info("Application started")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Application shutting down")
