# r1-api.ashwanirathee.com

FastAPI service for serving Qwen3 through a local Ollama instance, with optional
RAG context for website chat requests.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
ollama pull qwen3:1.7b
ollama serve
OLLAMA_MODEL=qwen3:1.7b \
RAG_BASE_URL=http://127.0.0.1:8000 \
uvicorn app:app --host 127.0.0.1 --port 3000
```

RAG is enabled when `RAG_BASE_URL` is set. Optional RAG settings:

- `RAG_TOKEN`: bearer token, if RAG requires auth.
- `RAG_REQUESTED_SCOPES`: comma-separated scopes to search, default `public`.
- `RAG_QUERY_LIMIT`: number of chunks to retrieve, default `2`.
- `RAG_TIMEOUT_SECONDS`: RAG request timeout, default `10`.

## Endpoints

- `GET /health` checks the FastAPI service, Ollama connection, and RAG status when configured.
- `POST /chat` forwards chat requests to Ollama. Requests shaped like `{"message":"..."}` are enriched with RAG context when `RAG_BASE_URL` is configured.
- `POST /generate` forwards prompt completion requests to Ollama.
- `POST /v1/chat/completions` returns an OpenAI-compatible non-streaming chat response.

Example:

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hello in one sentence."}]}'
```

## Cloudflare tunnel

The tunnel should route:

```yaml
hostname: r1-api.ashwanirathee.com
service: http://127.0.0.1:3000
```
