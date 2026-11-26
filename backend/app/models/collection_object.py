from datetime import datetime

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, utcnow


class CollectionObject(Base):
    """One item of the collection and its published 3D model."""

    __tablename__ = "objects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    # processing -> ready | failed
    status: Mapped[str] = mapped_column(String(20), default="processing", index=True)
    # Relative to the storage dir, or "samples:<path>" for a bundled showcase file.
    model_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model_format: Mapped[str] = mapped_column(String(10), default="gltf")
    # The model's own up direction when it is not +Y up (raw COLMAP output).
    up: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    dimensions_mm: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    triangles: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # True when the model is the sample scan published by the demo pipeline, not the uploaded photos.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
