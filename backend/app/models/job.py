from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True
    )

    status: Mapped[str] = mapped_column(
        String(30),
        default="pending",
        nullable=False
    )

    current_stage: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True
    )

    input_path: Mapped[str] = mapped_column(
        String(500),
        nullable=False
    )