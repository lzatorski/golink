from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class LinkCreate(BaseModel):
    slug: str
    url: str
    description: Optional[str] = ""


class LinkUpdate(BaseModel):
    url: Optional[str] = None
    description: Optional[str] = None


class LinkResponse(BaseModel):
    slug: str
    url: str
    description: str
    hit_count: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class Credentials(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
