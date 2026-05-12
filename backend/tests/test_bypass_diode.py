"""Unit tests for IEC 61215-2 MQT 18 — bypass diode thermal + functionality.

These tests run without network or hardware: the analysis module is pure
math and the state machine is driven through its demo simulator.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.analysis.bypass_diode import (
    LinearFit,
    evaluate,
    functionality_ok,
    junction_temperature,
    linear_fit,
)
from backend.app.tests.bypass_diode import (
    BypassDiodeTest,
    CAL_TEMPERATURES_C,
    load_catalog,
    lookup_diode,
)


# --- linear_fit ---------------------------------------------------------------

def test_linear_fit_recovers_exact_slope_and_intercept() -> None:
    # Vf = -0.002 * T + 0.55 (mV/C scaled to V/C); seven temperatures.
    m_true, c_true = -0.002, 0.55
    xs = [30, 40, 50, 60, 70, 80, 90]
    ys = [m_true * x + c_true for x in xs]
    fit = linear_fit(xs, ys)
    assert fit.slope == pytest.approx(m_true, rel=1e-9)
    assert fit.intercept == pytest.approx(c_true, rel=1e-9)
    assert fit.r_squared == pytest.approx(1.0, abs=1e-12)
    assert fit.n == 7


def test_linear_fit_handles_zero_y_variance() -> None:
    fit = linear_fit([1, 2, 3], [0.5, 0.5, 0.5])
    assert fit.slope == pytest.approx(0.0)
    assert fit.intercept == pytest.approx(0.5)
    assert fit.r_squared == pytest.approx(1.0)


def test_linear_fit_rejects_too_few_points() -> None:
    with pytest.raises(ValueError):
        linear_fit([1.0], [2.0])


def test_linear_fit_rejects_zero_x_variance() -> None:
    with pytest.raises(ValueError):
        linear_fit([5, 5, 5], [1, 2, 3])


def test_linear_fit_mismatched_lengths() -> None:
    with pytest.raises(ValueError):
        linear_fit([1, 2], [1, 2, 3])


def test_linear_fit_r_squared_below_one_for_noisy_data() -> None:
    xs = [30, 40, 50, 60, 70, 80, 90]
    # Add deterministic 'noise' so test is reproducible.
    ys = [-0.002 * x + 0.55 + (0.001 if i % 2 == 0 else -0.001) for i, x in enumerate(xs)]
    fit = linear_fit(xs, ys)
    assert 0.0 < fit.r_squared < 1.0
    assert fit.slope < 0  # still negative


# --- junction_temperature -----------------------------------------------------

def test_junction_temperature_recovers_calibration() -> None:
    fit = LinearFit(slope=-0.002, intercept=0.55, r_squared=1.0, n=7)
    # At Tj = 110 C, Vf should be 0.55 + (-0.002 * 110) = 0.33
    assert junction_temperature(0.33, fit) == pytest.approx(110.0)


def test_junction_temperature_rejects_positive_slope() -> None:
    fit = LinearFit(slope=0.001, intercept=0.5, r_squared=1.0, n=3)
    with pytest.raises(ValueError):
        junction_temperature(0.5, fit)


def test_junction_temperature_rejects_zero_slope() -> None:
    fit = LinearFit(slope=0.0, intercept=0.5, r_squared=1.0, n=3)
    with pytest.raises(ValueError):
        junction_temperature(0.5, fit)


# --- evaluate (pass/fail) -----------------------------------------------------

def _row(diode_id: str, tj: float, tj_max: float = 175.0, r2: float = 0.999) -> dict:
    return {
        "diode_id": diode_id,
        "part_number": "SBR10U45SP5",
        "tj_c": tj,
        "tj_max_c": tj_max,
        "r_squared": r2,
    }


def test_evaluate_all_pass_with_default_margin() -> None:
    v = evaluate([_row("D1", 120.0), _row("D2", 130.0), _row("D3", 140.0)], margin_c=10.0)
    assert v.passed is True
    assert v.failing_diode_ids == []
    assert "All 3 diodes pass" in v.summary
    assert all(d.passed for d in v.diodes)


def test_evaluate_fail_when_tj_exceeds_margin() -> None:
    # Tj_max=175 - margin=10 => limit 165. Last diode is exactly at the limit.
    v = evaluate(
        [_row("D1", 130.0), _row("D2", 170.0), _row("D3", 165.0)],
        margin_c=10.0,
    )
    assert v.passed is False
    assert v.failing_diode_ids == ["D2"]
    assert "D2" in v.summary


def test_evaluate_edge_exact_limit_passes() -> None:
    # headroom == 0 should still count as pass (>= 0).
    v = evaluate([_row("D1", 165.0)], margin_c=10.0)
    assert v.passed is True
    assert v.diodes[0].headroom_c == pytest.approx(0.0)


def test_evaluate_rejects_negative_margin() -> None:
    with pytest.raises(ValueError):
        evaluate([_row("D1", 100.0)], margin_c=-1.0)


def test_evaluate_zero_margin_uses_raw_tj_max() -> None:
    v = evaluate([_row("D1", 175.0)], margin_c=0.0)
    assert v.passed is True
    v2 = evaluate([_row("D1", 175.1)], margin_c=0.0)
    assert v2.passed is False


# --- functionality_ok ---------------------------------------------------------

def test_functionality_ok_within_tolerance() -> None:
    fit = LinearFit(slope=-0.002, intercept=0.55, r_squared=0.999, n=7)
    # Expected at 25 C: 0.5
    assert functionality_ok(0.50, fit=fit, tolerance_v=0.05) is True
    assert functionality_ok(0.45, fit=fit, tolerance_v=0.05) is True
    assert functionality_ok(0.40, fit=fit, tolerance_v=0.05) is False  # short-ish
    assert functionality_ok(0.80, fit=fit, tolerance_v=0.05) is False  # open-ish


def test_functionality_ok_rejects_bad_tolerance() -> None:
    fit = LinearFit(slope=-0.002, intercept=0.55, r_squared=0.999, n=7)
    with pytest.raises(ValueError):
        functionality_ok(0.5, fit=fit, tolerance_v=0.0)


# --- catalog ------------------------------------------------------------------

def test_catalog_loads_and_contains_required_diodes() -> None:
    cat = load_catalog()
    part_numbers = {d["part_number"] for d in cat["diodes"]}
    # Spec calls out these two by name.
    assert "SBR10U45SP5" in part_numbers
    assert "MBR1045" in part_numbers


def test_catalog_lookup_case_insensitive() -> None:
    d = lookup_diode("sbr10u45sp5")
    assert d["part_number"] == "SBR10U45SP5"
    assert d["tj_max_c"] > 0


def test_catalog_lookup_missing_part_raises() -> None:
    with pytest.raises(KeyError):
        lookup_diode("NOT-A-REAL-PART")


# --- state machine (demo) -----------------------------------------------------

@pytest.mark.asyncio
async def test_full_run_demo_passes_for_healthy_diodes(tmp_path, monkeypatch) -> None:
    # Redirect the persistence dir to tmp so the test is hermetic.
    from backend.app.tests import bypass_diode as bd_mod
    monkeypatch.setattr(bd_mod, "CALIBRATION_DIR", tmp_path)

    test = BypassDiodeTest(scpi=None, demo=True)
    result = await asyncio.wait_for(
        test.run_full(
            part_number="SBR10U45SP5",
            n_diodes=3,
            i_test_a=9.5,
            aging=0.0,
            demo_speedup=20000.0,
            seed=42,
        ),
        timeout=10.0,
    )

    assert result["phase"] == "done"
    assert result["verdict"]["passed"] is True
    assert result["verdict"]["functionality_pass"] is True
    assert len(result["diodes"]) == 3
    # Each diode collected one calibration sample per target temperature.
    for d in result["diodes"]:
        assert len(d["samples"]) == len(CAL_TEMPERATURES_C)
        assert d["fit"]["slope"] < 0
        assert d["fit"]["r_squared"] > 0.9
    # Persistence path exists.
    persisted = list(tmp_path.glob("*.json"))
    assert len(persisted) == 1


@pytest.mark.asyncio
async def test_full_run_demo_fails_for_severely_aged_diodes(tmp_path, monkeypatch) -> None:
    from backend.app.tests import bypass_diode as bd_mod
    monkeypatch.setattr(bd_mod, "CALIBRATION_DIR", tmp_path)

    test = BypassDiodeTest(scpi=None, demo=True)
    result = await asyncio.wait_for(
        test.run_full(
            part_number="MBR1045",     # Tj_max = 150 C, easier to push past
            n_diodes=3,
            i_test_a=15.0,
            aging=1.0,                 # worst-case fixture
            demo_speedup=20000.0,
            seed=7,
        ),
        timeout=10.0,
    )

    assert result["phase"] == "done"
    # Either thermally failed OR functionally outside tolerance — both are fails.
    assert result["verdict"]["passed"] is False


@pytest.mark.asyncio
async def test_full_run_emits_events(tmp_path, monkeypatch) -> None:
    from backend.app.tests import bypass_diode as bd_mod
    monkeypatch.setattr(bd_mod, "CALIBRATION_DIR", tmp_path)

    events: list = []

    test = BypassDiodeTest(scpi=None, demo=True, on_event=events.append)
    await asyncio.wait_for(
        test.run_full(
            part_number="SBR10U45SP5",
            n_diodes=3,
            i_test_a=9.5,
            aging=0.0,
            demo_speedup=20000.0,
            seed=1,
        ),
        timeout=10.0,
    )

    kinds = {e["event"] for e in events}
    assert "cal_sample" in kinds
    assert "cal_fit" in kinds
    assert "bias_sample" in kinds
    assert "tj" in kinds
    assert "functionality" in kinds
    assert "done" in kinds
