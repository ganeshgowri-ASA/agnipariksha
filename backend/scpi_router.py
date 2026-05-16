"""Compatibility shim — the SCPI router moved to ``backend/api/scpi_routes.py``.

Older imports (``from backend.scpi_router import router``) keep working
by re-exporting from the new canonical location. New code should import
directly from ``backend.api.scpi_routes``.
"""
from __future__ import annotations

try:
    from .api.scpi_routes import (  # noqa: F401  re-exported for backwards compat
        DiagResponse,
        IdnResponse,
        QueryResponse,
        TransportInfo,
        get_diag,
        get_idn,
        get_query,
        get_transport,
        router,
    )
except ImportError:  # pragma: no cover - script-mode fallback
    from api.scpi_routes import (  # type: ignore[no-redef]
        DiagResponse,
        IdnResponse,
        QueryResponse,
        TransportInfo,
        get_diag,
        get_idn,
        get_query,
        get_transport,
        router,
    )


__all__ = [
    "DiagResponse",
    "IdnResponse",
    "QueryResponse",
    "TransportInfo",
    "get_diag",
    "get_idn",
    "get_query",
    "get_transport",
    "router",
]
