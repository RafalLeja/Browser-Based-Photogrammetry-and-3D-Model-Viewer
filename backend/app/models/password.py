
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.user import User



class Password(Base):
    __tablename__ = "passwords"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True
    )

    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False
    )

    user: Mapped["User"] = relationship(
        back_populates="password"
    )
