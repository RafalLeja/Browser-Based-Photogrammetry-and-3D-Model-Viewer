
from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.password import Password


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    login: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False
    )

    password: Mapped["Password"] = relationship(
        back_populates="user",
        cascade="all, delete-orphan"
    )
