from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Annotation, CollectionObject, Job, User
from app.schemas.object import AnnotationOut, JobOut, ObjectOut, iso

API = "/api/v1"


def object_out(db: Session, obj: CollectionObject) -> ObjectOut:
    job_id = db.scalar(select(func.max(Job.id)).where(Job.object_id == obj.id))
    annotations = db.scalar(select(func.count(Annotation.id)).where(Annotation.object_id == obj.id)) or 0
    version = int(obj.updated_at.timestamp())  # Changes when the file changes, so caches refresh.
    return ObjectOut(
        id=obj.id,
        title=obj.title,
        description=obj.description,
        tags=list(obj.tags or []),
        status=obj.status,
        model_url=f"{API}/objects/{obj.id}/model?v={version}" if obj.model_path else None,
        model_format=obj.model_format,
        up=obj.up,
        dimensions_mm=obj.dimensions_mm,
        triangles=obj.triangles,
        file_size=obj.file_size,
        thumbnail_url=f"{API}/objects/{obj.id}/thumbnail?v={version}" if obj.thumbnail_path else None,
        is_demo=obj.is_demo,
        job_id=job_id,
        annotation_count=annotations,
        created_at=iso(obj.created_at),
        updated_at=iso(obj.updated_at),
    )


def annotation_out(db: Session, annotation: Annotation) -> AnnotationOut:
    author = db.get(User, annotation.author_id) if annotation.author_id else None
    return AnnotationOut(
        id=annotation.id,
        object_id=annotation.object_id,
        position=annotation.position,
        normal=annotation.normal,
        title=annotation.title,
        text=annotation.text,
        author=(author.display_name or author.login) if author else None,
        created_at=iso(annotation.created_at),
        updated_at=iso(annotation.updated_at),
    )


def job_out(db: Session, job: Job, *, with_log: bool = False) -> JobOut:
    obj = db.get(CollectionObject, job.object_id)
    return JobOut(
        id=job.id,
        object_id=job.object_id,
        object_title=obj.title if obj else "Deleted object",
        status=job.status,
        stage=job.current_stage,
        progress=job.progress,
        pipeline=job.pipeline,
        photo_count=job.photo_count,
        stage_times=job.stage_times or {},
        error=job.error,
        attempts=job.attempts,
        created_at=iso(job.created_at),
        started_at=iso(job.started_at),
        finished_at=iso(job.finished_at),
        log=job.log if with_log else None,
    )
