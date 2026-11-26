import shutil
from collections import Counter
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import Curator, Db, OptionalUser, SettingsDep
from app.api.serialize import object_out
from app.database.base import utcnow
from app.models import CollectionObject, Job
from app.schemas.object import ObjectOut, ObjectPage, ObjectPatch, TagCount
from app.services.files import is_sample, owned_folder, resolve
from app.services.photos import sniff

router = APIRouter(prefix="/objects", tags=["Objects"])

MAX_THUMBNAIL_BYTES = 3 * 1024 * 1024
WEBP = (b"RIFF", b"WEBP")


def get_visible(db: Db, object_id: int, user: OptionalUser) -> CollectionObject:
    obj = db.get(CollectionObject, object_id)
    # Visitors only see published objects; a draft is reported as missing, not as forbidden.
    if obj is None or (user is None and obj.status != "ready"):
        raise HTTPException(status_code=404, detail="Object not found.")
    return obj


def cached_file(request: Request, path: Path, media_type: str | None = None) -> Response:
    """Serves a file with an ETag; a browser that already has this version gets 304 and no body.

    "no-cache" means "check first", so a replaced model or cover is never shown stale.
    """
    stat = path.stat()
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
    headers = {"ETag": etag, "Cache-Control": "public, no-cache"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return FileResponse(path, media_type=media_type, headers=headers)


def matches(obj: CollectionObject, query: str) -> bool:
    haystack = " ".join([obj.title, obj.description, *(obj.tags or [])]).lower()
    return all(word in haystack for word in query.lower().split())


@router.get("", response_model=ObjectPage)
def list_objects(
    db: Db,
    user: OptionalUser,
    q: str = Query("", max_length=100),
    tag: str = Query("", max_length=32),
    sort: Literal["newest", "oldest", "title"] = "newest",
    status: Literal["ready", "processing", "failed", "all"] = "ready",
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=60),
) -> ObjectPage:
    statement = select(CollectionObject)
    if user is None or status != "all":
        statement = statement.where(CollectionObject.status == ("ready" if user is None else status))
    order = {
        "newest": CollectionObject.created_at.desc(),
        "oldest": CollectionObject.created_at.asc(),
        "title": CollectionObject.title.asc(),
    }[sort]
    # shortcut: text and tag filters run in Python over the whole collection; fine for thousands of
    # objects, move to SQL full-text search when the collection outgrows that.
    objects = [
        obj
        for obj in db.scalars(statement.order_by(order, CollectionObject.id.desc()))
        if (not q or matches(obj, q)) and (not tag or tag.lower() in (obj.tags or []))
    ]
    start = (page - 1) * page_size
    return ObjectPage(
        items=[object_out(db, obj) for obj in objects[start : start + page_size]],
        total=len(objects),
        page=page,
        page_size=page_size,
    )


@router.get("/tags", response_model=list[TagCount])
def list_tags(db: Db) -> list[TagCount]:
    counts = Counter(
        tag for obj in db.scalars(select(CollectionObject).where(CollectionObject.status == "ready")) for tag in obj.tags
    )
    return [TagCount(tag=tag, count=count) for tag, count in counts.most_common()]


@router.get("/{object_id}", response_model=ObjectOut)
def get_object(object_id: int, db: Db, user: OptionalUser) -> ObjectOut:
    return object_out(db, get_visible(db, object_id, user))


@router.patch("/{object_id}", response_model=ObjectOut)
def update_object(object_id: int, body: ObjectPatch, db: Db, _: Curator) -> ObjectOut:
    obj = db.get(CollectionObject, object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found.")
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is None and field in ("title", "description", "tags"):
            continue  # These are never empty: null means "leave as is".
        setattr(obj, field, value)
    obj.updated_at = utcnow()
    db.commit()
    return object_out(db, obj)


@router.delete("/{object_id}", status_code=204)
def delete_object(object_id: int, request: Request, db: Db, settings: SettingsDep, _: Curator) -> None:
    obj = db.get(CollectionObject, object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found.")
    # The jobs are deleted with the object (ON DELETE CASCADE), so their folders are collected first.
    # A running job notices that its row is gone at its next check and stops.
    folders = [settings.storage_dir / "models" / str(object_id)]
    for job in db.scalars(select(Job).where(Job.object_id == object_id)):
        folders.append(Path(job.input_path))
        if workspace := (job.options or {}).get("workspace"):
            folders.append(Path(workspace))
    db.delete(obj)
    db.commit()
    # Files go after the commit, so a failed delete never leaves an object without its files.
    for folder in folders:
        if owned_folder(settings, folder):
            shutil.rmtree(folder, ignore_errors=True)
    if obj.thumbnail_path and not is_sample(obj.thumbnail_path):
        resolve(settings, obj.thumbnail_path).unlink(missing_ok=True)


@router.get("/{object_id}/model")
def get_model(object_id: int, request: Request, db: Db, user: OptionalUser, settings: SettingsDep) -> Response:
    obj = get_visible(db, object_id, user)
    if not obj.model_path:
        raise HTTPException(status_code=404, detail="This object has no model yet.")
    path = resolve(settings, obj.model_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="The model file is missing.")
    media = "model/gltf-binary" if path.suffix == ".glb" else "application/octet-stream"
    return cached_file(request, path, media)


@router.get("/{object_id}/thumbnail")
def get_thumbnail(object_id: int, request: Request, db: Db, user: OptionalUser, settings: SettingsDep) -> Response:
    obj = get_visible(db, object_id, user)
    if not obj.thumbnail_path:
        raise HTTPException(status_code=404, detail="This object has no thumbnail yet.")
    path = resolve(settings, obj.thumbnail_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="The thumbnail file is missing.")
    return cached_file(request, path)


@router.put("/{object_id}/thumbnail", response_model=ObjectOut)
async def put_thumbnail(object_id: int, request: Request, db: Db, settings: SettingsDep, _: Curator) -> ObjectOut:
    obj = db.get(CollectionObject, object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found.")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_THUMBNAIL_BYTES:
            raise HTTPException(status_code=413, detail="The thumbnail is larger than 3 MB.")
    extension = sniff(bytes(body[:16])) or (".webp" if body[:4] == WEBP[0] and body[8:12] == WEBP[1] else None)
    if extension is None:
        raise HTTPException(status_code=422, detail="The thumbnail must be a PNG, JPEG or WebP image.")
    relative = f"thumbnails/{object_id}{extension}"
    target = settings.storage_dir / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    if obj.thumbnail_path and obj.thumbnail_path != relative and not is_sample(obj.thumbnail_path):
        resolve(settings, obj.thumbnail_path).unlink(missing_ok=True)  # A cover in another format replaced it.
    obj.thumbnail_path = relative
    obj.updated_at = utcnow()
    db.commit()
    return object_out(db, obj)
