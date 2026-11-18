
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import Job

router = APIRouter(
    prefix="/jobs",
    tags=["Jobs"]
)


@router.get("/{job_id}")
def get_job(
    job_id: int,
    db: Session = Depends(get_db)
):
    job = db.get(Job, job_id)

    if job is None:
        raise HTTPException(
            status_code=404,
            detail="Job not found"
        )

    return {
        "id": job.id,
        "status": job.status,
        "current_stage": job.current_stage
    }
