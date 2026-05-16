"""Pinecone RAG pipeline for TBE (Technical Bid Engineering) deliverables.

Ingests PDFs from ``data/tbe/`` into a Pinecone index named
``agnipariksha-tbe`` (1536 dims, cosine) using ``text-embedding-3-small``.

Public surface:
- ``PineconeClient`` — thin wrapper that lazy-loads the pinecone SDK.
- ``chunk_text`` / ``ingest_pdf`` — chunking + ingestion helpers.
- ``router`` — FastAPI router exposing ``POST /api/rag/query``.

External keys are read from env (``PINECONE_API_KEY``, ``OPENAI_API_KEY``);
never hardcode them.
"""
from __future__ import annotations

INDEX_NAME = "agnipariksha-tbe"
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIMS = 1536
CHUNK_TOKENS = 512
CHUNK_OVERLAP = 64

__all__ = [
    "INDEX_NAME",
    "EMBED_MODEL",
    "EMBED_DIMS",
    "CHUNK_TOKENS",
    "CHUNK_OVERLAP",
]
