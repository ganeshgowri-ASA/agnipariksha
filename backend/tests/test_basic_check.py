"""Unit tests for the Basic Check pass tracker (classifier + store).

These cover ONLY the pure-Python pieces of basic_check.py — the
``is_psu_energize_cmd`` classifier and the in-process ``_PassStore``.
The HTTP router endpoints (and their integration with the SCPI router)
are validated in the follow-up PR that wires them through main.py.
"""
from __future__ import annotations

import time

import pytest

try:
    from backend.basic_check import (  # type: ignore[import-not-found]
        PASS_TTL_S,
        get_store,
        is_psu_energize_cmd,
    )
except ImportError:  # pragma: no cover - script-mode fallback
    from basic_check import (  # type: ignore[no-redef]
        PASS_TTL_S,
        get_store,
        is_psu_energize_cmd,
    )


@pytest.fixture(autouse=True)
def _clear_store():
    get_store().clear()
    yield
    get_store().clear()


@pytest.mark.parametrize("cmd", [
    "OUTP ON", "OUTPUT ON", "OUTP 1", "outp on", "  OUTP  ON  ", ":OUTP ON",
    "VOLT 12.0", "VOLTAGE 12", "SOUR:VOLT 12.0", "SOURCE:VOLTAGE 5",
    "CURR 1.0", "SOUR:CURR 9.5", "sour:curr 2.0",
])
def test_energize_commands_are_gated(cmd: str) -> None:
    assert is_psu_energize_cmd(cmd) is True, cmd


@pytest.mark.parametrize("cmd", [
    "MEAS:VOLT?", "MEAS:CURR?", "*IDN?", "VOLT?", "CURR?", "OUTP?",
    "OUTP OFF", "OUTPUT 0", "*CLS", "SYST:LOC", "", "   ",
])
def test_safe_commands_are_not_gated(cmd: str) -> None:
    assert is_psu_energize_cmd(cmd) is False, cmd


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
    rec = s._records["MOD-OLD"]  # type: ignore[attr-defined]
    rec.passed_at_monotonic = time.monotonic() - (PASS_TTL_S + 5)
    passed, age, _ = s.status("MOD-OLD")
    assert passed is False
    assert age > PASS_TTL_S
