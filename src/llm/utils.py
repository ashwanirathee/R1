import json
import logging
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException

from definitions import ChatMessage, ChatRequest, GenerateRequest


OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:1.7b")
OLLAMA_THINK = os.getenv("OLLAMA_THINK", "false").lower() in {"1", "true", "yes", "on"}
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "300"))
APP_DIR = Path(__file__).resolve().parent
SYSTEM_PROMPT_PATH = Path(os.getenv("SYSTEM_PROMPT_PATH", APP_DIR / "prompts" / "persona_1.txt"))
MEDHA_BASE_URL = os.getenv("MEDHA_BASE_URL")
MEDHA_TOKEN = os.getenv("MEDHA_TOKEN")
MEDHA_REQUESTED_SCOPES = [
    scope.strip()
    for scope in os.getenv("MEDHA_REQUESTED_SCOPES", "public").split(",")
    if scope.strip()
]
MEDHA_QUERY_LIMIT = int(os.getenv("MEDHA_QUERY_LIMIT", "2"))
MEDHA_TIMEOUT_SECONDS = float(os.getenv("MEDHA_TIMEOUT_SECONDS", "10"))

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("r1-api")


def load_system_prompt() -> str:
    try:
        prompt = SYSTEM_PROMPT_PATH.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"Could not read system prompt at {SYSTEM_PROMPT_PATH}") from exc
    if not prompt:
        raise RuntimeError(f"System prompt file is empty: {SYSTEM_PROMPT_PATH}")
    return prompt


MURPHY_SYSTEM_PROMPT = load_system_prompt()


def ollama_options(request: ChatRequest | GenerateRequest) -> dict[str, Any]:
    options: dict[str, Any] = {}
    if request.temperature is not None:
        options["temperature"] = request.temperature
    if request.top_p is not None:
        options["top_p"] = request.top_p
    if request.max_tokens is not None:
        options["num_predict"] = request.max_tokens
    return options


async def ollama_post(path: str, payload: dict[str, Any]) -> httpx.Response:
    timeout = httpx.Timeout(REQUEST_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            logger.info(
                "Calling Ollama path=%s model=%s stream=%s",
                path,
                payload.get("model"),
                payload.get("stream"),
            )
            response = await client.post(f"{OLLAMA_BASE_URL}{path}", json=payload)
            logger.info("Ollama response path=%s status=%s", path, response.status_code)
            response.raise_for_status()
            return response
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text or exc.response.reason_phrase
            logger.warning(
                "Ollama HTTP error path=%s status=%s detail=%s",
                path,
                exc.response.status_code,
                detail[:500],
            )
            raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
        except httpx.HTTPError as exc:
            logger.warning("Ollama request failed path=%s error=%s", path, exc)
            raise HTTPException(
                status_code=503,
                detail=f"Could not reach Ollama at {OLLAMA_BASE_URL}: {exc}",
            ) from exc


async def ollama_stream(path: str, payload: dict[str, Any]) -> AsyncIterator[bytes]:
    timeout = httpx.Timeout(REQUEST_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            async with client.stream("POST", f"{OLLAMA_BASE_URL}{path}", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        yield f"data: {line}\n\n".encode("utf-8")
                yield b"data: [DONE]\n\n"
        except httpx.HTTPStatusError as exc:
            error = {"error": exc.response.text or exc.response.reason_phrase}
            yield f"data: {json.dumps(error)}\n\n".encode("utf-8")
        except httpx.HTTPError as exc:
            error = {"error": f"Could not reach Ollama at {OLLAMA_BASE_URL}: {exc}"}
            yield f"data: {json.dumps(error)}\n\n".encode("utf-8")


async def chat_with_ollama(request: ChatRequest) -> dict[str, Any]:
    payload = {
        "model": request.model or OLLAMA_MODEL,
        "messages": [message.model_dump() for message in request.messages],
        "stream": False,
        "think": OLLAMA_THINK,
        "options": ollama_options(request),
    }
    response = await ollama_post("/api/chat", payload)
    return response.json()


def ollama_content(data: dict[str, Any]) -> str:
    message = data.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            return content
        thinking = message.get("thinking")
        if isinstance(thinking, str):
            return ""

    response = data.get("response")
    if isinstance(response, str):
        return response

    content = data.get("content")
    if isinstance(content, str):
        return content

    return ""


def medha_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if MEDHA_TOKEN:
        headers["Authorization"] = f"Bearer {MEDHA_TOKEN}"
    return headers


async def query_medha(query: str) -> dict[str, Any] | None:
    if not MEDHA_BASE_URL or not MEDHA_TOKEN:
        logger.info(
            "Skipping RAG query medha_base_url_set=%s medha_token_set=%s",
            bool(MEDHA_BASE_URL),
            bool(MEDHA_TOKEN),
        )
        return None

    payload: dict[str, Any] = {
        "token": MEDHA_TOKEN,
        "query": query,
        "requested_scopes": MEDHA_REQUESTED_SCOPES,
    }

    timeout = httpx.Timeout(MEDHA_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            logger.info(
                "Querying RAG url=%s scopes=%s query_chars=%s",
                f"{MEDHA_BASE_URL.rstrip('/')}/v1/query",
                MEDHA_REQUESTED_SCOPES,
                len(query),
            )
            response = await client.post(
                f"{MEDHA_BASE_URL.rstrip('/')}/v1/query",
                json=payload,
                headers=medha_headers(),
            )
            logger.info(
                "RAG response status=%s response_chars=%s",
                response.status_code,
                len(response.text),
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "RAG HTTP error status=%s detail=%s",
                exc.response.status_code,
                exc.response.text[:500],
            )
            return None
        except httpx.HTTPError as exc:
            logger.warning("RAG request failed error=%s", exc)
            return None


def flatten_chroma_results(results: dict[str, Any]) -> list[dict[str, Any]]:
    documents = results.get("documents")
    metadatas = results.get("metadatas")
    ids = results.get("ids")
    distances = results.get("distances")

    if not isinstance(documents, list):
        return []

    first_documents = documents[0] if documents and isinstance(documents[0], list) else documents
    first_metadatas = metadatas[0] if isinstance(metadatas, list) and metadatas and isinstance(metadatas[0], list) else metadatas
    first_ids = ids[0] if isinstance(ids, list) and ids and isinstance(ids[0], list) else ids
    first_distances = distances[0] if isinstance(distances, list) and distances and isinstance(distances[0], list) else distances

    items: list[dict[str, Any]] = []
    for index, text in enumerate(first_documents):
        if not isinstance(text, str) or not text.strip():
            continue

        metadata = {}
        if isinstance(first_metadatas, list) and index < len(first_metadatas):
            candidate = first_metadatas[index]
            if isinstance(candidate, dict):
                metadata = candidate

        item: dict[str, Any] = {
            "content": text,
            "metadata": metadata,
        }
        source = metadata.get("relative_path") or metadata.get("source") or metadata.get("filename")
        if source:
            item["source"] = source

        if isinstance(first_ids, list) and index < len(first_ids):
            item["id"] = first_ids[index]
        if isinstance(first_distances, list) and index < len(first_distances):
            item["distance"] = first_distances[index]

        items.append(item)
        if len(items) >= MEDHA_QUERY_LIMIT:
            break

    return items


def medha_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    results = data.get("results")
    if isinstance(results, dict):
        return flatten_chroma_results(results)

    for key in ("results", "matches", "documents", "chunks", "items"):
        value = data.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    if isinstance(data.get("data"), list):
        return [item for item in data["data"] if isinstance(item, dict)]
    return []


def string_value(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def medha_item_text(item: dict[str, Any]) -> str | None:
    for key in ("content", "text", "chunk", "page_content", "body", "summary"):
        value = string_value(item.get(key))
        if value:
            return value

    document = item.get("document")
    if isinstance(document, dict):
        for key in ("content", "text", "body", "summary"):
            value = string_value(document.get(key))
            if value:
                return value

    return None


def medha_item_source(item: dict[str, Any]) -> str | None:
    metadata = item.get("metadata")
    candidates = [item]
    if isinstance(metadata, dict):
        candidates.append(metadata)

    document = item.get("document")
    if isinstance(document, dict):
        candidates.append(document)

    for candidate in candidates:
        for key in ("source", "relative_path", "filename", "title", "url", "path", "document_id", "id"):
            value = string_value(candidate.get(key))
            if value:
                return value
    return None


def sanitize_retrieved_context(text: str) -> str:
    return text.replace("Medha", "RAG").replace("medha", "rag")


def format_rag_context(data: dict[str, Any] | None) -> str | None:
    if not data:
        logger.info("No RAG data to format")
        return None

    context_blocks: list[str] = []
    items = medha_items(data)
    logger.info("Formatting RAG context candidate_items=%s", len(items))
    for index, item in enumerate(items, start=1):
        text = medha_item_text(item)
        if not text:
            continue
        text = sanitize_retrieved_context(text)

        source = medha_item_source(item)
        heading = f"[{index}]"
        if source:
            heading = f"{heading} {source}"
        context_blocks.append(f"{heading}\n{text}")

    if not context_blocks:
        logger.info("RAG data produced no usable context blocks")
        return None
    context = "\n\n".join(context_blocks)
    logger.info("Formatted RAG context blocks=%s chars=%s", len(context_blocks), len(context))
    return context


def latest_user_message(messages: list[ChatMessage]) -> str | None:
    for message in reversed(messages):
        if message.role == "user" and message.content.strip():
            return message.content.strip()
    return None


async def rag_enriched_user_text(user_text: str, log_label: str) -> str:
    rag_context = format_rag_context(await query_medha(user_text))
    if rag_context:
        logger.info("%s using RAG context chars=%s", log_label, len(rag_context))
        return (
            "Use the retrieved context below when it is relevant. "
            "If the context does not answer the question, say what is missing and answer from general knowledge only when appropriate.\n\n"
            f"Retrieved repository context:\n{rag_context}\n\n"
            f"User question:\n{user_text}"
        )

    logger.info("%s no RAG context found", log_label)
    return (
        "No relevant RAG context was found. "
        "Answer the question from general knowledge only when appropriate.\n\n"
        f"User question:\n{user_text}"
    )


async def rag_enriched_messages(messages: list[ChatMessage], log_label: str) -> list[ChatMessage]:
    latest_user_text = latest_user_message(messages)
    if not latest_user_text:
        logger.info("%s skipping RAG because no user message was found", log_label)
        return messages

    enriched_text = await rag_enriched_user_text(latest_user_text, log_label)
    enriched_messages = list(messages)

    for index in range(len(enriched_messages) - 1, -1, -1):
        if enriched_messages[index].role == "user":
            enriched_messages[index] = ChatMessage(role="user", content=enriched_text)
            break

    return enriched_messages


async def check_rag_health() -> str:
    if not MEDHA_BASE_URL:
        return "disabled"

    async with httpx.AsyncClient(timeout=MEDHA_TIMEOUT_SECONDS) as client:
        try:
            response = await client.get(
                f"{MEDHA_BASE_URL.rstrip('/')}/health",
                headers=medha_headers(),
            )
            response.raise_for_status()
        except httpx.HTTPError:
            return "unavailable"

    return "ok"


async def check_ollama_health() -> None:
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("Health Ollama unavailable error=%s", exc)
            raise HTTPException(status_code=503, detail=f"Ollama is unavailable: {exc}") from exc
