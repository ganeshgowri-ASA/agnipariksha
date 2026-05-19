"""Unit tests for the PSU energization gate (Basic Check pass tracker).

CRITICAL: every test runs against the in-process store with DEMO_MODE=true
implied. The router code path NEVER issues a real socket write because
the gate refuses energization commands *before* the ScpiClient is even
constructed.
"""
from __future__ import annotations

import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

try:
    from backend.basic_check import (  # type: ignore[import-not-found]
        PASS_TTL_S,
        get_store,
        is_psu_energize_cmd,
    )
    from backend.main import app
    _PATCH_PREFIX = "backend."
except ImportError:  # pragma: no cover - script-mode fallback
    from basic_check import (  # type: ignore[no-redef]
        PASS_TTL_S,
        get_store,
        is_psu_energize_cmd,
    )
    from main import app  # type: ignore[no-redef]
    _PATCH_PREFIX = ""


# Reset the singleton store between tests so cases cannot leak passes.
@pytest.fixture(autouse=True)
def _clear_store():
    get_store().clear()
    yield
    get_store().clear()


# ---------------------------------------------------------------------------
# Command classifier
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("cmd", [
    "OUTP ON",
    "OUTPUT ON",
    "OUTP 1",
    "outp on",
    "  OUTP  ON  ",
    ":OUTP ON",
    "VOLT 12.0",
    "VOLTAGE 12",
    "SOUR:VOLT 12.0",
    "SOURCE:VOLTAGE 5",
    "CURR 1.0",
    "SOUR:CURR 9.5",
    "sour:curr 2.0",
    "APPL 5,1",
    "APPLY 12.0,2.5",
    ":APPLY 5,1",
    "apply 5, 1",
])
def test_energize_commands_are_gated(cmd: str) -> None:
    assert is_psu_energize_cmd(cmd) is True, cmd


@pytest.mark.parametrize("cmd", [
    "MEAS:VOLT?",
    "MEAS:CURR?",
    "*IDN?",
    "VOLT?",
    "CURR?",
    "OUTP?",
    "OUTP OFF",         # turning OFF is always allowed — that's the safe state
    "OUTPUT 0",
    "*CLS",
    "SYST:LOC",
    "",
    "   ",
])
def test_safe_commands_are_not_gated(cmd: str) -> None:
    assert is_psu_energize_cmd(cmd) is False, cmd


# ---------------------------------------------------------------------------
# Store semantics
# ---------------------------------------------------------------------------

def test_store_pass_then_status_within_ttl() -> None:
    s = get_store()
    s.record_pass("MOD-A1", run_id="TC-123")
    passed, age, rec = s.status("MOD-A1")
    assert passed is True
    assert age >= 0
    assert rec is not None and rec.module_id == "MOD-A1" and rec.run_id == "TC-123"


def test_store_status_unknown_module() -> None:
    passed, age, rec = get_store().status("NEVER-SEEN")
    assert passed is False
    assert age == -1
    assert rec is None


def test_store_pass_expires_after_ttl() -> None:
    s = get_store()
    s.record_pass("MOD-OLD")
    # Rewind the recorded monotonic so it appears stale, no sleep required.
    rec = s._records["MOD-OLD"]  # type: ignore[attr-defined]
    rec.passed_at_monotonic = time.monotonic() - (PASS_TTL_S + 5)
    passed, age, _ = s.status("MOD-OLD")
    assert passed is False
    assert age > PASS_TTL_S


# ---------------------------------------------------------------------------
# HTTP endpoints + SCPI router gate
# ---------------------------------------------------------------------------

class _FakeSettings:
    def __init__(self) -> None:
        self.DEMO_MODE = True
        self.ITECH_IP = "127.0.0.1"
        self.ITECH_PORT = 30000
        self.ITECH_TIMEOUT_MS = 500


def _patch_settings():
    fake = _FakeSettings()
    return [
        patch(f"{_PATCH_PREFIX}scpi_router.get_settings", return_value=fake),
        patch(f"{_PATCH_PREFIX}scpi_async.get_settings", return_value=fake),
    ]


def test_post_pass_then_get_status_returns_passed() -> None:
    with TestClient(app) as c:
        r = c.post("/api/basic-check/pass", json={"module_id": "MOD-1", "run_id": "TC-1"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["passed"] is True
        assert body["module_id"] == "MOD-1"
        assert body["ttl_s"] == PASS_TTL_S

        r2 = c.get("/api/basic-check/status", params={"module_id": "MOD-1"})
        assert r2.status_code == 200
        assert r2.json()["passed"] is True


def test_get_status_unknown_module_returns_passed_false() -> None:
    with TestClient(app) as c:
        r = c.get("/api/basic-check/status", params={"module_id": "GHOST"})
        assert r.status_code == 200
        body = r.json()
        assert body["passed"] is False
        assert body["age_s"] == -1


def test_scpi_query_energize_without_module_id_is_403() -> None:
    """OUTP ON without a module_id MUST be refused — even in demo mode."""
    patches = _patch_settings()
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            r = c.get("/api/scpi/query", params={"cmd": "OUTP ON"})
            assert r.status_code == 403, r.text
            assert r.json()["detail"]["error"] == "basic_check_required"
    finally:
        for p in patches:
            p.stop()


def test_scpi_query_energize_without_basic_check_is_403() -> None:
    patches = _patch_settings()
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            r = c.get(
                "/api/scpi/query",
                params={"cmd": "SOUR:VOLT 12.0", "module_id": "MOD-Z"},
            )
            assert r.status_code == 403, r.text
            body = r.json()["detail"]
            assert body["error"] == "basic_check_required"
            assert body["module_id"] == "MOD-Z"
    finally:
        for p in patches:
            p.stop()


def test_scpi_query_energize_after_pass_succeeds() -> None:
    """Pass Basic Check → OUTP ON for same module_id is allowed (demo mode → 200)."""
    patches = _patch_settings()
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            pr = c.post("/api/basic-check/pass", json={"module_id": "MOD-OK"})
            assert pr.status_code == 200

            r = c.get(
                "/api/scpi/query",
                params={"cmd": "OUTP ON", "module_id": "MOD-OK"},
            )
            assert r.status_code == 200, r.text
            assert r.json()["demo"] is True
    finally:
        for p in patches:
            p.stop()


def test_scpi_query_measurement_is_never_gated() -> None:
    """Reads (MEAS:VOLT?) must always pass — they cannot energize the PSU."""
    patches = _patch_settings()
    for p in patches:
        p.start()
    try:
        with TestClient(app) as c:
            r = c.get("/api/scpi/query", params={"cmd": "MEAS:VOLT?"})
            assert r.status_code == 200, r.text
            assert r.json()["demo"] is True
    finally:
        for p in patches:
            p.stop()


def test_scpi_post_energize_without_module_id_is_403() -> None:
    with TestClient(app) as c:
        r = c.post("/api/scpi", json={"command": "OUTP ON"})
        assert r.status_code == 403, r.text
        assert r.json()["detail"]["error"] == "basic_check_required"
