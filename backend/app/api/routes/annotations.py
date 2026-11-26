from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import Curator, Db, OptionalUser
from app.api.routes.objects import get_visible
from app.api.serialize import annotation_out
from app.database.base import utcnow
from app.models import Annotation
from app.schemas.object import AnnotationIn, AnnotationOut, AnnotationPatch

router = APIRouter(tags=["Annotations"])

MAX_PER_OBJECT = 200


@router.get("/objects/{object_id}/annotations", response_model=list[AnnotationOut])
def list_annotations(object_id: int, db: Db, user: OptionalUser) -> list[AnnotationOut]:
    get_visible(db, object_id, user)
    rows = db.scalars(select(Annotation).where(Annotation.object_id == object_id).order_by(Annotation.id))
    return [annotation_out(db, a) for a in rows]


@router.post("/objects/{object_id}/annotations", response_model=AnnotationOut, status_code=201)
def create_annotation(object_id: int, body: AnnotationIn, db: Db, user: Curator) -> AnnotationOut:
    get_visible(db, object_id, user)
    count = len(db.scalars(select(Annotation.id).where(Annotation.object_id == object_id)).all())
    if count >= MAX_PER_OBJECT:
        raise HTTPException(status_code=409, detail=f"An object can have at most {MAX_PER_OBJECT} annotations.")
    annotation = Annotation(object_id=object_id, author_id=user.id, **body.model_dump())
    db.add(annotation)
    db.commit()
    return annotation_out(db, annotation)


@router.patch("/annotations/{annotation_id}", response_model=AnnotationOut)
def update_annotation(annotation_id: int, body: AnnotationPatch, db: Db, _: Curator) -> AnnotationOut:
    annotation = db.get(Annotation, annotation_id)
    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found.")
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None or field == "severity":  # null clears the severity, nothing else
            setattr(annotation, field, value)
    if annotation.category != "damage":
        annotation.severity = None
    annotation.updated_at = utcnow()
    db.commit()
    return annotation_out(db, annotation)


@router.delete("/annotations/{annotation_id}", status_code=204)
def delete_annotation(annotation_id: int, db: Db, _: Curator) -> None:
    annotation = db.get(Annotation, annotation_id)
    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found.")
    db.delete(annotation)
    db.commit()
