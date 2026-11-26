from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from app.api.deps import Curator, Db, SettingsDep
from app.api.serialize import job_out, object_out
from app.models import CollectionObject, Job
from app.schemas.object import clean_text
from app.services.photos import Limits, PhotoError, PhotoWriter

router = APIRouter(prefix="/uploads", tags=["Uploads"])


@router.post("", status_code=201)
def upload_photos(
    request: Request,
    db: Db,
    settings: SettingsDep,
    user: Curator,
    title: Annotated[str, Form(min_length=1, max_length=120)],
    files: Annotated[list[UploadFile], File(description="JPEG or PNG photos, or zip files of them")],
    description: Annotated[str, Form(max_length=4000)] = "",
    tags: Annotated[str, Form(max_length=400)] = "",
    real_height_mm: Annotated[float | None, Form(gt=0, le=100_000)] = None,
) -> dict:
    """Stores the photos, creates the object and queues its reconstruction job.

    A plain `def`: FastAPI runs it in a thread, so copying large files does not block other requests.
    """
    if not request.app.state.upload_limiter.allow(str(user.id)):
        raise HTTPException(status_code=429, detail="Upload limit reached. Try again in an hour.")
    title = clean_text(title)
    if not title:
        raise HTTPException(status_code=422, detail="Give the object a title.")

    upload_id = uuid4().hex
    writer = PhotoWriter(
        settings.storage_dir / "uploads" / upload_id,
        Limits(settings.min_photos, settings.max_photos, settings.max_photo_bytes, settings.max_upload_bytes),
    )
    try:
        for upload in files:
            name = clean_text(upload.filename or "photo")[:120]
            if name.lower().endswith(".zip"):
                writer.add_zip(upload.file, name)
            else:
                writer.add_stream(upload.file, name)
            upload.file.close()
        count = writer.finish()
    except PhotoError as error:
        writer.discard()
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error

    tag_list = [clean_text(t).lower()[:32] for t in tags.split(",") if clean_text(t)][:12]
    obj = CollectionObject(
        title=title,
        description=clean_text(description),
        tags=list(dict.fromkeys(tag_list)),
        status="processing",
        created_by=user.id,
    )
    db.add(obj)
    db.flush()
    job = Job(
        object_id=obj.id,
        status="queued",
        input_path=str(writer.dest),
        photo_count=count,
        options={"real_height_mm": real_height_mm} if real_height_mm else {},
    )
    db.add(job)
    db.commit()
    if request.app.state.worker:
        request.app.state.worker.notify()
    return {
        "object": object_out(db, obj).model_dump(),
        "job": job_out(db, job).model_dump(),
        "skipped_files": writer.skipped,
    }
