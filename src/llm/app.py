import json
import logging
import os
from collections.abc import AsyncIterator
from typing import Any, Literal

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field


OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")
OLLAMA_THINK = os.getenv("OLLAMA_THINK", "false").lower() in {"1", "true", "yes", "on"}
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "300"))
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


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str | None = None
    stream: bool = False
    temperature: float | None = Field(default=None, ge=0)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_tokens: int | None = Field(default=None, gt=0)


class GenerateRequest(BaseModel):
    prompt: str
    model: str | None = None
    stream: bool = False
    temperature: float | None = Field(default=None, ge=0)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_tokens: int | None = Field(default=None, gt=0)


class FrontendChatRequest(BaseModel):
    message: str
    image: dict[str, str] | None = None


app = FastAPI(title="r1-api", version="0.1.0")


@app.on_event("startup")
async def log_startup_config() -> None:
    logger.info(
        "Starting r1-api model=%s ollama_base_url=%s medha_enabled=%s medha_base_url=%s medha_token_set=%s medha_scopes=%s",
        OLLAMA_MODEL,
        OLLAMA_BASE_URL,
        bool(MEDHA_BASE_URL and MEDHA_TOKEN),
        MEDHA_BASE_URL or "unset",
        bool(MEDHA_TOKEN),
        MEDHA_REQUESTED_SCOPES,
    )


def _ollama_options(request: ChatRequest | GenerateRequest) -> dict[str, Any]:
    options: dict[str, Any] = {}
    if request.temperature is not None:
        options["temperature"] = request.temperature
    if request.top_p is not None:
        options["top_p"] = request.top_p
    if request.max_tokens is not None:
        options["num_predict"] = request.max_tokens
    return options


async def _ollama_post(path: str, payload: dict[str, Any]) -> httpx.Response:
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


async def _ollama_stream(path: str, payload: dict[str, Any]) -> AsyncIterator[bytes]:
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


async def _chat_with_ollama(request: ChatRequest) -> dict[str, Any]:
    payload = {
        "model": request.model or OLLAMA_MODEL,
        "messages": [message.model_dump() for message in request.messages],
        "stream": False,
        "think": OLLAMA_THINK,
        "options": _ollama_options(request),
    }
    response = await _ollama_post("/api/chat", payload)
    return response.json()


def _ollama_content(data: dict[str, Any]) -> str:
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


def _medha_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if MEDHA_TOKEN:
        headers["Authorization"] = f"Bearer {MEDHA_TOKEN}"
    return headers


async def _query_medha(query: str) -> dict[str, Any] | None:
    if not MEDHA_BASE_URL or not MEDHA_TOKEN:
        logger.info(
            "Skipping Medha query medha_base_url_set=%s medha_token_set=%s",
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
                "Querying Medha url=%s scopes=%s query_chars=%s",
                f"{MEDHA_BASE_URL.rstrip('/')}/v1/query",
                MEDHA_REQUESTED_SCOPES,
                len(query),
            )
            response = await client.post(
                f"{MEDHA_BASE_URL.rstrip('/')}/v1/query",
                json=payload,
                headers=_medha_headers(),
            )
            logger.info(
                "Medha response status=%s response_chars=%s",
                response.status_code,
                len(response.text),
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Medha HTTP error status=%s detail=%s",
                exc.response.status_code,
                exc.response.text[:500],
            )
            return None
        except httpx.HTTPError as exc:
            logger.warning("Medha request failed error=%s", exc)
            return None


def _flatten_chroma_results(results: dict[str, Any]) -> list[dict[str, Any]]:
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


def _medha_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    results = data.get("results")
    if isinstance(results, dict):
        return _flatten_chroma_results(results)

    for key in ("results", "matches", "documents", "chunks", "items"):
        value = data.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    if isinstance(data.get("data"), list):
        return [item for item in data["data"] if isinstance(item, dict)]
    return []


def _string_value(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _medha_item_text(item: dict[str, Any]) -> str | None:
    for key in ("content", "text", "chunk", "page_content", "body", "summary"):
        value = _string_value(item.get(key))
        if value:
            return value

    document = item.get("document")
    if isinstance(document, dict):
        for key in ("content", "text", "body", "summary"):
            value = _string_value(document.get(key))
            if value:
                return value

    return None


def _medha_item_source(item: dict[str, Any]) -> str | None:
    metadata = item.get("metadata")
    candidates = [item]
    if isinstance(metadata, dict):
        candidates.append(metadata)

    document = item.get("document")
    if isinstance(document, dict):
        candidates.append(document)

    for candidate in candidates:
        for key in ("source", "title", "url", "path", "document_id", "id"):
            value = _string_value(candidate.get(key))
            if value:
                return value
    return None


def _format_medha_context(data: dict[str, Any] | None) -> str | None:
    if not data:
        logger.info("No Medha data to format")
        return None

    context_blocks: list[str] = []
    items = _medha_items(data)
    logger.info("Formatting Medha context candidate_items=%s", len(items))
    for index, item in enumerate(items, start=1):
        text = _medha_item_text(item)
        if not text:
            continue

        source = _medha_item_source(item)
        heading = f"[{index}]"
        if source:
            heading = f"{heading} {source}"
        context_blocks.append(f"{heading}\n{text}")

    if not context_blocks:
        logger.info("Medha data produced no usable context blocks")
        return None
    logger.info("Formatted Medha context blocks=%s chars=%s", len(context_blocks), len("\n\n".join(context_blocks)))
    return "\n\n".join(context_blocks)


def _latest_user_message(messages: list[ChatMessage]) -> str | None:
    for message in reversed(messages):
        if message.role == "user" and message.content.strip():
            return message.content.strip()
    return None


async def _rag_enriched_user_text(user_text: str, log_label: str) -> str:
    medha_context = _format_medha_context(await _query_medha(user_text))
    if medha_context:
        logger.info("%s using Medha context chars=%s", log_label, len(medha_context))
        return (
            "Use the retrieved Medha context below when it is relevant. "
            "If the context does not answer the question, say what is missing and answer from general knowledge only when appropriate.\n\n"
            f"Medha context:\n{medha_context}\n\n"
            f"User question:\n{user_text}"
        )

    logger.info("%s no Medha context found", log_label)
    return (
        "No relevant Medha context was found. "
        "Answer the question from general knowledge only when appropriate.\n\n"
        f"User question:\n{user_text}"
    )


async def _rag_enriched_messages(messages: list[ChatMessage], log_label: str) -> list[ChatMessage]:
    latest_user_text = _latest_user_message(messages)
    if not latest_user_text:
        logger.info("%s skipping Medha because no user message was found", log_label)
        return messages

    enriched_text = await _rag_enriched_user_text(latest_user_text, log_label)
    enriched_messages = list(messages)

    for index in range(len(enriched_messages) - 1, -1, -1):
        if enriched_messages[index].role == "user":
            enriched_messages[index] = ChatMessage(role="user", content=enriched_text)
            break

    return enriched_messages


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "r1-api",
        "model": OLLAMA_MODEL,
        "rag": "medha" if MEDHA_BASE_URL else "disabled",
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    medha_status = "disabled"
    if MEDHA_BASE_URL:
        medha_status = "ok"
        async with httpx.AsyncClient(timeout=MEDHA_TIMEOUT_SECONDS) as client:
            try:
                response = await client.get(
                    f"{MEDHA_BASE_URL.rstrip('/')}/health",
                    headers=_medha_headers(),
                )
                response.raise_for_status()
            except httpx.HTTPError:
                medha_status = "unavailable"
        logger.info("Health Medha status=%s", medha_status)

    async with httpx.AsyncClient(timeout=5) as client:
        try:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("Health Ollama unavailable error=%s", exc)
            raise HTTPException(status_code=503, detail=f"Ollama is unavailable: {exc}") from exc
    logger.info("Health ok model=%s medha=%s", OLLAMA_MODEL, medha_status)
    return {
        "status": "ok",
        "ollama": "ok",
        "medha": medha_status,
        "model": OLLAMA_MODEL,
    }


@app.post("/chat")
async def chat(request: Request) -> Any:
    body = await request.json()
    logger.info("Received /chat request frontend_shape=%s stream=%s", "message" in body, body.get("stream"))

    if "message" in body:
        frontend_request = FrontendChatRequest.model_validate(body)
        user_text = frontend_request.message
        if frontend_request.image:
            user_text = (
                f"{user_text}\n\n"
                "The user attached an image, but this qwen3:8b backend is text-only. "
                "Answer the text request and briefly say that image inspection is not available yet."
            )
        logger.info(
            "Frontend chat message chars=%s image_attached=%s",
            len(frontend_request.message),
            bool(frontend_request.image),
        )
        user_text = await _rag_enriched_user_text(user_text, "Frontend chat")
        chat_request = ChatRequest(
            messages=[
                ChatMessage(
                    role="system",
                    content=(
                        "You are Murphy, a concise assistant for the R1 robot website. "
                        "R1 is a Raspberry Pi 5-based RC car for experiments in perception, "
                        "reasoning, and control. It uses camera input, ROS 2 nodes, audio support, "
                        "and optional remote compute for heavier vision-language models. The project "
                        "includes experiments around vision classification, labeling, model comparison, "
                        "object detection, scene understanding, and an experimental monocular SLAM package. "
                        "The SLAM package lives in src/r1_slam and its main node is implemented in C++ "
                        "as src/r1_slam/src/monocular_slam_node.cpp with a CMake/ament_cmake build; "
                        "its launch file is Python, but the SLAM node itself is C++. "
                        "Answer questions about R1, robotics, ROS 2, perception, control, and experiments. "
                        "For factual repository questions, rely on directly relevant repository paths and "
                        "file extensions. Do not infer a package's implementation language from unrelated "
                        "retrieved files. If the retrieved context is unrelated or insufficient, say so plainly."
                    ),
                ),
                ChatMessage(role="user", content=user_text),
            ],
            max_tokens=250,
        )
        data = await _chat_with_ollama(chat_request)
        reply = _ollama_content(data)
        if not reply:
            message_payload = data.get("message")
            message_keys = sorted(message_payload.keys()) if isinstance(message_payload, dict) else []
            logger.warning(
                "Frontend chat received empty Ollama content response_keys=%s message_keys=%s message_type=%s done=%s done_reason=%s eval_count=%s",
                sorted(data.keys()),
                message_keys,
                type(data.get("message")).__name__,
                data.get("done"),
                data.get("done_reason"),
                data.get("eval_count"),
            )
        logger.info(
            "Frontend chat complete model=%s reply_chars=%s",
            data.get("model", OLLAMA_MODEL),
            len(reply),
        )
        return {
            "reply": reply,
            "model": data.get("model", OLLAMA_MODEL),
        }

    chat_request = ChatRequest.model_validate(body)
    logger.info(
        "Proxy chat request messages=%s model=%s stream=%s",
        len(chat_request.messages),
        chat_request.model or OLLAMA_MODEL,
        chat_request.stream,
    )
    payload = {
        "model": chat_request.model or OLLAMA_MODEL,
        "messages": [
            message.model_dump()
            for message in await _rag_enriched_messages(chat_request.messages, "Proxy chat")
        ],
        "stream": chat_request.stream,
        "think": OLLAMA_THINK,
        "options": _ollama_options(chat_request),
    }
    if chat_request.stream:
        return StreamingResponse(
            _ollama_stream("/api/chat", payload),
            media_type="text/event-stream",
        )

    response = await _ollama_post("/api/chat", payload)
    return response.json()


@app.post("/generate")
async def generate(request: GenerateRequest) -> Any:
    payload = {
        "model": request.model or OLLAMA_MODEL,
        "prompt": request.prompt,
        "stream": request.stream,
        "options": _ollama_options(request),
    }
    if request.stream:
        return StreamingResponse(
            _ollama_stream("/api/generate", payload),
            media_type="text/event-stream",
        )

    response = await _ollama_post("/api/generate", payload)
    return response.json()


@app.post("/v1/chat/completions")
async def openai_chat_completions(request: ChatRequest) -> Any:
    payload = {
        "model": request.model or OLLAMA_MODEL,
        "messages": [
            message.model_dump()
            for message in await _rag_enriched_messages(request.messages, "OpenAI chat")
        ],
        "stream": request.stream,
        "think": OLLAMA_THINK,
        "options": _ollama_options(request),
    }
    if request.stream:
        return StreamingResponse(
            _ollama_stream("/api/chat", payload),
            media_type="text/event-stream",
        )

    response = await _ollama_post("/api/chat", payload)
    data = response.json()
    reply = _ollama_content(data)
    role = "assistant"
    message = data.get("message")
    if isinstance(message, dict):
        role = message.get("role", "assistant")
    if not reply:
        message_keys = sorted(message.keys()) if isinstance(message, dict) else []
        logger.warning(
            "OpenAI chat received empty Ollama content response_keys=%s message_keys=%s message_type=%s done=%s done_reason=%s eval_count=%s",
            sorted(data.keys()),
            message_keys,
            type(data.get("message")).__name__,
            data.get("done"),
            data.get("done_reason"),
            data.get("eval_count"),
        )
    return {
        "id": f"chatcmpl-{data.get('created_at', 'ollama')}",
        "object": "chat.completion",
        "created": 0,
        "model": payload["model"],
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": role,
                    "content": reply,
                },
                "finish_reason": "stop" if data.get("done") else None,
            }
        ],
        "usage": {
            "prompt_tokens": data.get("prompt_eval_count", 0),
            "completion_tokens": data.get("eval_count", 0),
            "total_tokens": data.get("prompt_eval_count", 0) + data.get("eval_count", 0),
        },
    }
