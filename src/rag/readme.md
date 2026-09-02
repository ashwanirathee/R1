# RAG

RAG is a FastAPI service that provisions per-user collections inside a running ChromaDB instance. It exposes endpoints for user signup, bearer-token creation, document ingestion, folder-based bulk indexing, and retrieval over the stored chunks.

## What Ships In This Repo

- `run_rag.py`: FastAPI application that wires the `v1` router.
- `run_rag.sh`: helper wrapper around `uv run uvicorn run_rag:app` with sensible host/port defaults.
- `src/routers/v1.py`: request handlers for signup, ingestion, querying, and health.
- `src/services/chroma.py`: thin client around `chromadb.HttpClient` (expects a Chroma server on `localhost:8000`).
- `src/services/ingest.py`: folder ingestion utilities (PDF/Text/Markdown parsing, fixed-size chunking, and metadata generation).
- `src/services/user.py`: JSON-backed token storage under `data/users.json`.
- `src/models/auth.py`, `src/models/access.py`: Pydantic schemas for the API surface.
- `src/token_utils.py`: secure token and ID helpers.

The code now depends on the Chroma HTTP API for persistence.

## Requirements

- Python 3.10–3.14 (managed via `uv`)
- A running Chroma server listening on `localhost:8000`
- Local file access for any folders you plan to ingest

Set up Python dependencies:

```bash
cd ./r1/rag
uv sync
```

Start a Chroma server in another terminal. For example:

```bash
./run_chroma.sh
```

Docker-based Chroma deployments work too as long as the FastAPI process can reach port `8000`.

## Running The API

Launch the server with `uvicorn`:

```bash
uv run uvicorn run_rag:app --host 127.0.0.1 --port 8051 --reload
```

Or rely on the helper script (defaults to `0.0.0.0:8051` so you can hit it from other devices on the network):

```bash
./run_rag.sh [--host 0.0.0.0] [--port 8051]
```

Hit `GET /health` to verify readiness.

## API Overview

All routes live under `src/routers/v1.py`:

- `GET /health` — basic readiness probe.
- `POST /v1/signup` — register a user. Creates a Chroma collection, creates the default user folders (`secret`, `private`, `private_safe`, `public`), and stores the user record. Body:

  ```json
  {
    "username": "demo",
    "password": "plaintext-only-for-local-testing"
  }
  ```

  Response:

  ```json
  {
    "status": "success"
  }
  ```
- `POST /v1/create_token` — issue a bearer token for an existing user and requested scopes. Body:

  ```json
  {
    "username": "demo",
    "password": "plaintext-only-for-local-testing",
    "scopes": ["public"],
    "label": "default"
  }
  ```

  Response includes `bearer_token`.
- `POST /v1/query` — run similarity search with the provided `query`. Uses the caller's token scopes unless `requested_scopes` is provided, then returns the matching Chroma results.

  ```json
  {
    "token": "bearer token from /v1/create_token",
    "query": "what context is available?",
    "requested_scopes": ["public"]
  }
  ```
- `POST /v1/ingest_refresh` — re-index the authenticated user's managed folder into their Chroma collection. The route requires `token`; the current request schema also includes `folder_path`, but the handler uses the stored user folder path.

  ```json
  {
    "token": "bearer token from /v1/create_token",
    "folder_path": "ignored-by-current-handler"
  }
  ```
- `POST /v1/ingest_repository` — recursively index a repository path into the caller's collection, scoped to `scope` (defaults to `public`). Pass `repository_path` only when indexing a checkout other than the default RAG repository root.
- `POST /v1/debug/get_collections` — fetch stored documents/metadatas from the authenticated user's collection, filtered by the token's scopes.
- `POST /v1/delete_user` — delete a user, their Chroma collection, and their managed user folder after validating `username` and `password`.

The old routes `/v1/add_documents`, `/v1/query_documents`, `/v1/ingest_documents`, and `/v1/collections` are not currently registered in `src/routers/v1.py`.

Errors are surfaced as FastAPI HTTP exceptions (400 for validation, 401/403 for unauthorized, 500 for unexpected Chroma failures).

## Folder Ingestion Details

`src/services/ingest.py` handles the heavy lifting:

- Supported file types: PDF via `pypdf`, UTF-8 text, and Markdown.
- Default chunk size: 1,000 characters with 200-character overlap.
- IDs follow `relative/path/inside/folder::chunk_index`.
- Metadata includes filename, relative path, file type, chunk index, and total chunk count.

The ingestion endpoint reports how many files and chunks were indexed.

## Repository Ingestion

Use `POST /v1/ingest_repository` to index the R1 repository itself into the
authenticated user's Chroma collection. This path is meant for project-aware
chat and skips local-only or sensitive paths such as `.git`, `.env`, `.venv`,
`node_modules`, build outputs, and RAG runtime `data`.

```bash
curl http://127.0.0.1:8051/v1/ingest_repository \
  -H 'content-type: application/json' \
  -d '{"token":"'"$RAG_TOKEN"'","scope":"public"}'
```

By default, RAG indexes the repository root containing this RAG service. Pass
`repository_path` only when you intentionally want to index another checkout.

## User Store

`data/users.json` holds all user entries. Each record contains:

```json
{
  "username": "alice",
  "password": "alice",
  "tokens": [
    {
      "token": "randomly generated bearer token",
      "scopes": ["public"],
      "is_active": "true",
      "label": "default",
      "created_at": "2026-09-02T12:00:00+00:00"
    }
  ],
  "collection_name": "generated collection id",
  "user_id": "generated user id",
  "folder_path": "data/user_folders/generated user id"
}
```

Use `/v1/create_token` to issue additional tokens. Tokens are currently stored in plaintext and scoped by the token record plus the user's Chroma collection.

## Development

- `uv run pytest` — run the Python test suite (note: legacy tests still target the previous HTTP handler and will need adjustments to reflect the new FastAPI router).
- `uv run uvicorn run_rag:app --reload` — recommended during development for auto-reload.

Use `src/token_utils.generate_strong_token()` if you need to mint tokens manually in scripts or migrations.

## References:

- https://www.trychroma.com/research/evaluating-chunking
- https://www.trychroma.com/research/
