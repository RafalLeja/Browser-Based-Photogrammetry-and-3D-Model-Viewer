from datetime import UTC
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import token_hash
from app.database.base import utcnow
from app.database.session import get_db
from app.models import AuthSession, User

SESSION_COOKIE = "vitrine_session"

Db = Annotated[Session, Depends(get_db)]


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


SettingsDep = Annotated[Settings, Depends(get_settings)]


def current_user(request: Request, db: Db) -> User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = db.get(AuthSession, token_hash(token))
    if session is None:
        return None
    expires = session.expires_at if session.expires_at.tzinfo else session.expires_at.replace(tzinfo=UTC)
    if expires < utcnow():
        db.delete(session)
        db.commit()
        return None
    return db.get(User, session.user_id)


OptionalUser = Annotated[User | None, Depends(current_user)]


def require_curator(user: OptionalUser) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Log in as a curator to do this.")
    if user.role != "curator":
        raise HTTPException(status_code=403, detail="Only curators can do this.")
    return user


Curator = Annotated[User, Depends(require_curator)]


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
