# /api/psu/health transport-contract tests (PR-62a). Covers demo, live-up,
# live-down. The endpoint must never silently fall back to simulator data
# in live mode — failures surface as ok=false with a populated last_error.
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

try:
    from backend.main import app  # type: ignore[import-not-found]
    _PFX = "backend."
except ImportError:  # pragma: no cover - script-mode fallback
    from main import app  # type: ignore[no-redef]
    _PFX = ""


class _FakeSettings:
    def __init__(self, *, demo: bool, host: str = "192.168.200.100",
                 port: int = 30000, timeout_ms: int = 1500, retry_attempts: int = 4) -> None:
        self.DEMO_MODE = demo
        self.ITECH_IP = host
        self.ITECH_PORT = port
        self.ITECH_TIMEOUT_MS = timeout_ms
        self.ITECH_RETRY_ATTEMPTS = retry_attempts


def _patch_settings(*, demo: bool, retry_attempts: int = 4):
    fake = _FakeSettings(demo=demo, retry_attempts=retry_attempts)
    return [
        patch(f"{_PFX}api.psu_routes.get_settings", return_value=fake),
        patch(f"{_PFX}scpi_async.get_settings", return_value=fake),
    ]


def test_demo_mode_returns_ok_with_simulator_idn() -> None:
    """Demo mode: ok=true, reachable=false, idn populated from simulator."""
    patches = _patch_settings(demo=True)
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            r = c.get("/api/psu/health")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] is True
            assert body["demo"] is True
            assert body["reachable"] is False  # no real socket in demo
            assert body["host"] == "192.168.200.100"
            assert body["port"] == 30000
            assert body["transport"] == "scpi_tcp"
            assert body["retry_attempts"] == 4
            assert body["last_error"] is None
            assert body["idn"]
            assert isinstance(body["latency_ms"], int) and body["latency_ms"] >= 0
            assert body["checked_at"]
    finally:
        for p in patches:
            p.stop()


def test_live_mode_unreachable_returns_ok_false() -> None:
    """Live mode, hardware down: ok=false, last_error populated, no idn."""
    async def _refuse(*_args, **_kwargs):
        raise OSError(111, "Connection refused")

    patches = _patch_settings(demo=False, retry_attempts=2)
    open_patch = patch(f"{_PFX}scpi_async.asyncio.open_connection", side_effect=_refuse)
    for p in patches:
        p.start()
    open_patch.start()
    try:
        with TestClient(app) as c:
            r = c.get("/api/psu/health")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["ok"] is False
            assert body["demo"] is False
            assert body["reachable"] is False
            assert body["idn"] is None
            assert body["last_error"] is not None
            assert ("Connection refused" in body["last_error"]
                    or "OSError" in body["last_error"])
            assert body["retry_attempts"] == 2
    finally:
        open_patch.stop()
        for p in patches:
            p.stop()


def test_retry_attempts_is_env_tunable() -> None:
    """Custom ITECH_RETRY_ATTEMPTS reflects in the contract."""
    patches = _patch_settings(demo=True, retry_attempts=7)
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            assert c.get("/api/psu/health").json()["retry_attempts"] == 7
    finally:
        for p in patches:
            p.stop()
