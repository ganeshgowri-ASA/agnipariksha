"""Compatibility shim — the SCPI router moved to ``backend/api/scpi_routes.py``.

Older imports (``from backend.scpi_router import router``) keep working
by re-exporting from the new canonical location. New code should import
directly from ``backend.api.scpi_routes``.

The Basic Check energization gate (``_enforce_basic_check_gate``) is also
re-exported here so older callers keep resolving, including any unit-test
patch target ``backend.scpi_router.get_settings`` carried over from earlier
revisions of the live-psu-gate work.
"""
from __future__ import annotations

try:
    from .api.scpi_routes import (  # noqa: F401  re-exported for backwards compat
        DiagResponse,
        IdnResponse,
        QueryResponse,
        TransportInfo,
        _enforce_basic_check_gate,
        get_diag,
        get_idn,
        get_query,
        get_settings,
        get_transport,
        router,
    )
except ImportError:  # pragma: no cover - script-mode fallback
    from api.scpi_routes import (  # type: ignore[no-redef]
        DiagResponse,
        IdnResponse,
        QueryResponse,
        TransportInfo,
        _enforce_basic_check_gate,
        get_diag,
        get_idn,
        get_query,
        get_settings,
        get_transport,
        router,
    )


__all__ = [
    "DiagResponse",
    "IdnResponse",
    "QueryResponse",
    "TransportInfo",
    "_enforce_basic_check_gate",
    "get_diag",
    "get_idn",
    "get_query",
    "get_settings",
    "get_transport",
    "router",
]
