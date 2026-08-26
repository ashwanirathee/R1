from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from definitions import ChatMessage, ChatRequest, FrontendChatRequest, GenerateRequest
from utils import (
    MEDHA_BASE_URL,
    MURPHY_SYSTEM_PROMPT,
    OLLAMA_MODEL,
    OLLAMA_THINK,
    chat_with_ollama,
    check_ollama_health,
    check_rag_health,
    logger,
    ollama_content,
    ollama_options,
    ollama_post,
    ollama_stream,
    rag_enriched_messages,
    rag_enriched_user_text,
)


router = APIRouter()


@router.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "r1-api",
        "model": OLLAMA_MODEL,
        "rag": "enabled" if MEDHA_BASE_URL else "disabled",
    }


@router.get("/health")
async def health() -> dict[str, Any]:
    rag_status = await check_rag_health()
    logger.info("Health RAG status=%s", rag_status)

    await check_ollama_health()
    logger.info("Health ok model=%s rag=%s", OLLAMA_MODEL, rag_status)
    return {
        "status": "ok",
        "ollama": "ok",
        "rag": rag_status,
        "model": OLLAMA_MODEL,
    }


@router.post("/chat")
async def chat(request: Request) -> Any:
    body = await request.json()
    logger.info("Received /chat request frontend_shape=%s stream=%s", "message" in body, body.get("stream"))

    if "message" in body:
        frontend_request = FrontendChatRequest.model_validate(body)
        user_text = frontend_request.message
        if frontend_request.image:
            user_text = (
                f"{user_text}\n\n"
                "The user attached an image, but this qwen3:1.7b backend is text-only. "
                "Answer the text request and briefly say that image inspection is not available yet."
            )
        logger.info(
            "Frontend chat message chars=%s image_attached=%s",
            len(frontend_request.message),
            bool(frontend_request.image),
        )
        user_text = await rag_enriched_user_text(user_text, "Frontend chat")
        chat_request = ChatRequest(
            messages=[
                ChatMessage(
                    role="system",
                    content=MURPHY_SYSTEM_PROMPT,
                ),
                ChatMessage(role="user", content=user_text),
            ],
            max_tokens=250,
        )
        data = await chat_with_ollama(chat_request)
        reply = ollama_content(data)
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
            for message in await rag_enriched_messages(chat_request.messages, "Proxy chat")
        ],
        "stream": chat_request.stream,
        "think": OLLAMA_THINK,
        "options": ollama_options(chat_request),
    }
    if chat_request.stream:
        return StreamingResponse(
            ollama_stream("/api/chat", payload),
            media_type="text/event-stream",
        )

    response = await ollama_post("/api/chat", payload)
    return response.json()


@router.post("/generate")
async def generate(request: GenerateRequest) -> Any:
    payload = {
        "model": request.model or OLLAMA_MODEL,
        "prompt": request.prompt,
        "stream": request.stream,
        "options": ollama_options(request),
    }
    if request.stream:
        return StreamingResponse(
            ollama_stream("/api/generate", payload),
            media_type="text/event-stream",
        )

    response = await ollama_post("/api/generate", payload)
    return response.json()


@router.post("/v1/chat/completions")
async def openai_chat_completions(request: ChatRequest) -> Any:
    payload = {
        "model": request.model or OLLAMA_MODEL,
        "messages": [
            message.model_dump()
            for message in await rag_enriched_messages(request.messages, "OpenAI chat")
        ],
        "stream": request.stream,
        "think": OLLAMA_THINK,
        "options": ollama_options(request),
    }
    if request.stream:
        return StreamingResponse(
            ollama_stream("/api/chat", payload),
            media_type="text/event-stream",
        )

    response = await ollama_post("/api/chat", payload)
    data = response.json()
    reply = ollama_content(data)
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
