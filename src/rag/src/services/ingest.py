import hashlib
from pathlib import Path

from pypdf import PdfReader

SUPPORTED_EXTENSIONS = {".pdf", ".txt", ".md"}
REPOSITORY_EXTENSIONS = {
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".mdx",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".xml",
    ".yaml",
    ".yml",
}
REPOSITORY_IGNORED_DIRS = {
    ".docusaurus",
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    ".venv_r1",
    "__pycache__",
    "build",
    "data",
    "dist",
    "install",
    "log",
    "node_modules",
    "tasks",
}
REPOSITORY_IGNORED_FILES = {
    ".DS_Store",
    ".env",
    "package-lock.json",
    "uv.lock",
}
DEFAULT_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
MAX_REPOSITORY_FILE_BYTES = 200_000
FOLDER_SCOPE_MAP = {
    "public": "public",
    "private": "private",
    "private_safe": "private_safe",
    "secret": "secret"
}

class IngestionService:
    def __init__(self):
        pass

    def iter_files(self, folder_path: str):
        root = Path(folder_path)
        for path in root.rglob("*"):
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS:
                yield path

    def iter_repository_files(self, repository_path: str | None = None):
        root = Path(repository_path).resolve() if repository_path else DEFAULT_REPOSITORY_ROOT
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if any(part in REPOSITORY_IGNORED_DIRS for part in path.relative_to(root).parts):
                continue
            if path.name in REPOSITORY_IGNORED_FILES:
                continue
            if path.suffix.lower() not in REPOSITORY_EXTENSIONS:
                continue
            if path.stat().st_size > MAX_REPOSITORY_FILE_BYTES:
                continue
            yield path

    def compute_file_hash(self, file_path: Path) -> str:
        hasher = hashlib.sha256()
        with file_path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                hasher.update(chunk)
        return hasher.hexdigest()

    def partition_and_chunk_file(
        self,
        file_path: Path,
        max_characters: int = 1000,
        overlap: int = 100,
    ):
        suffix = file_path.suffix.lower()
        if suffix == ".pdf":
            reader = PdfReader(str(file_path))
            text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
        else:
            text = file_path.read_text(encoding="utf-8", errors="ignore")

        return self.chunk_text(text, max_characters=max_characters, overlap=overlap)

    def chunk_text(
        self,
        text: str,
        max_characters: int = 1600,
        overlap: int = 200,
    ) -> list[str]:
        text = text.strip()
        if not text:
            return []

        chunks = []
        start = 0
        while start < len(text):
            end = min(start + max_characters, len(text))
            chunks.append(text[start:end].strip())
            if end == len(text):
                break
            start = max(0, end - overlap)
        return [chunk for chunk in chunks if chunk]

    def build_file_records(self, root: Path, file_path: Path):
        relative_path = str(file_path.resolve().relative_to(root))
        suffix = file_path.suffix.lower()
        file_hash = self.compute_file_hash(file_path)

        ids = []
        documents = []
        metadatas = []

        chunks = self.partition_and_chunk_file(file_path)
        total_chunks = len(chunks)
        file_path = Path(file_path)
        folder = file_path.parent
        source = file_path.parent.name
        scope = source
        for i, text in enumerate(chunks):
            text = text.strip()
            if not text:
                continue

            ids.append(f"{relative_path}::chunk{i}")
            documents.append(text)
            metadatas.append(
                {
                    "document_id": relative_path,
                    "relative_path": relative_path,
                    "scope": scope,
                    "filename": file_path.name,
                    "file_type": suffix.lstrip("."),
                    "file_hash": file_hash,
                    "chunk_index": i,
                    "total_chunks": total_chunks,
                }
            )

        return relative_path, file_hash, ids, documents, metadatas

    def build_repository_file_records(self, root: Path, file_path: Path, scope: str):
        relative_path = str(file_path.resolve().relative_to(root))
        suffix = file_path.suffix.lower()
        file_hash = self.compute_file_hash(file_path)
        text = file_path.read_text(encoding="utf-8", errors="ignore")
        chunks = self.chunk_text(text)
        total_chunks = len(chunks)

        ids = []
        documents = []
        metadatas = []

        for i, chunk in enumerate(chunks):
            ids.append(f"repo::{relative_path}::chunk{i}")
            documents.append(chunk)
            metadatas.append(
                {
                    "document_id": f"repo::{relative_path}",
                    "relative_path": relative_path,
                    "scope": scope,
                    "source_kind": "repository",
                    "filename": file_path.name,
                    "file_type": suffix.lstrip("."),
                    "file_hash": file_hash,
                    "chunk_index": i,
                    "total_chunks": total_chunks,
                }
            )

        return f"repo::{relative_path}", file_hash, ids, documents, metadatas

    def should_skip_file(
        self,
        chroma_service,
        collection_name: str,
        document_id: str,
        file_hash: str,
    ) -> bool:
        existing_metadatas = chroma_service.get_document_metadatas(
            collection_name=collection_name,
            document_id=document_id,
        )

        if not existing_metadatas:
            return False

        existing_hashes = {
            md.get("file_hash")
            for md in existing_metadatas
            if isinstance(md, dict) and md.get("file_hash")
        }

        return len(existing_hashes) == 1 and file_hash in existing_hashes

    def ingest_folder(self, folder_path: str, collection_name: str, scopes: list[str], chroma_service):
        root = Path(folder_path).resolve()
        indexed_files = 0
        indexed_chunks = 0
        skipped_files = 0
        failed_files = 0

        allowed_scopes = set(scopes)

        for file_path in self.iter_files(str(root)):
            try:
                file_path = Path(file_path).resolve()

                rel_path = file_path.relative_to(root)
                parts = rel_path.parts

                if not parts:
                    skipped_files += 1
                    continue

                top_folder = parts[0]
                print('tf:',top_folder)
                file_scope = FOLDER_SCOPE_MAP.get(top_folder)

                # Skip files in folders that do not map to a known scope
                if file_scope is None:
                    skipped_files += 1
                    print(f"{file_scope} skipping, unknown scope")
                    continue

                # Skip files whose scope is not allowed for this ingestion run
                if file_scope not in allowed_scopes:
                    skipped_files += 1
                    print(f"{file_scope} skipping, not allowed scope")
                    continue

                document_id, file_hash, ids, documents, metadatas = (
                    self.build_file_records(root, file_path)
                )

                if not documents:
                    continue

                if self.should_skip_file(
                    chroma_service=chroma_service,
                    collection_name=collection_name,
                    document_id=document_id,
                    file_hash=file_hash,
                ):
                    skipped_files += 1
                    continue

                # Clean refresh for changed files
                chroma_service.delete_by_document_id(
                    collection_name=collection_name,
                    document_id=document_id,
                )

                chroma_service.upsert_documents(
                    collection_name=collection_name,
                    ids=ids,
                    documents=documents,
                    metadatas=metadatas,
                )

                indexed_files += 1
                indexed_chunks += len(documents)

            except Exception as e:
                print(f"Skipping {file_path}: {e}")
                failed_files += 1
                continue

        return {
            "status": "ok",
            "folder": str(root),
            "collection_name": collection_name,
            "indexed_files": indexed_files,
            "indexed_chunks": indexed_chunks,
            "skipped_files": skipped_files,
            "failed_files": failed_files,
        }

    def ingest_repository(
        self,
        collection_name: str,
        scopes: list[str],
        chroma_service,
        repository_path: str | None = None,
        scope: str = "public",
    ):
        root = Path(repository_path).resolve() if repository_path else DEFAULT_REPOSITORY_ROOT

        if scope not in scopes:
            return {
                "status": "error",
                "detail": "scope_not_allowed",
                "repository": str(root),
                "scope": scope,
                "collection_name": collection_name,
            }

        indexed_files = 0
        indexed_chunks = 0
        skipped_files = 0
        failed_files = 0

        for file_path in self.iter_repository_files(str(root)):
            try:
                document_id, file_hash, ids, documents, metadatas = (
                    self.build_repository_file_records(root, file_path, scope)
                )

                if not documents:
                    skipped_files += 1
                    continue

                if self.should_skip_file(
                    chroma_service=chroma_service,
                    collection_name=collection_name,
                    document_id=document_id,
                    file_hash=file_hash,
                ):
                    skipped_files += 1
                    continue

                chroma_service.delete_by_document_id(
                    collection_name=collection_name,
                    document_id=document_id,
                )

                chroma_service.upsert_documents(
                    collection_name=collection_name,
                    ids=ids,
                    documents=documents,
                    metadatas=metadatas,
                )

                indexed_files += 1
                indexed_chunks += len(documents)
            except Exception as e:
                print(f"Skipping repository file {file_path}: {e}")
                failed_files += 1
                continue

        return {
            "status": "ok",
            "repository": str(root),
            "scope": scope,
            "collection_name": collection_name,
            "indexed_files": indexed_files,
            "indexed_chunks": indexed_chunks,
            "skipped_files": skipped_files,
            "failed_files": failed_files,
        }


ingest_service = IngestionService()


def get_ingestion_service() -> IngestionService:
    return ingest_service
