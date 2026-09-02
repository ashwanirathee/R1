import asyncio

from definitions import ChatMessage, ChatRequest, GenerateRequest
from utils import (
    format_rag_context,
    latest_user_message,
    ollama_content,
    ollama_options,
    query_rag,
    rag_enriched_messages,
    rag_enriched_user_text,
    rag_items,
)


class FakeHttpResponse:
    def __init__(self, payload, status_code=200, text="ok"):
        self.payload = payload
        self.status_code = status_code
        self.text = text

    def json(self):
        return self.payload

    def raise_for_status(self):
        return None


class FakeAsyncClient:
    calls = []

    def __init__(self, timeout):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return None

    async def post(self, url, json, headers):
        self.calls.append(
            {
                "url": url,
                "json": json,
                "headers": headers,
                "timeout": self.timeout,
            }
        )
        return FakeHttpResponse({"results": {"documents": [["answer"]]}})


def test_ollama_options_maps_supported_generation_settings():
    request = GenerateRequest(
        prompt="hello",
        temperature=0.3,
        top_p=0.8,
        max_tokens=42,
    )

    assert ollama_options(request) == {
        "temperature": 0.3,
        "top_p": 0.8,
        "num_predict": 42,
    }


def test_ollama_options_omits_unset_values():
    request = ChatRequest(messages=[ChatMessage(role="user", content="hello")])

    assert ollama_options(request) == {}


def test_ollama_content_accepts_chat_generate_and_content_shapes():
    assert ollama_content({"message": {"content": "chat reply"}}) == "chat reply"
    assert ollama_content({"response": "generate reply"}) == "generate reply"
    assert ollama_content({"content": "raw reply"}) == "raw reply"
    assert ollama_content({"message": {"thinking": "hidden"}}) == ""


def test_rag_items_flattens_chroma_query_results():
    items = rag_items(
        {
            "results": {
                "documents": [["first", "second"]],
                "metadatas": [[{"relative_path": "a.md"}, {"filename": "b.md"}]],
                "ids": [["id-1", "id-2"]],
                "distances": [[0.1, 0.2]],
            }
        }
    )

    assert items == [
        {
            "content": "first",
            "metadata": {"relative_path": "a.md"},
            "source": "a.md",
            "id": "id-1",
            "distance": 0.1,
        },
        {
            "content": "second",
            "metadata": {"filename": "b.md"},
            "source": "b.md",
            "id": "id-2",
            "distance": 0.2,
        },
    ]


def test_format_rag_context_includes_sources():
    context = format_rag_context(
        {
            "results": [
                {
                    "content": "RAG stores repository context.",
                    "metadata": {"relative_path": "src/rag/readme.md"},
                }
            ]
        }
    )

    assert context == "[1] src/rag/readme.md\nRAG stores repository context."


def test_latest_user_message_returns_last_nonempty_user_message():
    messages = [
        ChatMessage(role="user", content="first"),
        ChatMessage(role="assistant", content="reply"),
        ChatMessage(role="user", content="  latest  "),
    ]

    assert latest_user_message(messages) == "latest"


def test_query_rag_posts_to_current_query_endpoint_with_token_scopes(monkeypatch):
    FakeAsyncClient.calls = []
    monkeypatch.setattr("utils.RAG_BASE_URL", "http://rag.local/")
    monkeypatch.setattr("utils.RAG_TOKEN", "token-1")
    monkeypatch.setattr("utils.RAG_REQUESTED_SCOPES", ["public", "private"])
    monkeypatch.setattr("utils.RAG_TIMEOUT_SECONDS", 2.5)
    monkeypatch.setattr("utils.httpx.AsyncClient", FakeAsyncClient)

    result = asyncio.run(query_rag("where are the docs?"))

    assert result == {"results": {"documents": [["answer"]]}}
    assert len(FakeAsyncClient.calls) == 1
    call = FakeAsyncClient.calls[0]
    assert call["url"] == "http://rag.local/v1/query"
    assert call["json"] == {
        "token": "token-1",
        "query": "where are the docs?",
        "requested_scopes": ["public", "private"],
    }
    assert call["headers"] == {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": "Bearer token-1",
    }
    assert "2.5" in repr(call["timeout"])


def test_query_rag_skips_when_rag_or_token_is_unset(monkeypatch):
    FakeAsyncClient.calls = []
    monkeypatch.setattr("utils.RAG_BASE_URL", "http://rag.local")
    monkeypatch.setattr("utils.RAG_TOKEN", None)
    monkeypatch.setattr("utils.httpx.AsyncClient", FakeAsyncClient)

    result = asyncio.run(query_rag("anything"))

    assert result is None
    assert FakeAsyncClient.calls == []


def test_rag_enriched_user_text_includes_retrieved_context(monkeypatch):
    async def fake_query_rag(query):
        assert query == "what is indexed?"
        return {
            "results": {
                "documents": [["RAG has repo docs."]],
                "metadatas": [[{"relative_path": "src/rag/readme.md"}]],
            }
        }

    monkeypatch.setattr("utils.query_rag", fake_query_rag)

    enriched = asyncio.run(rag_enriched_user_text("what is indexed?", "test"))

    assert "Retrieved repository context:" in enriched
    assert "[1] src/rag/readme.md" in enriched
    assert "RAG has repo docs." in enriched
    assert "User question:\nwhat is indexed?" in enriched


def test_rag_enriched_messages_returns_original_when_no_user_message():
    messages = [ChatMessage(role="assistant", content="hello")]

    enriched = asyncio.run(rag_enriched_messages(messages, "test"))

    assert enriched is messages


def test_rag_enriched_messages_replaces_latest_user_message(monkeypatch):
    async def fake_rag_enriched_user_text(user_text, log_label):
        return f"{log_label}: {user_text}"

    monkeypatch.setattr(
        "utils.rag_enriched_user_text",
        fake_rag_enriched_user_text,
    )
    messages = [
        ChatMessage(role="user", content="first"),
        ChatMessage(role="assistant", content="reply"),
        ChatMessage(role="user", content="latest"),
    ]

    enriched = asyncio.run(rag_enriched_messages(messages, "test"))

    assert enriched[0].content == "first"
    assert enriched[2].content == "test: latest"
