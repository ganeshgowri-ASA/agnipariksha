"""FastAPI router exposing ``POST /api/rag/query`` for the TBE index.

Body: ``{"q": "...", "top_k": 5}`` → ``{"matches": [...], "elapsed_ms": int}``.

Failure modes
-------------
- Missing ``PINECONE_API_KEY``    → 503 ``rag_unavailable`` (config error)
- Pinecone / OpenAI deps missing  → 503 ``rag_unavailable`` (dep error)
- Pinecone / OpenAI runtime error → 502 ``rag_upstream_error``
"""
from __future__ import annotations

import logging
import time
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import INDEX_NAME
from .pinecone_client import (
    PineconeClient,
    RagConfigError,
    RagDependencyError,
    get_default_client,
)

_LOG = logging.getLogger("agnipariksha.rag.router")

router = APIRouter(prefix="/api/rag", tags=["rag"])


class QueryRequest(BaseModel):
    q: str = Field(..., min_length=1, max_length=4000, description="Natural-language query")
    top_k: int = Field(5, ge=1, le=25, description="Number of matches to return")


class Match(BaseModel):
    id: Optional[str]
    score: float
    text: str
    source: str
    page: Optional[int] = None
    chunk: Optional[int] = None


class QueryResponse(BaseModel):
    matches: List[Match]
    elapsed_ms: int
    index: str


def _get_client() -> PineconeClient:
    """Indirection that tests can monkeypatch."""
    return get_default_client()


@router.post("/query", response_model=QueryResponse)
async def query_rag(body: QueryRequest) -> QueryResponse:
    t0 = time.monotonic()
    try:
        client = _get_client()
        matches = client.query(body.q, top_k=body.top_k)
    except (RagConfigError, RagDependencyError) as exc:
        _LOG.warning("RAG unavailable: %s", exc)
        raise HTTPException(
            status_code=503,
            detail={"error": "rag_unavailable", "reason": str(exc)},
        )
    except Exception as exc:  # noqa: BLE001 — surface upstream failures
        _LOG.exception("RAG upstream error")
        raise HTTPException(
            status_code=502,
            detail={"error": "rag_upstream_error", "reason": f"{type(exc).__name__}: {exc}"},
        )
    return QueryResponse(
        matches=[Match(**m) for m in matches],
        elapsed_ms=int((time.monotonic() - t0) * 1000),
        index=INDEX_NAME,
    )
