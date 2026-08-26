# r1-api.ashwanirathee.com

FastAPI service for serving Qwen3 through a local Ollama instance, with optional
Medha RAG context for website chat requests.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
ollama pull qwen3:1.7b
ollama serve
OLLAMA_MODEL=qwen3:1.7b \
MEDHA_BASE_URL=http://127.0.0.1:8000 \
uvicorn app:app --host 127.0.0.1 --port 3000
```

Medha is enabled when `MEDHA_BASE_URL` is set. Optional Medha settings:

- `MEDHA_TOKEN`: bearer token, if Medha requires auth.
- `MEDHA_REQUESTED_SCOPES`: comma-separated scopes to search, default `public`.
- `MEDHA_QUERY_LIMIT`: number of chunks to retrieve, default `5`.
- `MEDHA_TIMEOUT_SECONDS`: Medha request timeout, default `10`.

## Endpoints

- `GET /health` checks the FastAPI service, Ollama connection, and Medha status when configured.
- `POST /chat` forwards chat requests to Ollama. Requests shaped like `{"message":"..."}` are enriched with Medha context when `MEDHA_BASE_URL` is configured.
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
