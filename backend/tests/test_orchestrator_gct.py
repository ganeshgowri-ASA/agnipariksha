"""Tests for the IEC 61730-2 §5.3.2 Ground Continuity orchestrator."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config import get_settings  # noqa: E402
from backend.orchestrators.ground_continuity import (  # noqa: E402
    DEFAULT_R_LIMIT_OHM,
    GCTState,
    GroundContinuityOrchestrator,
)


def _orch(**kw) -> GroundContinuityOrchestrator:
    kw.setdefault("module_id", "MOD-1")
    kw.setdefault("isc_a", 9.5)
    kw.setdefault("seed", 1234)
    return GroundContinuityOrchestrator(**kw)


def test_pass_when_resistance_below_limit() -> None:
    o = _orch()
    out = o.run_demo()
    assert o.state == GCTState.COMPLETE
    assert out["passed"] is True
    assert out["measured_resistance_ohm"] is not None
    assert out["measured_resistance_ohm"] < DEFAULT_R_LIMIT_OHM


def test_fail_when_fault_resistance_above_limit() -> None:
    o = _orch()
    out = o.run_demo(fault_ohm=0.25)  # 250 mΩ — well above the 100 mΩ limit
    assert o.state == GCTState.COMPLETE
    assert out["passed"] is False
    assert out["measured_resistance_ohm"] is not None
    assert out["measured_resistance_ohm"] >= 0.25 - 1e-9


def test_state_transitions_are_ordered() -> None:
    o = _orch()
    assert o.state == GCTState.IDLE
    o.start()
    assert o.state == GCTState.APPLYING_CURRENT
    o.begin_measuring()
    assert o.state == GCTState.MEASURING
    o.sample(t_s=1.0)
    o.complete()
    assert o.state == GCTState.COMPLETE


def test_cannot_skip_states() -> None:
    o = _orch()
    with pytest.raises(RuntimeError):
        o.begin_measuring()
    o.start()
    with pytest.raises(RuntimeError):
        o.sample(t_s=1.0)
    o.begin_measuring()
    with pytest.raises(RuntimeError):
        o.complete()  # zero samples


def test_demo_mode_assert_blocks_live() -> None:
    get_settings.cache_clear()
    with patch.dict(os.environ, {"DEMO_MODE": "false"}):
        with pytest.raises(AssertionError):
            GroundContinuityOrchestrator(module_id="MOD-X", isc_a=9.5)
    get_settings.cache_clear()


@pytest.mark.parametrize(
    "isc_a, test_current_a, expected_applied",
    [
        (9.5, 25.0, 25.0),   # 2*Isc=19 < 25 -> floor wins
        (15.0, 25.0, 30.0),  # 2*Isc=30 > 25 -> 2*Isc wins
        (0.0, 25.0, 25.0),   # degenerate Isc -> floor only
    ],
)
def test_applied_current_follows_iec_61730_2_5_3_2(
    isc_a: float, test_current_a: float, expected_applied: float
) -> None:
    o = GroundContinuityOrchestrator(
        module_id="MOD-P", isc_a=isc_a, test_current_a=test_current_a
    )
    assert pytest.approx(o.applied_current_a, rel=1e-9) == expected_applied
    d = o.to_dict()
    assert d["params"]["applied_current_a"] == pytest.approx(expected_applied)


def test_to_dict_shape_and_standard_citation() -> None:
    o = _orch()
    o.run_demo()
    d = o.to_dict()
    assert d["standard"] == "IEC 61730-2 §5.3.2"
    assert d["test"] == "GroundContinuity"
    assert d["module_id"] == "MOD-1"
    assert d["state"] == "COMPLETE"
    assert isinstance(d["samples"], list) and len(d["samples"]) >= 1
    s0 = d["samples"][0]
    for key in ("t_s", "voltage_v", "current_a", "resistance_ohm"):
        assert key in s0


@pytest.mark.parametrize(
    "kw",
    [{"isc_a": -1.0}, {"test_current_a": 0}, {"duration_s": 0}, {"r_limit_ohm": 0}],
)
def test_invalid_construction_args_rejected(kw) -> None:
    base = {"module_id": "M", "isc_a": 9.5}
    base.update(kw)
    with pytest.raises(ValueError):
        GroundContinuityOrchestrator(**base)
