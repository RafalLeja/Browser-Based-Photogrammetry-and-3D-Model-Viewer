from pydantic import BaseModel


class ObjectResponse(BaseModel):
    id: str
    title: str