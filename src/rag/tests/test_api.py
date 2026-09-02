from fastapi.testclient import TestClient

from run_rag import app
from src.routers import v1
from src.services.chroma import get_chroma_service
from src.services.ingest import get_ingestion_service
from src.services.user import get_user_data_service


class FakeChromaService:
    def __init__(self):
        self.created_collections = []
        self.query_calls = []

    def create_collection(self, name: str):
        self.created_collections.append(name)
        return 0

    def query(self, collection_name, query_texts, n_results=5, decided_scopes=None):
        self.query_calls.append(
            {
                "collection_name": collection_name,
                "query_texts": query_texts,
                "n_results": n_results,
                "decided_scopes": decided_scopes,
            }
        )
        return {"documents": [["R1 answer"]], "metadatas": [[{"scope": "public"}]]}


class FakeIngestionService:
    def __init__(self):
        self.repository_calls = []

    def ingest_repository(self, **kwargs):
        self.repository_calls.append(kwargs)
        if kwargs["scope"] not in kwargs["scopes"]:
            return {"status": "error", "detail": "scope_not_allowed"}
        return {"status": "ok", "indexed_files": 1, "indexed_chunks": 1}


class FakeUserDataService:
    def __init__(self, users=None):
        self.users = list(users or [])

    def load_users(self):
        return self.users

    def save_users(self, users):
        self.users = users

    def validate_user(self, username, password):
        for user in self.users:
            if user.get("username") == username and user.get("password") == password:
                return user
        return None

    def update_user(self, user):
        for index, existing_user in enumerate(self.users):
            if existing_user.get("username") == user.get("username"):
                self.users[index] = user
                return 0
        return -1

    def get_user_by_token(self, token):
        for user in self.users:
            for token_record in user.get("tokens", []):
                if token_record.get("token") == token:
                    return user
        return None

    def validate_token(self, token):
        return self.get_user_by_token(token) is not None

    def require_user(self, token):
        user = self.get_user_by_token(token)
        if user is None:
            raise AssertionError("unexpected invalid token in test")
        return user

    def get_token_scopes(self, token):
        user = self.get_user_by_token(token)
        if not user:
            return None
        for token_record in user.get("tokens", []):
            if token_record.get("token") == token:
                return token_record.get("scopes", [])
        return None


def test_health_does_not_require_auth():
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_signup_creates_collection_user_and_scope_folders(monkeypatch, tmp_path):
    fake_chroma = FakeChromaService()
    fake_users = FakeUserDataService()
    monkeypatch.setattr(v1, "USER_FOLDERS_ROOT", tmp_path)
    monkeypatch.setattr(v1, "generate_unique_id", lambda: "generated-id")
    app.dependency_overrides[get_chroma_service] = lambda: fake_chroma
    app.dependency_overrides[get_user_data_service] = lambda: fake_users

    try:
        response = TestClient(app).post(
            "/v1/signup",
            json={"username": "ash", "password": "pass"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    assert fake_chroma.created_collections == ["generated-id"]
    assert fake_users.users[0]["username"] == "ash"
    for scope in ["secret", "private", "private_safe", "public"]:
        assert (tmp_path / "generated-id" / scope).is_dir()


def test_create_token_intersects_requested_scopes_with_allowed_scopes(monkeypatch):
    fake_users = FakeUserDataService(
        [{"username": "ash", "password": "pass", "tokens": []}]
    )
    monkeypatch.setattr(v1, "generate_strong_token", lambda: "token-1")
    app.dependency_overrides[get_user_data_service] = lambda: fake_users

    try:
        response = TestClient(app).post(
            "/v1/create_token",
            json={
                "username": "ash",
                "password": "pass",
                "scopes": ["public", "not-real"],
                "label": "ci",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["bearer_token"] == "token-1"
    assert fake_users.users[0]["tokens"][0]["scopes"] == ["public"]


def test_query_uses_intersection_of_requested_and_token_scopes():
    fake_chroma = FakeChromaService()
    fake_users = FakeUserDataService(
        [
            {
                "collection_name": "collection-1",
                "tokens": [{"token": "token-1", "scopes": ["public"]}],
            }
        ]
    )
    app.dependency_overrides[get_chroma_service] = lambda: fake_chroma
    app.dependency_overrides[get_user_data_service] = lambda: fake_users

    try:
        response = TestClient(app).post(
            "/v1/query",
            json={
                "token": "token-1",
                "query": "where is the R1 docs?",
                "requested_scopes": ["public", "secret"],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert fake_chroma.query_calls[0]["decided_scopes"] == ["public"]


def test_ingest_repository_blocks_scope_not_granted_to_token():
    fake_chroma = FakeChromaService()
    fake_ingestion = FakeIngestionService()
    fake_users = FakeUserDataService(
        [
            {
                "collection_name": "collection-1",
                "tokens": [{"token": "token-1", "scopes": ["public"]}],
            }
        ]
    )
    app.dependency_overrides[get_chroma_service] = lambda: fake_chroma
    app.dependency_overrides[get_ingestion_service] = lambda: fake_ingestion
    app.dependency_overrides[get_user_data_service] = lambda: fake_users

    try:
        response = TestClient(app).post(
            "/v1/ingest_repository",
            json={"token": "token-1", "scope": "secret"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert response.json()["detail"] == "scope_not_allowed"
