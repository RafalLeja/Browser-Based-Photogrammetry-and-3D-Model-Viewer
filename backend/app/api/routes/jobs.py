from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from app.api.deps import Curator, Db
from app.api.serialize import job_out
from app.models import CollectionObject, Job
from app.models.job import ACTIVE_STATUSES
from app.schemas.object import JobOut

router = APIRouter(prefix="/jobs", tags=["Jobs"])


def get_job_or_404(db: Db, job_id: int) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@router.get("", response_model=list[JobOut])
def list_jobs(db: Db, _: Curator, status: Literal["all", "active", "done", "failed"] = "all") -> list[JobOut]:
    statement = select(Job).order_by(Job.id.desc()).limit(200)
    if status == "active":
        statement = statement.where(Job.status.in_(ACTIVE_STATUSES))
    elif status == "failed":
        statement = statement.where(Job.status.in_(("failed", "cancelled")))
    elif status == "done":
        statement = statement.where(Job.status == "done")
    return [job_out(db, job) for job in db.scalars(statement)]


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Db, _: Curator) -> JobOut:
    return job_out(db, get_job_or_404(db, job_id), with_log=True)


@router.post("/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: int, db: Db, _: Curator) -> JobOut:
    job = get_job_or_404(db, job_id)
    if job.status not in ACTIVE_STATUSES:
        raise HTTPException(status_code=409, detail=f"A {job.status} job cannot be cancelled.")
    if job.status == "queued":
        job.status = "cancelled"
        obj = db.get(CollectionObject, job.object_id)
        if obj is not None and obj.model_path is None:
            obj.status = "failed"
    job.cancel_requested = True  # A running job stops at its next check.
    db.commit()
    return job_out(db, job, with_log=True)


@router.post("/{job_id}/retry", response_model=JobOut)
def retry_job(job_id: int, request: Request, db: Db, _: Curator) -> JobOut:
    job = get_job_or_404(db, job_id)
    if job.status not in ("failed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"A {job.status} job cannot be retried.")
    job.status = "queued"
    job.cancel_requested = False
    job.error = None
    job.log += "--- retry ---\n"
    obj = db.get(CollectionObject, job.object_id)
    if obj is not None and obj.status == "failed":
        obj.status = "processing"
    db.commit()
    if request.app.state.worker:
        request.app.state.worker.notify()
    return job_out(db, job, with_log=True)
