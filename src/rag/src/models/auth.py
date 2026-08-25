from pydantic import BaseModel, Field
import json
from pathlib import Path

class DeleteUserRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    
class SignUpRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    # scopes: list[str] = Field(default_factory=list)

class CreateTokenRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)
    scopes: list[str] = Field(default_factory=list)
    label: str = Field(min_length=1)

