from collections import Counter
from datetime import UTC, timedelta
from pathlib import Path
from statistics import fmean, median

from fastapi import APIRouter
from sqlalchemy import func, select

from app.api.deps import Curator, Db, SettingsDep
from app.api.serialize import API, job_out
from app.database.base import utcnow
from app.models import Annotation, CollectionObject, Job, SavedView
from app.models.job import ACTIVE_STATUSES
from app.schemas.object import DayCount, Stats, TopObject

router = APIRouter(tags=["Dashboard"])

DAYS = 30


def folder_bytes(folder: Path) -> int:
    return sum(path.stat().st_size for path in folder.rglob("*") if path.is_file()) if folder.is_dir() else 0


def aware(value):  # noqa: ANN001, ANN201 - SQLite returns naive datetimes; they were stored as UTC.
    return value if value is None or value.tzinfo else value.replace(tzinfo=UTC)


@router.get("/stats", response_model=Stats)
def get_stats(db: Db, settings: SettingsDep, _: Curator) -> Stats:
    """Totals for the dashboard. Computed on request: at collection scale this is a few small queries.

    shortcut: the storage total walks the storage folder on every call; cache it once that holds
    hundreds of thousands of files.
    """
    objects = db.scalars(select(CollectionObject)).all()
    by_status = Counter(obj.status for obj in objects)
    jobs = db.scalars(select(Job)).all()
    job_status = Counter(job.status for job in jobs)

    finished = [job for job in jobs if job.status == "done" and job.started_at and job.finished_at]
    durations = [(aware(job.finished_at) - aware(job.started_at)).total_seconds() for job in finished]
    stage_lists: dict[str, list[float]] = {}
    for job in finished:
        for stage, seconds in (job.stage_times or {}).items():
            stage_lists.setdefault(stage, []).append(seconds)

    today = utcnow().date()
    days = {today - timedelta(days=offset): {"done": 0, "failed": 0} for offset in range(DAYS)}
    for job in jobs:
        ended = aware(job.finished_at)
        if ended and ended.date() in days and job.status in ("done", "failed"):
            days[ended.date()][job.status] += 1

    storage = {folder: folder_bytes(settings.storage_dir / folder) for folder in ("uploads", "models", "thumbnails")}
    top = sorted((obj for obj in objects if obj.visits and obj.status == "ready"), key=lambda o: -o.visits)[:5]
    categories = Counter(db.scalars(select(Annotation.category)).all())

    return Stats(
        objects={
            "total": len(objects),
            "ready": by_status["ready"],
            "processing": by_status["processing"],
            "failed": by_status["failed"],
            "demo": sum(1 for obj in objects if obj.is_demo),
        },
        notes=sum(categories.values()),
        notes_by_category=dict(categories),
        shared_views=db.scalar(select(func.count(SavedView.id))) or 0,
        visits=sum(obj.visits or 0 for obj in objects),
        storage_bytes={**storage, "total": sum(storage.values())},
        jobs={
            "total": len(jobs),
            "done": job_status["done"],
            "failed": job_status["failed"],
            "cancelled": job_status["cancelled"],
            "active": sum(job_status[status] for status in ACTIVE_STATUSES),
        },
        median_job_seconds=round(median(durations), 1) if durations else None,
        stage_seconds={stage: round(fmean(values), 2) for stage, values in stage_lists.items()},
        jobs_by_day=[DayCount(date=day.isoformat(), **counts) for day, counts in sorted(days.items())],
        top_objects=[
            TopObject(
                id=obj.id,
                title=obj.title,
                visits=obj.visits,
                thumbnail_url=f"{API}/objects/{obj.id}/thumbnail?v={int(obj.updated_at.timestamp())}" if obj.thumbnail_path else None,
            )
            for obj in top
        ],
        recent_jobs=[job_out(db, job) for job in sorted(jobs, key=lambda j: -j.id)[:5]],
    )
