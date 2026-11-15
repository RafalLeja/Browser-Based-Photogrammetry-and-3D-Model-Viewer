from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models import Object
from app.schemas.object import ObjectResponse


router = APIRouter(
    prefix="/objects",
    tags=["Objects"]
)


@router.get("", response_model=list[ObjectResponse])
def get_objects(db: Session = Depends(get_db)):
    statement = select(Object).order_by(Object.id)
    objects = db.scalars(statement).all()

    return objects


@router.get("/{object_id}", response_model=ObjectResponse)
def get_object(object_id: int, db: Session = Depends(get_db)):
    obj = db.get(Object, object_id)

    if obj is None:
        raise HTTPException(
            status_code=404,
            detail="Object not found"
        )

    return obj