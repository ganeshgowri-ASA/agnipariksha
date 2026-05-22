"""Tolerance tests for the WAAREE-770 BPDT demo simulator.

Pin the simulator output to the IEC 61215-2 MQT 18.1 reference dataset
at ±0.001 V (owner-specified) and verify the DEMO_MODE load guard.
"""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.sim import bpdt_sim  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "bpdt_waaree_770_reference.json"
VD_TOL_V = 1e-3  # owner-specified calibration tolerance


def _load_fixture() -> dict:
    with FIXTURE.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def test_fixture_shape_and_module_metadata() -> None:
    ref = _load_fixture()
    assert ref["module"] == "WAAREE-770"
    assert ref["standard"] == "IEC 61215-2 MQT 18.1"
    assert len(ref["diodes"]) == 3
    assert {d["id"] for d in ref["diodes"]} == {1, 2, 3}


def test_isc_multiplier_consistency() -> None:
    """1.25 * Isc must equal the fwd-bias current value in the fixture."""
    tc = _load_fixture()["test_conditions"]
    expected = tc["fwd_bias_multiplier"] * tc["isc_a"]
    assert tc["fwd_bias_current_a"] == pytest.approx(expected, abs=1e-6)
    # And the literal owner-supplied numbers must round-trip.
    assert tc["isc_a"] == 13.29
    assert tc["fwd_bias_multiplier"] == 1.25
    assert tc["fwd_bias_current_a"] == 16.6125


@pytest.mark.parametrize("diode_id", [1, 2, 3])
def test_vd_for_matches_slope_intercept_within_tolerance(diode_id: int) -> None:
    ref = _load_fixture()
    d = next(x for x in ref["diodes"] if x["id"] == diode_id)
    slope = d["vd_vs_tj_slope_v_per_c"]
    intercept = d["vd_vs_tj_intercept_v"]
    tj = d["tj_calc_at_1h_c"]
    expected_vd = slope * tj + intercept
    actual_vd = bpdt_sim.vd_for(diode_id, tj)
    assert abs(actual_vd - expected_vd) <= VD_TOL_V


@pytest.mark.parametrize("diode_id", [1, 2, 3])
def test_simulate_1h_run_returns_fixture_tj_final(diode_id: int) -> None:
    ref = _load_fixture()
    d = next(x for x in ref["diodes"] if x["id"] == diode_id)
    out = bpdt_sim.simulate_1h_run(diode_id)
    # Tj_final is read straight from the fixture — must match exactly.
    assert out["tj_final_c"] == d["tj_calc_at_1h_c"]
    # Tj_initial defaults to the ambient (75 C) per test conditions.
    assert out["tj_initial_c"] == ref["test_conditions"]["ambient_test_temp_c"]
    # Vd endpoints obey the same ±0.001 V tolerance.
    expected_vd_final = (
        d["vd_vs_tj_slope_v_per_c"] * d["tj_calc_at_1h_c"]
        + d["vd_vs_tj_intercept_v"]
    )
    assert abs(out["vd_final_v"] - expected_vd_final) <= VD_TOL_V


def test_unknown_diode_raises_keyerror() -> None:
    with pytest.raises(KeyError):
        bpdt_sim.vd_for(99, 75.0)


def test_module_refuses_to_load_outside_demo_mode() -> None:
    """Re-importing bpdt_sim with DEMO_MODE=False must raise AssertionError."""

    class _FakeSettings:
        DEMO_MODE = False

    with patch("backend.config.get_settings", return_value=_FakeSettings()):
        sys.modules.pop("backend.sim.bpdt_sim", None)
        with pytest.raises(AssertionError):
            importlib.import_module("backend.sim.bpdt_sim")
    # Restore the demo-mode module for any later tests.
    sys.modules.pop("backend.sim.bpdt_sim", None)
    importlib.import_module("backend.sim.bpdt_sim")
