from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, utcnow

if TYPE_CHECKING:
    from app.models.password import Password


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    login: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    # Visitors never log in; every account is a curator who may upload, edit and annotate.
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="curator")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    password: Mapped["Password"] = relationship(back_populates="user", cascade="all, delete-orphan")
