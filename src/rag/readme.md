# Medha

Medha is a FastAPI service that provisions per-user collections inside a running ChromaDB instance. It exposes endpoints for user signup, document ingestion, folder-based bulk indexing, and retrieval over the stored chunks.

## What Ships In This Repo

- `run_medha.py`: FastAPI application that wires the `v1` router.
- `run_medha.sh`: helper wrapper around `uv run uvicorn run_medha:app` with sensible host/port defaults.
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
cd /Users/ash/Documents/work/medha
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
uv run uvicorn run_medha:app --host 127.0.0.1 --port 8051 --reload
```

Or rely on the helper script (defaults to `0.0.0.0:8051` so you can hit it from other devices on the network):

```bash
./run_medha.sh [--host 0.0.0.0] [--port 8051]
```

Hit `GET /health` to verify readiness.

## API Overview

All routes live under `src/routers/v1.py`:

- `GET /health` — basic readiness probe.
- `POST /v1/signup` — register a user. Creates a Chroma collection named after the generated bearer token and stores the record. Body:
  ```json
  {
    "username": "demo",
    "password": "plaintext-only-for-local-testing",
    "scopes": ["user:query"]
  }
  ```

  Response includes `bearer_token`.
- `POST /v1/add_documents` — manually add raw text chunks to the caller's collection.
  ```json
  {
    "token": "bearer token from signup",
    "documents": ["first chunk", "second chunk"]
  }
  ```
- `POST /v1/query_documents` — run similarity search with the provided `query`. Uses the caller's collection and returns whatever Chroma returns (documents, metadatas, ids).
- `POST /v1/ingest_documents` — recursively walk a folder, chunk supported files (`.pdf`, `.txt`, `.md`), and upsert every chunk plus metadata into the caller's collection. Body contains `token` and `folder_path`.
- `POST /v1/collections` — fetch stored documents/metadatas for a collection (requires the token belonging to that collection).

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
  -d '{"token":"'"$MEDHA_TOKEN"'","scope":"public"}'
```

By default, Medha indexes the repository root containing this RAG service. Pass
`repository_path` only when you intentionally want to index another checkout.

## User Store

`data/users.json` holds all user entries. Each record contains:

```json
{
  "username": "alice",
  "password": "alice",
  "scopes": ["user:query"],
  "token": "randomly generated bearer token",
  "collection_name": "token-matched collection"
}
```

Update or delete entries in this file to rotate credentials. Tokens are currently stored in plaintext and scoped entirely by their Chroma collection.

## Development

- `uv run pytest` — run the Python test suite (note: legacy tests still target the previous HTTP handler and will need adjustments to reflect the new FastAPI router).
- `uv run uvicorn run_medha:app --reload` — recommended during development for auto-reload.

Use `src/token_utils.generate_strong_token()` if you need to mint tokens manually in scripts or migrations.

## References:

- https://www.trychroma.com/research/evaluating-chunking
- https://www.trychroma.com/research/
