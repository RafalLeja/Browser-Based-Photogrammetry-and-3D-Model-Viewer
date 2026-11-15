from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ObjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    created_by: int
    is_published: bool
    created_at: datetime
    updated_at: datetime