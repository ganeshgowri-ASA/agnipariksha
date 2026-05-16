"""Thin Pinecone + OpenAI-embedding wrapper for the TBE RAG index.

The third-party deps (``pinecone``, ``openai``) are imported lazily so the
module can be imported in environments where they are not installed
(e.g. CI without RAG extras). The first call to a method that needs them
will raise a clear ``RagDependencyError`` if they are absent.

API keys
--------
- ``PINECONE_API_KEY``  — required for any Pinecone call.
- ``OPENAI_API_KEY``    — required for embedding calls.

Never accept these as constructor args from request bodies; always read
from env / settings.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Iterable, List, Optional, Sequence

from . import EMBED_DIMS, EMBED_MODEL, INDEX_NAME

_LOG = logging.getLogger("agnipariksha.rag")


class RagDependencyError(RuntimeError):
    """Raised when an optional dep (pinecone / openai) is missing at call time."""


class RagConfigError(RuntimeError):
    """Raised when required configuration (e.g. PINECONE_API_KEY) is missing."""


def _require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        raise RagConfigError(f"{name} environment variable is required")
    return val


def _load_pinecone() -> Any:
    try:
        import pinecone  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RagDependencyError(
            "pinecone package not installed; add `pinecone>=4` to requirements"
        ) from exc
    return pinecone


def _load_openai() -> Any:
    try:
        from openai import OpenAI  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RagDependencyError(
            "openai package not installed; add `openai>=1.30` to requirements"
        ) from exc
    return OpenAI


class PineconeClient:
    """Lazy wrapper around a Pinecone index + OpenAI embeddings client."""

    def __init__(
        self,
        index_name: str = INDEX_NAME,
        embed_model: str = EMBED_MODEL,
        embed_dims: int = EMBED_DIMS,
        cloud: str = "aws",
        region: str = "us-east-1",
    ) -> None:
        self.index_name = index_name
        self.embed_model = embed_model
        self.embed_dims = embed_dims
        self.cloud = cloud
        self.region = region
        self._pc: Any = None
        self._index: Any = None
        self._openai: Any = None

    # ------------------------------------------------------------------
    # Pinecone
    # ------------------------------------------------------------------
    def _pinecone(self) -> Any:
        if self._pc is not None:
            return self._pc
        api_key = _require_env("PINECONE_API_KEY")
        pinecone = _load_pinecone()
        # pinecone>=4 uses Pinecone class; pinecone<4 used module-level init.
        Pinecone = getattr(pinecone, "Pinecone", None)
        if Pinecone is None:
            raise RagDependencyError(
                "pinecone>=4 required (Pinecone class missing); "
                "uninstall the legacy `pinecone-client` package"
            )
        self._pc = Pinecone(api_key=api_key)
        return self._pc

    def ensure_index(self) -> None:
        """Create the index if it does not already exist. Idempotent."""
        pc = self._pinecone()
        existing = {i["name"] for i in pc.list_indexes()}
        if self.index_name in existing:
            return
        pinecone = _load_pinecone()
        ServerlessSpec = getattr(pinecone, "ServerlessSpec", None)
        if ServerlessSpec is None:
            raise RagDependencyError("pinecone.ServerlessSpec missing — upgrade pinecone>=4")
        pc.create_index(
            name=self.index_name,
            dimension=self.embed_dims,
            metric="cosine",
            spec=ServerlessSpec(cloud=self.cloud, region=self.region),
        )
        _LOG.info("created Pinecone index %s (%d dims)", self.index_name, self.embed_dims)

    def index(self) -> Any:
        if self._index is None:
            self._index = self._pinecone().Index(self.index_name)
        return self._index

    # ------------------------------------------------------------------
    # OpenAI embeddings
    # ------------------------------------------------------------------
    def _openai_client(self) -> Any:
        if self._openai is not None:
            return self._openai
        _require_env("OPENAI_API_KEY")
        OpenAI = _load_openai()
        self._openai = OpenAI()
        return self._openai

    def embed(self, texts: Sequence[str]) -> List[List[float]]:
        if not texts:
            return []
        client = self._openai_client()
        resp = client.embeddings.create(model=self.embed_model, input=list(texts))
        return [d.embedding for d in resp.data]

    # ------------------------------------------------------------------
    # Index ops
    # ------------------------------------------------------------------
    def upsert(self, vectors: Iterable[dict]) -> int:
        """Upsert pre-embedded vectors. Returns count upserted."""
        idx = self.index()
        vecs = list(vectors)
        if not vecs:
            return 0
        # Pinecone allows up to 100 vectors per upsert request; batch.
        BATCH = 100
        total = 0
        for i in range(0, len(vecs), BATCH):
            batch = vecs[i : i + BATCH]
            idx.upsert(vectors=batch)
            total += len(batch)
        return total

    def query(self, q: str, top_k: int = 5) -> List[dict]:
        """Embed ``q`` and return top_k matches as plain dicts."""
        if top_k <= 0:
            return []
        embedding = self.embed([q])[0]
        result = self.index().query(
            vector=embedding,
            top_k=top_k,
            include_metadata=True,
        )
        # Pinecone responses expose a ``matches`` attr or key depending on
        # SDK version; normalise to dicts.
        matches = getattr(result, "matches", None)
        if matches is None and isinstance(result, dict):
            matches = result.get("matches", [])
        out: List[dict] = []
        for m in matches or []:
            md = getattr(m, "metadata", None) or (m.get("metadata") if isinstance(m, dict) else {}) or {}
            out.append({
                "id": getattr(m, "id", None) or (m.get("id") if isinstance(m, dict) else None),
                "score": float(getattr(m, "score", None) or (m.get("score") if isinstance(m, dict) else 0.0) or 0.0),
                "text": md.get("text", ""),
                "source": md.get("source", ""),
                "page": md.get("page"),
                "chunk": md.get("chunk"),
            })
        return out


_DEFAULT: Optional[PineconeClient] = None


def get_default_client() -> PineconeClient:
    """Process-wide singleton — convenient for the FastAPI router."""
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = PineconeClient()
    return _DEFAULT


def reset_default_client() -> None:
    """Drop the cached singleton; used in tests."""
    global _DEFAULT
    _DEFAULT = None
