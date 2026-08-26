from pydantic import BaseModel, Field
import json
from pathlib import Path


class DocumentQueryRequest(BaseModel):
    token: str = Field(min_length=1)
    query: str = Field(min_length=1)
    requested_scopes: list[str] = Field(default_factory=list)
    

class DocumentAddRequest(BaseModel):
    token: str = Field(min_length=1)
    documents: list[str] = Field(default_factory=list)


class IngestRequest(BaseModel):
    token: str = Field(min_length=1)
    folder_path: str = Field(min_length=1)


class RepositoryIngestRequest(BaseModel):
    token: str = Field(min_length=1)
    repository_path: str | None = None
    scope: str = Field(default="public", min_length=1)


class CollectionFetchRequest(BaseModel):
    token: str = Field(min_length=1)
