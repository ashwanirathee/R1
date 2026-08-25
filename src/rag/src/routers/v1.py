from fastapi import APIRouter, Depends
from src.services.chroma import get_chroma_service, ChromaService
from src.services.user import get_user_data_service, UserDataService
from src.services.ingest import get_ingestion_service, IngestionService
from src.token_utils import generate_strong_token, generate_unique_id
from src.models.auth import SignUpRequest, CreateTokenRequest, DeleteUserRequest
from src.models.access import (
    DocumentAddRequest,
    DocumentQueryRequest,
    IngestRequest,
    RepositoryIngestRequest,
    CollectionFetchRequest,
)
from src.constants import ALLOWED_SCOPES as allowed_scopes
from fastapi import HTTPException
from pathlib import Path
from typing import Any
import shutil
from datetime import datetime, timezone

USER_FOLDERS_ROOT = Path(__file__).resolve().parents[2] / "data" / "user_folders"
USER_FOLDERS_ROOT.mkdir(parents=True, exist_ok=True)

router = APIRouter()

@router.get("/health")
def get_health():
    return {"status": "ok"}


@router.post("/v1/signup")
def signup(
    body: SignUpRequest,
    chroma: ChromaService = Depends(get_chroma_service),
    user_data: UserDataService = Depends(get_user_data_service),
):
    users = user_data.load_users()

    if any(user["username"] == body.username for user in users):
        raise HTTPException(status_code=400, detail="username_already_exists")

    # token = generate_strong_token()
    collection_name = generate_unique_id()
    res = chroma.create_collection(name=collection_name)
    if res == -1:
        raise HTTPException(status_code=500, detail="failed_to_create_collection")

    user_id = generate_unique_id()
    user_folder = USER_FOLDERS_ROOT / user_id
    user_folder.mkdir(parents=True, exist_ok=True)

    # new folders underneath it
    # secret, private, private_safe, public
    for folder_name in ["secret", "private", "private_safe", "public"]:
        (user_folder / folder_name).mkdir(parents=True, exist_ok=True)

    data = {
        "username": body.username,
        "password": body.password,
        # "scopes": body.scopes,
        "tokens": [],
        "collection_name": collection_name,
        "user_id": user_id,
        "folder_path": str(user_folder),
    }

    users.append(data)
    user_data.save_users(users)

    return {
        "status": "success",
    }

@router.post("/v1/create_token")
def create_token(body: CreateTokenRequest, user_data: UserDataService = Depends(get_user_data_service)):
    user = user_data.validate_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="invalid_credentials")

    token = generate_strong_token()
    scopes = list(set(set(allowed_scopes) & set(body.scopes)))
    
    if not scopes:
        raise HTTPException(status_code=400, detail="invalid_scopes")

    access_info = {
        "token": token,
        "scopes": scopes,
        "is_active": "true",
        "label": body.label or "default",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    user.setdefault("tokens", []).append(access_info)
    res = user_data.update_user(user)  # better than save_users([user])
    if res == -1:
        raise HTTPException(status_code=500, detail="failed_to_update_user")

    return {"status": "success", "bearer_token": token}

@router.post("/v1/query")
def query(
    body: DocumentQueryRequest,
    chroma: ChromaService = Depends(get_chroma_service),
    user_data: UserDataService = Depends(get_user_data_service),
):
    user = user_data.require_user(body.token)

    token_with_scope = None
    for token in user.get("tokens", []):
        if token["token"] == body.token:
            token_with_scope = token
            break

    if token_with_scope is None:
        raise HTTPException(status_code=401, detail="invalid_token")

    allowed_scopes = set(token_with_scope.get("scopes", []))
    requested_scopes = set(body.requested_scopes) if body.requested_scopes else allowed_scopes

    decided_scopes = list(requested_scopes & allowed_scopes)
    collection_name = user["collection_name"]
    res = chroma.query(collection_name, [body.query], n_results=5, decided_scopes=decided_scopes)
    return {"status": "success", "results": res}


@router.post("/v1/ingest_refresh")
def ingest_refresh(
    body: IngestRequest,
    ingestion_service: IngestionService = Depends(get_ingestion_service),
    chroma: ChromaService = Depends(get_chroma_service),
    user_data: UserDataService = Depends(get_user_data_service),
):
    user = user_data.require_user(body.token)
    collection_name = user["collection_name"]
    user_folder_path = user["folder_path"]
    scopes = user_data.get_token_scopes(body.token)

    return ingestion_service.ingest_folder(
        folder_path=user_folder_path,
        collection_name=collection_name,
        scopes=scopes,
        chroma_service=chroma,
    )


@router.post("/v1/ingest_repository")
def ingest_repository(
    body: RepositoryIngestRequest,
    ingestion_service: IngestionService = Depends(get_ingestion_service),
    chroma: ChromaService = Depends(get_chroma_service),
    user_data: UserDataService = Depends(get_user_data_service),
):
    user = user_data.require_user(body.token)
    collection_name = user["collection_name"]
    scopes = user_data.get_token_scopes(body.token) or []

    result = ingestion_service.ingest_repository(
        collection_name=collection_name,
        scopes=scopes,
        chroma_service=chroma,
        repository_path=body.repository_path,
        scope=body.scope,
    )

    if result.get("status") == "error":
        raise HTTPException(status_code=403, detail=result.get("detail"))

    return result


@router.post("/v1/debug/get_collections")
def get_collections(
    body: CollectionFetchRequest, chroma: ChromaService = Depends(get_chroma_service),
    user_data: UserDataService = Depends(get_user_data_service),
):
    user = user_data.require_user(body.token)
    collection_name = user["collection_name"]
    scopes = user_data.get_token_scopes(body.token)
    
    return chroma.get_collection_data(collection_name, scopes)



@router.post("/v1/delete_user")
def delete_user(
    body: DeleteUserRequest,
    chroma: ChromaService = Depends(get_chroma_service),
    user_data: UserDataService = Depends(get_user_data_service),
):
    user = user_data.validate_user(body.username, body.password)

    collection_name = user["collection_name"]
    folder_path = user.get("folder_path")

    # delete Chroma collection
    res = chroma.delete_collection(collection_name)
    if res == -1:
        raise HTTPException(status_code=500, detail="failed_to_delete_collection")

    # delete folder if it exists
    if folder_path:
        folder = Path(folder_path)
        if folder.exists() and folder.is_dir():
            shutil.rmtree(folder)

    user_data.delete_user(body.username, body.password)

    return {"status": "success"}


# @router.post("/v1/add_documents")
# def add_documents(
#     body: DocumentAddRequest,
#     chroma: ChromaService = Depends(get_chroma_service),
#     user_data: UserDataService = Depends(get_user_data_service),
# ):
#     ids = [generate_unique_id() for _ in body.documents]

#     collection_name = user_data.require_collection_name(body.token)
#     res = chroma.upsert_documents(collection_name, body.documents, ids)
#     if res == -1:
#         raise HTTPException(status_code=500, detail="failed_to_add_documents")
#     return {"status": "success"}
