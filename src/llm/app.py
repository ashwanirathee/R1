from fastapi import FastAPI

from routes import router
from utils import (
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    RAG_BASE_URL,
    RAG_REQUESTED_SCOPES,
    RAG_TOKEN,
    SYSTEM_PROMPT_PATH,
    logger,
)



app = FastAPI(title="r1-api", version="0.1.0")
app.include_router(router)


@app.on_event("startup")
async def log_startup_config() -> None:
    logger.info(
        "Starting r1-api model=%s ollama_base_url=%s rag_enabled=%s rag_base_url=%s rag_token_set=%s rag_scopes=%s system_prompt=%s",
        OLLAMA_MODEL,
        OLLAMA_BASE_URL,
        bool(RAG_BASE_URL and RAG_TOKEN),
        RAG_BASE_URL or "unset",
        bool(RAG_TOKEN),
        RAG_REQUESTED_SCOPES,
        SYSTEM_PROMPT_PATH,
    )
