from pathlib import Path

from src import vector_index


def test_extra_source_documents_reads_external_text_files(monkeypatch, tmp_path: Path):
    source_root = tmp_path / "external-notes"
    shared_dir = source_root / "shared"
    private_dir = source_root / "private"
    shared_dir.mkdir(parents=True)
    private_dir.mkdir(parents=True)

    (shared_dir / "overview.md").write_text("# Hello\nMedha external note\n", encoding="utf-8")
    (private_dir / "todo.txt").write_text("private text source", encoding="utf-8")

    monkeypatch.setenv("MEDHA_SOURCE_DIRS", str(source_root))

    documents = vector_index.external_source_documents()

    assert len(documents) == 2
    assert {document["collection"] for document in documents} == {"shared", "private"}
    assert {document["title"] for document in documents} == {"Overview", "Todo"}
    assert all("external" in document["tags"] for document in documents)
    assert all(str(source_root) in document["source_path"] for document in documents)


def test_extra_source_documents_reads_pdf_when_enabled(monkeypatch, tmp_path: Path):
    source_root = tmp_path / "pdf-notes"
    source_root.mkdir()
    pdf_path = source_root / "paper.pdf"
    pdf_path.write_bytes(b"%PDF-pretend")

    monkeypatch.setenv("MEDHA_SOURCE_DIRS", str(source_root))
    monkeypatch.setattr(vector_index, "read_pdf_content", lambda path: "pdf body")

    documents = vector_index.external_source_documents()

    assert len(documents) == 1
    assert documents[0]["title"] == "Paper"
    assert documents[0]["content"] == "pdf body"
    assert "pdf" in documents[0]["tags"]


def test_source_documents_include_external_sources(monkeypatch, tmp_path: Path):
    source_root = tmp_path / "external"
    nested_dir = source_root / "shared"
    nested_dir.mkdir(parents=True)
    (nested_dir / "notes.md").write_text("external body", encoding="utf-8")

    monkeypatch.setenv("MEDHA_SOURCE_DIRS", str(source_root))
    monkeypatch.setattr(vector_index, "load_document_payload", lambda: [])
    monkeypatch.setattr(vector_index, "load_markdown_documents", lambda markdown_root=None: [])

    documents = vector_index.source_documents()

    assert len(documents) == 1
    assert documents[0].page_content == "external body"
    assert documents[0].metadata["collection"] == "shared"
    assert str(source_root) in documents[0].metadata["source_path"]
