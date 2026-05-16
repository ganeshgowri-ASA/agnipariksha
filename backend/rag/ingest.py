"""Ingest TBE PDFs into the Pinecone index.

Reads every ``*.pdf`` under ``data/tbe/`` (or a user-supplied dir),
extracts text per-page, chunks at ~512 tokens with 64-token overlap,
embeds with ``text-embedding-3-small``, and upserts to Pinecone.

CLI:
    python -m backend.rag.ingest                # uses default data/tbe
    python -m backend.rag.ingest --dir /tmp/pdfs
    python -m backend.rag.ingest --dry-run      # parse + chunk only
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, List, Optional

from . import CHUNK_OVERLAP, CHUNK_TOKENS
from .pinecone_client import PineconeClient, RagDependencyError

_LOG = logging.getLogger("agnipariksha.rag.ingest")

DEFAULT_PDF_DIR = Path("data/tbe")


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------
def _get_tokenizer():  # pragma: no cover - thin lazy loader
    try:
        import tiktoken  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RagDependencyError(
            "tiktoken not installed; add `tiktoken>=0.7` to requirements"
        ) from exc
    return tiktoken.get_encoding("cl100k_base")


def chunk_text(
    text: str,
    chunk_tokens: int = CHUNK_TOKENS,
    overlap: int = CHUNK_OVERLAP,
) -> List[str]:
    """Split ``text`` into ~``chunk_tokens`` chunks with ``overlap`` tokens
    of overlap between consecutive chunks. Uses cl100k_base (the encoding
    behind text-embedding-3-small).
    """
    if chunk_tokens <= 0:
        raise ValueError("chunk_tokens must be positive")
    if overlap < 0 or overlap >= chunk_tokens:
        raise ValueError("overlap must satisfy 0 <= overlap < chunk_tokens")
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned:
        return []
    enc = _get_tokenizer()
    tokens = enc.encode(cleaned)
    if len(tokens) <= chunk_tokens:
        return [cleaned]
    step = chunk_tokens - overlap
    out: List[str] = []
    for i in range(0, len(tokens), step):
        window = tokens[i : i + chunk_tokens]
        if not window:
            break
        out.append(enc.decode(window))
        if i + chunk_tokens >= len(tokens):
            break
    return out


# ---------------------------------------------------------------------------
# PDF reading
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class PdfPage:
    source: str  # filename
    page: int    # 1-indexed
    text: str


def _read_pdf_pages(path: Path) -> Iterator[PdfPage]:
    try:
        from pypdf import PdfReader  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RagDependencyError(
            "pypdf not installed; add `pypdf>=4` to requirements"
        ) from exc
    reader = PdfReader(str(path))
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception as exc:  # noqa: BLE001 — corrupt page, keep going
            _LOG.warning("page %d of %s failed to extract: %s", i, path.name, exc)
            text = ""
        if text.strip():
            yield PdfPage(source=path.name, page=i, text=text)


# ---------------------------------------------------------------------------
# Vector building
# ---------------------------------------------------------------------------
def _vector_id(source: str, page: int, chunk_idx: int, text: str) -> str:
    """Stable, content-addressed id. Re-ingesting the same file yields the
    same ids so upsert acts as an idempotent update."""
    h = hashlib.sha1(f"{source}|{page}|{chunk_idx}|{text}".encode("utf-8")).hexdigest()[:16]
    return f"{Path(source).stem}-p{page}-c{chunk_idx}-{h}"


def build_vectors_for_pdf(
    path: Path,
    client: PineconeClient,
    chunk_tokens: int = CHUNK_TOKENS,
    overlap: int = CHUNK_OVERLAP,
) -> List[dict]:
    """Read ``path``, chunk every page, embed, return Pinecone vector dicts."""
    all_chunks: List[tuple[PdfPage, int, str]] = []
    for page in _read_pdf_pages(path):
        for ci, chunk in enumerate(chunk_text(page.text, chunk_tokens, overlap)):
            all_chunks.append((page, ci, chunk))
    if not all_chunks:
        return []
    texts = [c[2] for c in all_chunks]
    embeddings = client.embed(texts)
    vectors: List[dict] = []
    for (page, ci, chunk), emb in zip(all_chunks, embeddings):
        vectors.append({
            "id": _vector_id(page.source, page.page, ci, chunk),
            "values": emb,
            "metadata": {
                "source": page.source,
                "page": page.page,
                "chunk": ci,
                "text": chunk,
            },
        })
    return vectors


# ---------------------------------------------------------------------------
# Top-level pipeline
# ---------------------------------------------------------------------------
@dataclass
class IngestReport:
    files: int = 0
    chunks: int = 0
    upserted: int = 0
    skipped: List[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.skipped is None:
            self.skipped = []


def ingest_directory(
    pdf_dir: Path = DEFAULT_PDF_DIR,
    client: Optional[PineconeClient] = None,
    dry_run: bool = False,
) -> IngestReport:
    """Ingest every PDF under ``pdf_dir`` into Pinecone."""
    if client is None:
        client = PineconeClient()
    if not pdf_dir.exists() or not pdf_dir.is_dir():
        raise FileNotFoundError(f"PDF directory not found: {pdf_dir}")
    pdfs = sorted(pdf_dir.glob("*.pdf"))
    report = IngestReport()
    if not pdfs:
        _LOG.warning("no PDFs found under %s", pdf_dir)
        return report
    if not dry_run:
        client.ensure_index()
    for path in pdfs:
        try:
            vectors = build_vectors_for_pdf(path, client)
        except Exception as exc:  # noqa: BLE001 — log + continue
            _LOG.error("failed to ingest %s: %s", path.name, exc)
            report.skipped.append(path.name)
            continue
        report.files += 1
        report.chunks += len(vectors)
        if dry_run:
            _LOG.info("[dry-run] %s → %d chunks", path.name, len(vectors))
            continue
        report.upserted += client.upsert(vectors)
        _LOG.info("ingested %s → %d vectors", path.name, len(vectors))
    return report


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Ingest TBE PDFs into Pinecone.")
    p.add_argument("--dir", type=Path, default=DEFAULT_PDF_DIR, help="PDF directory")
    p.add_argument("--dry-run", action="store_true", help="chunk only; skip Pinecone")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = _build_arg_parser().parse_args(list(argv) if argv is not None else None)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    try:
        report = ingest_directory(args.dir, dry_run=args.dry_run)
    except (FileNotFoundError, RagDependencyError) as exc:
        _LOG.error("%s", exc)
        return 2
    print(
        f"files={report.files} chunks={report.chunks} upserted={report.upserted} "
        f"skipped={len(report.skipped)}"
    )
    if report.skipped:
        print("Skipped:")
        for name in report.skipped:
            print(f"  - {name}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
