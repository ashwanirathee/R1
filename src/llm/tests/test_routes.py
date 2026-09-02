from fastapi.testclient import TestClient

import routes
from app import app
from definitions import ChatMessage


class FakeOllamaResponse:
    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


def test_root_reports_service_model_and_rag_mode():
    response = TestClient(app).get("/")

    assert response.status_code == 200
    payload = response.json()
    assert payload["service"] == "r1-api"
    assert payload["model"]
    assert payload["rag"] in {"enabled", "disabled"}


def test_health_uses_ollama_and_rag_checks(monkeypatch):
    calls = {"ollama": 0}

    async def fake_check_rag_health():
        return "disabled"

    async def fake_check_ollama_health():
        calls["ollama"] += 1

    monkeypatch.setattr(routes, "check_rag_health", fake_check_rag_health)
    monkeypatch.setattr(routes, "check_ollama_health", fake_check_ollama_health)

    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["rag"] == "disabled"
    assert calls["ollama"] == 1


def test_frontend_chat_enriches_message_and_returns_reply(monkeypatch):
    seen = {}

    async def fake_rag_enriched_user_text(user_text, log_label):
        seen["user_text"] = user_text
        seen["log_label"] = log_label
        return f"enriched: {user_text}"

    async def fake_chat_with_ollama(chat_request):
        seen["messages"] = chat_request.messages
        return {"model": "test-model", "message": {"content": "hello from R1"}}

    monkeypatch.setattr(routes, "rag_enriched_user_text", fake_rag_enriched_user_text)
    monkeypatch.setattr(routes, "chat_with_ollama", fake_chat_with_ollama)

    response = TestClient(app).post("/chat", json={"message": "status?"})

    assert response.status_code == 200
    assert response.json() == {"reply": "hello from R1", "model": "test-model"}
    assert seen["user_text"] == "status?"
    assert seen["log_label"] == "Frontend chat"
    assert seen["messages"][-1].content == "enriched: status?"


def test_openai_compatible_chat_completion_shape(monkeypatch):
    seen = {}

    async def fake_rag_enriched_messages(messages, log_label):
        seen["messages"] = messages
        seen["log_label"] = log_label
        return [
            ChatMessage(role="system", content="system"),
            ChatMessage(role="user", content="enriched question"),
        ]

    async def fake_ollama_post(path, payload):
        seen["path"] = path
        seen["payload"] = payload
        return FakeOllamaResponse(
            {
                "created_at": "abc",
                "done": True,
                "message": {"role": "assistant", "content": "answer"},
                "prompt_eval_count": 3,
                "eval_count": 4,
            }
        )

    monkeypatch.setattr(routes, "rag_enriched_messages", fake_rag_enriched_messages)
    monkeypatch.setattr(routes, "ollama_post", fake_ollama_post)

    response = TestClient(app).post(
        "/v1/chat/completions",
        json={
            "model": "test-model",
            "messages": [{"role": "user", "content": "question"}],
            "temperature": 0.2,
            "max_tokens": 25,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "chatcmpl-abc"
    assert payload["model"] == "test-model"
    assert payload["choices"][0]["message"]["content"] == "answer"
    assert payload["usage"]["total_tokens"] == 7
    assert seen["path"] == "/api/chat"
    assert seen["payload"]["messages"][-1]["content"] == "enriched question"
    assert seen["payload"]["options"] == {"temperature": 0.2, "num_predict": 25}
    assert seen["log_label"] == "OpenAI chat"
