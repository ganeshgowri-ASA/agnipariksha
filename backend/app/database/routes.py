"""FastAPI router for /api/settings/database/*.

Endpoints:
    GET    /api/settings/database              — current setting + supported backends
    POST   /api/settings/database/test         — probe a URL (latency + server_version)
    POST   /api/settings/database/save         — persist DSN (Fernet-encrypted)
    POST   /api/settings/database/switch       — alembic upgrade + atomic data copy
                                                 + swap process DATABASE_URL on success
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .connectors import list_backends, migrate_and_switch, test_connection
from .store import load_settings, save_settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings/database", tags=["database"])


# ---- request / response models -------------------------------------------
class TestRequest(BaseModel):
    url: str = Field(..., description="SQLAlchemy URL")


class SaveRequest(BaseModel):
    backend: str
    label: str = "Saved connection"
    url: str
    skip_test: bool = False


class SwitchRequest(BaseModel):
    url: str
    label: str = "Saved connection"
    backend: str = "sqlite"
    dry_run: bool = False


# ---- helpers --------------------------------------------------------------
def _redact(url: str) -> str:
    """Hide the password segment so we never echo secrets to the client.
    Pattern: ``scheme://user:PASS@host:port/db`` → ``scheme://user:***@host:port/db``.
    """
    if "://" not in url or "@" not in url:
        return url
    scheme, rest = url.split("://", 1)
    if "@" not in rest:
        return url
    userinfo, host = rest.split("@", 1)
    if ":" in userinfo:
        user, _ = userinfo.split(":", 1)
        return f"{scheme}://{user}:***@{host}"
    return url


def _current_payload() -> dict:
    s = load_settings()
    plain = s.url() or os.environ.get("DATABASE_URL") or "sqlite:///./data/agnipariksha.db"
    return {
        "backend": s.backend,
        "label": s.label,
        "url_preview": _redact(plain),
        "updated_at": s.updated_at,
        "last_test": s.last_test,
        "supported": list_backends(),
        "process_url_preview": _redact(os.environ.get("DATABASE_URL") or plain),
    }


# ---- endpoints ------------------------------------------------------------
@router.get("")
def get_current() -> dict:
    return _current_payload()


@router.post("/test")
def post_test(payload: TestRequest) -> dict:
    result = test_connection(payload.url)
    # never echo the URL back; only its redacted form for the UI
    result["url_preview"] = _redact(payload.url)
    return result


@router.post("/save")
def post_save(payload: SaveRequest) -> dict:
    last_test: Optional[dict] = None
    if not payload.skip_test:
        last_test = test_connection(payload.url)
        if not last_test["ok"]:
            raise HTTPException(
                status_code=400,
                detail={"error": "test_failed", "test_result": last_test},
            )
    s = save_settings(
        backend=payload.backend,
        label=payload.label,
        plain_url=payload.url,
        last_test=last_test,
    )
    return {
        "ok": True,
        "saved": {
            "backend": s.backend,
            "label": s.label,
            "updated_at": s.updated_at,
            "url_preview": _redact(payload.url),
        },
        "last_test": last_test,
    }


@router.post("/switch")
def post_switch(payload: SwitchRequest) -> dict:
    """Run alembic upgrade + atomic data copy. On success, swap the
    process DATABASE_URL and the persisted settings; the next engine
    request will use the new URL."""
    outcome = migrate_and_switch(payload.url, dry_run=payload.dry_run)
    if outcome["ok"] and not payload.dry_run:
        # Persist before flipping the env var, so a restart picks up the
        # same target.
        save_settings(
            backend=payload.backend,
            label=payload.label,
            plain_url=payload.url,
            last_test={"ok": True, "via": "migrate_and_switch"},
        )
        os.environ["DATABASE_URL"] = payload.url
        # Bounce the cached engine.
        from backend.db import session as session_mod
        session_mod.reset_engine()
    outcome["url_preview"] = _redact(payload.url)
    # Strip the raw URL from the response so it never reaches the wire.
    outcome.pop("target_url", None)
    return outcome
