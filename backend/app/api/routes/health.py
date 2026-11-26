from fastapi import APIRouter, Request

from app.api.deps import SettingsDep
from app.schemas.object import PipelineInfo, StageOut
from app.worker.stages import STAGES

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check(request: Request) -> dict:
    return {"status": "ok", "version": request.app.version}


@router.get("/pipeline", response_model=PipelineInfo)
def pipeline_info(request: Request, settings: SettingsDep) -> PipelineInfo:
    worker = request.app.state.worker
    return PipelineInfo(
        mode=(worker.mode if worker else None) or "detecting",
        reason=worker.reason if worker else "the worker runs in a separate process",
        stages=[StageOut(key=k, label=label, description=d) for k, label, d in STAGES],
        limits={
            "min_photos": settings.min_photos,
            "max_photos": settings.max_photos,
            "max_photo_mb": settings.max_photo_bytes // (1024 * 1024),
            "max_upload_mb": settings.max_upload_bytes // (1024 * 1024),
        },
    )
