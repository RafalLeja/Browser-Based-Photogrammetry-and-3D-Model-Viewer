import secrets

from fastapi import APIRouter, HTTPException, Request

from app.api.deps import Db, OptionalUser, client_ip
from app.api.routes.objects import get_visible
from app.models import SavedView
from app.schemas.object import ViewOut, ViewState, iso

router = APIRouter(tags=["Shared views"])


@router.post("/objects/{object_id}/views", response_model=ViewOut, status_code=201)
def create_view(object_id: int, state: ViewState, request: Request, db: Db, user: OptionalUser) -> ViewOut:
    """Anyone who can see the object may share a view of it, so this is rate limited instead of protected."""
    get_visible(db, object_id, user)
    if not request.app.state.view_limiter.allow(client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many shared views. Try again in a minute.")
    view = SavedView(id=secrets.token_urlsafe(6), object_id=object_id, state=state.model_dump(exclude_none=True))
    db.add(view)
    db.commit()
    return ViewOut(id=view.id, object_id=object_id, state=state, created_at=iso(view.created_at))


@router.get("/views/{view_id}", response_model=ViewOut)
def get_view(view_id: str, db: Db, user: OptionalUser) -> ViewOut:
    view = db.get(SavedView, view_id[:16])
    if view is None:
        raise HTTPException(status_code=404, detail="This shared view does not exist.")
    get_visible(db, view.object_id, user)
    return ViewOut(id=view.id, object_id=view.object_id, state=ViewState(**view.state), created_at=iso(view.created_at))
