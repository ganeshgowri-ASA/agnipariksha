"""V2-S2 persistence layer.

`models`     — SQLModel ORM definitions (CSV remains source of truth; DB mirrors).
`session`    — engine + per-call session factory; SQLite by default.
`backfill`   — idempotent CSV → TestRun importer used at startup.
"""
from __future__ import annotations

from .models import (  # noqa: F401
    AIThread,
    AuditLog,
    BarcodeScan,
    ComplaintTicket,
    Equipment,
    MaintenanceTicket,
    Module,
    Operator,
    Report,
    Schedule,
    SparePart,
    TelemetrySample,
    TestRun,
)
from .session import (  # noqa: F401
    DEFAULT_SQLITE_URL,
    create_engine_from_url,
    get_engine,
    get_session,
    init_db,
    reset_engine,
)

__all__ = [
    "AIThread",
    "AuditLog",
    "BarcodeScan",
    "ComplaintTicket",
    "Equipment",
    "MaintenanceTicket",
    "Module",
    "Operator",
    "Report",
    "Schedule",
    "SparePart",
    "TelemetrySample",
    "TestRun",
    "DEFAULT_SQLITE_URL",
    "create_engine_from_url",
    "get_engine",
    "get_session",
    "init_db",
    "reset_engine",
]
