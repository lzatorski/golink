from sqlalchemy import Column, String, Integer, DateTime
from sqlalchemy.sql import func
from .database import Base


class Link(Base):
    __tablename__ = "links"

    slug = Column(String, primary_key=True, index=True)
    url = Column(String, nullable=False)
    description = Column(String, default="")
    hit_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
