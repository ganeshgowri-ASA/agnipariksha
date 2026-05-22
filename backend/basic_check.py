"""Basic Check pass tracker — gates PSU energization on Module ID.

Operator runs the Basic Check sub-tab (lamp tower + manual readback) and,
once all preflight checks are green, the frontend POSTs to
``/api/basic-check/pass``. The backend remembers the Module ID for
``PASS_TTL_S`` seconds. Any later SCPI command that would energize the
PSU (``OUTP ON`` / ``VOLT`` / ``CURR`` set forms) MUST carry the same
``module_id`` and is refused with ``403 basic_check_required`` if the
pass is missing or stale.

The store is intentionally in-process and forgetting:
- Backend restart wipes the table — the operator must re-pass.
- No DB row means a server crash never resurrects a stale pass.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field


PASS_TTL_S = 60 * 60  # 60 minutes per the operator UX spec


@dataclass
class _PassRecord:
    module_id: str
    passed_at_monotonic: float
    wall_passed_at: datetime
    run_id: Optional[str] = None


class _PassStore:
    """Thread-safe in-process tracker. One entry per Module ID, last write wins."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._records: dict[str, _PassRecord] = {}

    def record_pass(self, module_id: str, run_id: Optional[str] = None) -> _PassRecord:
        rec = _PassRecord(
            module_id=module_id,
            passed_at_monotonic=time.monotonic(),
            wall_passed_at=datetime.now(timezone.utc),
            run_id=run_id,
        )
        with self._lock:
            self._records[module_id] = rec
        return rec

    def status(self, module_id: str) -> tuple[bool, int, Optional[_PassRecord]]:
        """Return ``(passed_within_ttl, age_seconds, record_or_none)``."""
        with self._lock:
            rec = self._records.get(module_id)
        if rec is None:
            return False, -1, None
        age = int(time.monotonic() - rec.passed_at_monotonic)
        return (age <= PASS_TTL_S), age, rec

    def clear(self) -> None:
        """Test-only: wipe all records."""
        with self._lock:
            self._records.clear()


_store = _PassStore()


def get_store() -> _PassStore:
    return _store


# ---------------------------------------------------------------------------
# Command classifier — anything that COULD raise the bus or close the relay.
# Query forms (ending in ``?``) read state and are always allowed.
# ---------------------------------------------------------------------------
_ENERGIZE_RE = re.compile(
    # Optional leading colon, optional SOUR(CE): prefix, then the energizing verb.
    r"^\s*:?\s*"
    r"(?:"
    r"OUTP(?:UT)?\s+(?:ON|1)\b"                  # OUTP ON / OUTPUT 1
    r"|(?:SOUR(?:CE)?:)?(?:VOLT(?:AGE)?|CURR(?:ENT)?)\b\s*(?!\?)"  # VOLT / CURR set
    r")",
    re.IGNORECASE,
)


def is_psu_energize_cmd(cmd: str) -> bool:
    """True iff ``cmd`` would energize the PSU (set V/I or close the output).

    Query forms (``VOLT?``, ``MEAS:CURR?``, ``OUTP?``) and read-only
    measurement commands (``MEAS:VOLT?``) return False — they cannot
    raise the bus.
    """
    if not cmd:
        return False
    stripped = cmd.strip()
    if not stripped or stripped.endswith("?"):
        return False
    return bool(_ENERGIZE_RE.match(stripped))


# ---------------------------------------------------------------------------
# HTTP router
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/api/basic-check", tags=["basic-check"])


class PassRequest(BaseModel):
    module_id: str = Field(..., min_length=1, max_length=128)
    run_id: Optional[str] = Field(default=None, max_length=128)


class StatusResponse(BaseModel):
    module_id: str
    passed: bool
    age_s: int
    ttl_s: int = PASS_TTL_S
    expires_in_s: Optional[int] = None
    passed_at: Optional[str] = None
    run_id: Optional[str] = None


def _build_status(module_id: str, passed: bool, age_s: int, rec: Optional[_PassRecord]) -> StatusResponse:
    return StatusResponse(
        module_id=module_id,
        passed=passed,
        age_s=max(age_s, 0) if rec else -1,
        expires_in_s=(PASS_TTL_S - age_s) if (rec and passed) else None,
        passed_at=rec.wall_passed_at.isoformat() if rec else None,
        run_id=rec.run_id if rec else None,
    )


@router.post("/pass", response_model=StatusResponse)
def post_pass(req: PassRequest) -> StatusResponse:
    """Record a Basic Check pass for ``module_id``. Idempotent — last write wins."""
    rec = _store.record_pass(req.module_id, req.run_id)
    return _build_status(req.module_id, passed=True, age_s=0, rec=rec)


@router.get("/status", response_model=StatusResponse)
def get_status(module_id: str = Query(..., min_length=1, max_length=128)) -> StatusResponse:
    """Probe the latest Basic Check status for ``module_id``."""
    passed, age, rec = _store.status(module_id)
    return _build_status(module_id, passed=passed, age_s=age, rec=rec)


# ---------------------------------------------------------------------------
# Live-mode toggle — read by the SCPI write path. Default is DISABLED so the
# CI test that boots the app cannot accidentally drive live hardware. The
# operator opts in via the Settings panel which POSTs to this endpoint.
# ---------------------------------------------------------------------------
LIVE_MODE_ENABLED: bool = False

settings_router = APIRouter(prefix="/api/settings", tags=["settings"])


class LiveModeBody(BaseModel):
    enabled: bool


class LiveModeResponse(BaseModel):
    enabled: bool


@settings_router.post("/live-mode", response_model=LiveModeResponse)
def post_live_mode(body: LiveModeBody) -> LiveModeResponse:
    global LIVE_MODE_ENABLED
    LIVE_MODE_ENABLED = bool(body.enabled)
    return LiveModeResponse(enabled=LIVE_MODE_ENABLED)


@settings_router.get("/live-mode", response_model=LiveModeResponse)
def get_live_mode() -> LiveModeResponse:
    return LiveModeResponse(enabled=LIVE_MODE_ENABLED)
