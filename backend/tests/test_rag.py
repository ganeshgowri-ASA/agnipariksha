"""Tests for backend/rag/ — chunking, client wrapper, and HTTP router.

External deps (pinecone, openai, pypdf, tiktoken) are mocked end-to-end so
this suite runs cleanly without API keys or installed extras.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

try:
    from backend.main import app
    from backend.rag import INDEX_NAME, pinecone_client, router as rag_router_mod
    from backend.rag.ingest import chunk_text
    from backend.rag.pinecone_client import (
        PineconeClient,
        RagConfigError,
        RagDependencyError,
        reset_default_client,
    )
    _MOD = "backend.rag"
except ImportError:  # pragma: no cover - script-mode fallback
    from main import app  # type: ignore[no-redef]
    from rag import INDEX_NAME, pinecone_client, router as rag_router_mod  # type: ignore[no-redef]
    from rag.ingest import chunk_text  # type: ignore[no-redef]
    from rag.pinecone_client import (  # type: ignore[no-redef]
        PineconeClient,
        RagConfigError,
        RagDependencyError,
        reset_default_client,
    )
    _MOD = "rag"


# ---------------------------------------------------------------------------
# Stub tiktoken so the chunker has a deterministic, dep-free tokenizer.
# ---------------------------------------------------------------------------
class _FakeEncoding:
    """Whitespace-based stand-in for cl100k_base — one token per word."""

    def encode(self, text: str):
        return text.split()

    def decode(self, tokens) -> str:
        return " ".join(tokens)


@pytest.fixture(autouse=True)
def _stub_tiktoken(monkeypatch):
    fake = types.ModuleType("tiktoken")
    fake.get_encoding = lambda _name: _FakeEncoding()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "tiktoken", fake)
    yield


@pytest.fixture(autouse=True)
def _reset_singletons():
    reset_default_client()
    yield
    reset_default_client()


# ---------------------------------------------------------------------------
# chunk_text
# ---------------------------------------------------------------------------
def test_chunk_text_short_returns_single_chunk():
    text = "alpha beta gamma"
    chunks = chunk_text(text, chunk_tokens=10, overlap=2)
    assert chunks == ["alpha beta gamma"]


def test_chunk_text_long_respects_size_and_overlap():
    words = [f"w{i}" for i in range(50)]
    text = " ".join(words)
    chunks = chunk_text(text, chunk_tokens=20, overlap=5)
    assert len(chunks) > 1
    # First chunk has 20 tokens.
    assert len(chunks[0].split()) == 20
    # Overlap: last 5 tokens of chunk N == first 5 of chunk N+1.
    a = chunks[0].split()[-5:]
    b = chunks[1].split()[:5]
    assert a == b


def test_chunk_text_empty_returns_empty():
    assert chunk_text("   \n\t  ") == []


def test_chunk_text_rejects_bad_overlap():
    with pytest.raises(ValueError):
        chunk_text("a b c", chunk_tokens=5, overlap=5)
    with pytest.raises(ValueError):
        chunk_text("a b c", chunk_tokens=0, overlap=0)


# ---------------------------------------------------------------------------
# PineconeClient — config + dependency errors
# ---------------------------------------------------------------------------
def test_pinecone_client_missing_api_key(monkeypatch):
    monkeypatch.delenv("PINECONE_API_KEY", raising=False)
    client = PineconeClient()
    with pytest.raises(RagConfigError):
        client.ensure_index()


def test_pinecone_client_missing_pinecone_package(monkeypatch):
    monkeypatch.setenv("PINECONE_API_KEY", "test-key")
    # Hide the pinecone module if (un)installed.
    monkeypatch.setitem(sys.modules, "pinecone", None)
    client = PineconeClient()
    with pytest.raises(RagDependencyError):
        client.ensure_index()


# ---------------------------------------------------------------------------
# PineconeClient.query — happy path with mocked deps
# ---------------------------------------------------------------------------
def _install_fake_pinecone(monkeypatch, match_payload):
    """Install a fake `pinecone` module that returns canned matches."""
    fake_index = MagicMock()
    fake_index.query.return_value = {"matches": match_payload}

    fake_pc = MagicMock()
    fake_pc.list_indexes.return_value = [{"name": INDEX_NAME}]
    fake_pc.Index.return_value = fake_index

    class _Pinecone:
        def __init__(self, **_kwargs):
            pass

        def __new__(cls, **_kwargs):
            return fake_pc

    fake_mod = types.ModuleType("pinecone")
    fake_mod.Pinecone = _Pinecone  # type: ignore[attr-defined]
    fake_mod.ServerlessSpec = MagicMock()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "pinecone", fake_mod)
    return fake_pc, fake_index


def _install_fake_openai(monkeypatch, embedding):
    fake_response = MagicMock()
    fake_response.data = [MagicMock(embedding=embedding)]

    fake_client = MagicMock()
    fake_client.embeddings.create.return_value = fake_response

    class _OpenAI:
        def __init__(self, *_a, **_kw):
            pass

        def __new__(cls, *_a, **_kw):
            return fake_client

    fake_mod = types.ModuleType("openai")
    fake_mod.OpenAI = _OpenAI  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "openai", fake_mod)
    return fake_client


def test_pinecone_client_query_returns_normalised_matches(monkeypatch):
    monkeypatch.setenv("PINECONE_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    _install_fake_pinecone(
        monkeypatch,
        match_payload=[
            {
                "id": "doc-p1-c0-abc",
                "score": 0.91,
                "metadata": {"text": "hello world", "source": "doc.pdf", "page": 1, "chunk": 0},
            },
        ],
    )
    _install_fake_openai(monkeypatch, embedding=[0.1] * 1536)
    client = PineconeClient()
    matches = client.query("what is TBE?", top_k=3)
    assert len(matches) == 1
    assert matches[0]["text"] == "hello world"
    assert matches[0]["source"] == "doc.pdf"
    assert matches[0]["page"] == 1
    assert matches[0]["score"] == pytest.approx(0.91)


# ---------------------------------------------------------------------------
# HTTP router
# ---------------------------------------------------------------------------
def test_rag_query_route_happy_path():
    """Router returns 200 with mocked client results."""
    fake_client = MagicMock(spec=PineconeClient)
    fake_client.query.return_value = [
        {
            "id": "doc-p1-c0",
            "score": 0.88,
            "text": "TBE deliverable bullet",
            "source": "tbe-spec.pdf",
            "page": 1,
            "chunk": 0,
        }
    ]
    with patch.object(rag_router_mod, "_get_client", return_value=fake_client):
        with TestClient(app) as c:
            r = c.post("/api/rag/query", json={"q": "What are TBE deliverables?", "top_k": 5})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["index"] == INDEX_NAME
    assert len(body["matches"]) == 1
    assert body["matches"][0]["text"] == "TBE deliverable bullet"
    assert body["matches"][0]["source"] == "tbe-spec.pdf"
    assert isinstance(body["elapsed_ms"], int)
    fake_client.query.assert_called_once_with("What are TBE deliverables?", top_k=5)


def test_rag_query_route_missing_key_returns_503():
    fake_client = MagicMock(spec=PineconeClient)
    fake_client.query.side_effect = RagConfigError("PINECONE_API_KEY environment variable is required")
    with patch.object(rag_router_mod, "_get_client", return_value=fake_client):
        with TestClient(app) as c:
            r = c.post("/api/rag/query", json={"q": "hi", "top_k": 3})
    assert r.status_code == 503
    body = r.json()
    assert body["detail"]["error"] == "rag_unavailable"
    assert "PINECONE_API_KEY" in body["detail"]["reason"]


def test_rag_query_route_dep_missing_returns_503():
    fake_client = MagicMock(spec=PineconeClient)
    fake_client.query.side_effect = RagDependencyError("pinecone package not installed")
    with patch.object(rag_router_mod, "_get_client", return_value=fake_client):
        with TestClient(app) as c:
            r = c.post("/api/rag/query", json={"q": "hi", "top_k": 3})
    assert r.status_code == 503
    body = r.json()
    assert body["detail"]["error"] == "rag_unavailable"


def test_rag_query_route_upstream_failure_returns_502():
    fake_client = MagicMock(spec=PineconeClient)
    fake_client.query.side_effect = RuntimeError("pinecone 500")
    with patch.object(rag_router_mod, "_get_client", return_value=fake_client):
        with TestClient(app) as c:
            r = c.post("/api/rag/query", json={"q": "hi", "top_k": 3})
    assert r.status_code == 502
    body = r.json()
    assert body["detail"]["error"] == "rag_upstream_error"
    assert "RuntimeError" in body["detail"]["reason"]


def test_rag_query_route_validates_input():
    with TestClient(app) as c:
        # empty q
        r = c.post("/api/rag/query", json={"q": "", "top_k": 5})
        assert r.status_code == 422
        # top_k out of bounds
        r = c.post("/api/rag/query", json={"q": "hi", "top_k": 0})
        assert r.status_code == 422
        r = c.post("/api/rag/query", json={"q": "hi", "top_k": 100})
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Ingest integration — single PDF stubbed end-to-end
# ---------------------------------------------------------------------------
def test_ingest_directory_dry_run_chunks_only(tmp_path, monkeypatch):
    """dry_run should chunk text via mocked PDF reader but never touch Pinecone."""
    # Drop a dummy file so the glob finds it; the PDF reader is mocked.
    (tmp_path / "spec.pdf").write_bytes(b"%PDF-1.4 stub")

    fake_page = types.SimpleNamespace()
    fake_page.extract_text = lambda: "alpha beta gamma " * 30  # ~90 fake tokens

    fake_reader = MagicMock()
    fake_reader.pages = [fake_page]

    fake_pypdf = types.ModuleType("pypdf")
    fake_pypdf.PdfReader = MagicMock(return_value=fake_reader)  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "pypdf", fake_pypdf)

    fake_client = MagicMock(spec=PineconeClient)
    fake_client.embed.return_value = [[0.0] * 4, [0.0] * 4, [0.0] * 4]

    try:
        from backend.rag.ingest import ingest_directory
    except ImportError:  # pragma: no cover
        from rag.ingest import ingest_directory  # type: ignore[no-redef]

    report = ingest_directory(tmp_path, client=fake_client, dry_run=True)
    assert report.files == 1
    assert report.chunks > 0
    assert report.upserted == 0
    # ensure_index / upsert must NOT be called in dry-run.
    fake_client.ensure_index.assert_not_called()
    fake_client.upsert.assert_not_called()


def test_ingest_directory_missing_dir_raises(tmp_path):
    try:
        from backend.rag.ingest import ingest_directory
    except ImportError:  # pragma: no cover
        from rag.ingest import ingest_directory  # type: ignore[no-redef]

    with pytest.raises(FileNotFoundError):
        ingest_directory(tmp_path / "does-not-exist")


def test_ingest_directory_no_pdfs_returns_empty_report(tmp_path):
    try:
        from backend.rag.ingest import ingest_directory
    except ImportError:  # pragma: no cover
        from rag.ingest import ingest_directory  # type: ignore[no-redef]

    fake_client = MagicMock(spec=PineconeClient)
    report = ingest_directory(tmp_path, client=fake_client)
    assert report.files == 0
    assert report.chunks == 0
    assert report.upserted == 0
    # Empty dir → short-circuit before touching Pinecone.
    fake_client.ensure_index.assert_not_called()
    fake_client.upsert.assert_not_called()
