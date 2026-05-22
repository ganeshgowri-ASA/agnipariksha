"""Hardened interlock tests for the Basic Check HTTP gate (#52c).

  (a) OUTP ON → 403 when no prior pass for module_id (passed_at_monotonic None).
  (b) OUTP ON → 403 when pass is older than the *current* PASS_TTL_S (5 min).
  (c) Fail-safe: gate exception → 403 (never a 500 that masks the gate).
  (d) OUTP ON allowed (non-403) once pass is fresh, live-mode is ON, and
      a module_id is bound.
"""
from __future__ import annotations

import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

try:
    from backend import basic_check as bc_mod
    from backend.main import app
    _P = "backend."
except ImportError:  # pragma: no cover
    import basic_check as bc_mod  # type: ignore[no-redef]
    from main import app  # type: ignore[no-redef]
    _P = ""


MODULE_ID = "MOD-INTERLOCK-A1"
OUTP_ON = {"command": "OUTP ON", "module_id": MODULE_ID}


@pytest.fixture(autouse=True)
def _reset() -> None:
    bc_mod.get_store().clear()
    bc_mod.LIVE_MODE_ENABLED = False
    yield
    bc_mod.get_store().clear()
    bc_mod.LIVE_MODE_ENABLED = False


def test_outp_on_blocked_when_basic_check_pass_ts_is_None_returns_403() -> None:
    """No PASS record at all → 403 BASIC_CHECK_REQUIRED."""
    passed, _age, rec = bc_mod.get_store().status(MODULE_ID)
    assert passed is False and rec is None, "store fixture leaked"
    with TestClient(app) as c:
        r = c.post("/api/scpi", json=OUTP_ON)
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["error"] == "BASIC_CHECK_REQUIRED"


def test_outp_on_blocked_when_basic_check_pass_ts_older_than_5min_returns_403() -> None:
    """Pass aged 301 s with PASS_TTL_S patched to 300 → 403."""
    bc_mod.get_store().record_pass(MODULE_ID)
    rec = bc_mod.get_store()._records[MODULE_ID]  # type: ignore[attr-defined]
    rec.passed_at_monotonic = time.monotonic() - 301
    with patch.object(bc_mod, "PASS_TTL_S", 300), \
         patch(f"{_P}api.scpi_routes.PASS_TTL_S", 300):
        with TestClient(app) as c:
            r = c.post("/api/scpi", json=OUTP_ON)
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["error"] == "BASIC_CHECK_REQUIRED"


def test_outp_on_blocked_on_exception_path_in_decorator_returns_403_fails_safe() -> None:
    """FAIL-SAFE: any non-HTTPException raised inside the gate becomes 403, NOT 500."""
    def _boom(*_a, **_kw):
        raise RuntimeError("simulated decorator failure")
    with patch(f"{_P}api.scpi_routes.get_store", side_effect=_boom):
        with TestClient(app) as c:
            r = c.post("/api/scpi", json=OUTP_ON)
    assert r.status_code == 403, (
        f"FAIL-SAFE VIOLATION: gate exception leaked as status={r.status_code}; "
        f"a bug in the gate must NEVER let a PSU energization through. body={r.text}"
    )
    assert r.json()["detail"]["error"] == "BASIC_CHECK_REQUIRED"


def test_outp_on_allowed_when_basic_check_pass_ts_within_5min_AND_live_mode_toggle_AND_owner_session() -> None:
    """Fresh PASS + live-mode ON via /api/settings/live-mode → not 403."""
    with TestClient(app) as c:
        rp = c.post("/api/basic-check/pass", json={"module_id": MODULE_ID, "run_id": "TC-OWNER"})
        assert rp.status_code == 200 and rp.json()["passed"] is True, rp.text
        rl = c.post("/api/settings/live-mode", json={"enabled": True})
        assert rl.status_code == 200 and rl.json()["enabled"] is True, rl.text
        with patch.object(bc_mod, "PASS_TTL_S", 300), \
             patch(f"{_P}api.scpi_routes.PASS_TTL_S", 300):
            r = c.post("/api/scpi", json=OUTP_ON)
    # 200 (demo simulator) or 503 (hardware unreachable in CI) is fine —
    # what matters for the interlock is the gate did NOT refuse with 403.
    assert r.status_code != 403, (
        f"interlock false-positive: gate refused despite fresh PASS + live-mode ON. "
        f"status={r.status_code} body={r.text}"
    )
