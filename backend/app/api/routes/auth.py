from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import delete, select

from app.api.deps import SESSION_COOKIE, Curator, Db, SettingsDep, client_ip
from app.core.security import burn_password_check, new_token, token_hash, verify_password
from app.database.base import utcnow
from app.models import AuthSession, User
from app.schemas.object import LoginIn, UserOut

router = APIRouter(prefix="/auth", tags=["Auth"])


def user_out(user: User) -> UserOut:
    return UserOut(id=user.id, login=user.login, display_name=user.display_name or user.login, role=user.role)


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: Db, settings: SettingsDep) -> UserOut:
    if not request.app.state.login_limiter.allow(client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many login attempts. Wait a minute and try again.")

    user = db.scalar(select(User).where(User.login == body.login))
    if user is None or user.password is None:
        burn_password_check(body.password)
        raise HTTPException(status_code=401, detail="Wrong login or password.")
    if not verify_password(body.password, user.password.password_hash):
        raise HTTPException(status_code=401, detail="Wrong login or password.")

    token = new_token()
    max_age = timedelta(days=settings.session_days)
    db.execute(delete(AuthSession).where(AuthSession.expires_at < utcnow()))
    db.add(AuthSession(token_hash=token_hash(token), user_id=user.id, expires_at=utcnow() + max_age))
    db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(max_age.total_seconds()),
        httponly=True,  # JavaScript cannot read it, so an injected script cannot steal it.
        secure=settings.cookie_secure,
        samesite="lax",  # Other sites cannot send it with their POST, PATCH or DELETE requests.
        path="/",
    )
    return user_out(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Db) -> None:
    if token := request.cookies.get(SESSION_COOKIE):
        db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(token)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
def me(user: Curator) -> UserOut:
    return user_out(user)
