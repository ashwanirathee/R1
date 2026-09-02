import asyncio

from definitions import ChatMessage, ChatRequest, GenerateRequest
from utils import (
    format_rag_context,
    latest_user_message,
    medha_items,
    ollama_content,
    ollama_options,
    rag_enriched_messages,
)


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


def test_medha_items_flattens_chroma_query_results():
    items = medha_items(
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


def test_format_rag_context_sanitizes_medha_name_and_includes_sources():
    context = format_rag_context(
        {
            "results": [
                {
                    "content": "Medha stores repository context.",
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
