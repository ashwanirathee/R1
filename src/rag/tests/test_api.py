import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from src import api


TEST_DOCUMENTS = [
    {
        "id": "shared-doc",
        "title": "Shared Doc",
        "collection": "shared",
        "tags": ["alpha"],
        "updated_at": "2026-03-22",
        "content": "Shared content for retrieval.",
    },
    {
        "id": "private-doc",
        "title": "Private Doc",
        "collection": "private",
        "tags": ["secret"],
        "updated_at": "2026-03-22",
        "content": "Private content.",
    },
]

TEST_TOKENS = {
    "reader-token": api.AccessRule(
        name="reader",
        scopes={"documents:read", "knowledge:query"},
        collections={"shared"},
    ),
    "admin-token": api.AccessRule(
        name="admin",
        scopes={"*"},
        collections={"*"},
    ),
    "query-only-token": api.AccessRule(
        name="query-only",
        scopes={"knowledge:query"},
        collections={"shared"},
    ),
}


def make_request(
    url: str,
    method: str = "GET",
    token: str | None = None,
    payload: dict | None = None,
):
    headers = {}
    body = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        url=url,
        method=method,
        headers=headers,
        data=body,
    )
    return urllib.request.urlopen(request, timeout=2)


@pytest.fixture
def api_server(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(api, "load_documents", lambda: TEST_DOCUMENTS)
    monkeypatch.setattr(api, "load_tokens", lambda: TEST_TOKENS)
    monkeypatch.setattr(api, "load_vector_store", lambda: object())
    monkeypatch.setattr(
        api,
        "query_vector_store",
        lambda query, limit, collections, vector_store: [
            {
                "score": 0.91,
                "document": {
                    "id": "shared-doc",
                    "title": "Shared Doc",
                    "collection": "shared",
                    "tags": ["alpha"],
                    "updated_at": "2026-03-22",
                },
                "chunk": {
                    "id": "shared-doc::chunk::0",
                    "start_index": 0,
                },
                "content": f"match for: {query}",
            }
        ][:limit],
    )

    server = ThreadingHTTPServer(("127.0.0.1", 0), api.MedhaHandler)
    server.documents = TEST_DOCUMENTS
    server.tokens = TEST_TOKENS
    server.vector_store = object()

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"

    try:
        yield base_url, server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_health_does_not_require_auth(api_server):
    base_url, _ = api_server

    with make_request(f"{base_url}/health") as response:
        payload = json.loads(response.read().decode("utf-8"))

    assert response.status == 200
    assert payload == {"status": "ok"}


def test_documents_requires_bearer_token(api_server):
    base_url, _ = api_server

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        make_request(f"{base_url}/v1/documents")

    assert exc_info.value.code == 401
    payload = json.loads(exc_info.value.read().decode("utf-8"))
    assert payload["error"] == "missing_bearer_token"


def test_documents_list_is_filtered_by_token_collections(api_server):
    base_url, _ = api_server

    with make_request(f"{base_url}/v1/documents", token="reader-token") as response:
        payload = json.loads(response.read().decode("utf-8"))

    assert response.status == 200
    assert payload["documents"] == [
        {
            "id": "shared-doc",
            "title": "Shared Doc",
            "collection": "shared",
            "tags": ["alpha"],
            "updated_at": "2026-03-22",
        }
    ]


def test_document_detail_blocks_forbidden_collection(api_server):
    base_url, _ = api_server

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        make_request(f"{base_url}/v1/documents/private-doc", token="reader-token")

    assert exc_info.value.code == 403
    payload = json.loads(exc_info.value.read().decode("utf-8"))
    assert payload["error"] == "collection_forbidden"


def test_query_returns_vector_results(api_server):
    base_url, _ = api_server

    with make_request(
        f"{base_url}/v1/query",
        method="POST",
        token="reader-token",
        payload={"query": "shared retrieval", "limit": 1},
    ) as response:
        payload = json.loads(response.read().decode("utf-8"))

    assert response.status == 200
    assert payload["query"] == "shared retrieval"
    assert len(payload["results"]) == 1
    assert payload["results"][0]["document"]["id"] == "shared-doc"
    assert payload["results"][0]["content"] == "match for: shared retrieval"


def test_query_rejects_disallowed_requested_collections(api_server):
    base_url, _ = api_server

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        make_request(
            f"{base_url}/v1/query",
            method="POST",
            token="reader-token",
            payload={"query": "secret", "collections": ["private"]},
        )

    assert exc_info.value.code == 403
    payload = json.loads(exc_info.value.read().decode("utf-8"))
    assert payload["error"] == "collection_forbidden"


def test_query_returns_service_unavailable_when_index_missing(
    api_server, monkeypatch
):
    base_url, server = api_server

    def raise_missing_index(**kwargs):
        raise FileNotFoundError("index missing")

    monkeypatch.setattr(api, "query_vector_store", raise_missing_index)
    server.vector_store = None

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        make_request(
            f"{base_url}/v1/query",
            method="POST",
            token="reader-token",
            payload={"query": "shared retrieval"},
        )

    assert exc_info.value.code == 503
    payload = json.loads(exc_info.value.read().decode("utf-8"))
    assert payload["error"] == "index_not_built"


def test_admin_reload_requires_admin_scope(api_server):
    base_url, _ = api_server

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        make_request(
            f"{base_url}/v1/admin/reload",
            method="POST",
            token="reader-token",
            payload={},
        )

    assert exc_info.value.code == 403
    payload = json.loads(exc_info.value.read().decode("utf-8"))
    assert payload["error"] == "missing_scope"


def test_admin_reload_succeeds_for_admin_token(api_server):
    base_url, _ = api_server

    with make_request(
        f"{base_url}/v1/admin/reload",
        method="POST",
        token="admin-token",
        payload={},
    ) as response:
        payload = json.loads(response.read().decode("utf-8"))

    assert response.status == 200
    assert payload["status"] == "reloaded"
