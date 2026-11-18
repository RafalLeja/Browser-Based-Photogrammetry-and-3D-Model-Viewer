
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(
    prefix="/objects",
    tags=["Objects"]
)

# Katalog przechowujący gotowe modele 3D
BACKEND_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIRECTORY = BACKEND_ROOT / "storage" / "models"


@router.get("")
def get_objects():
    if not MODELS_DIRECTORY.exists():
        return []

    objects = []

    for model_file in MODELS_DIRECTORY.glob("*.glb"):
        objects.append({
            "id": model_file.stem,
            "title": model_file.stem
        })

    return objects


@router.get("/{object_id}")
def get_object(object_id: str):
    model_path = MODELS_DIRECTORY / f"{object_id}.glb"

    if not model_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Object not found"
        )

    return FileResponse(
        path=model_path,
        media_type="model/gltf-binary",
        filename=model_path.name
    )
