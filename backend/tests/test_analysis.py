"""Pytest harness for ``backend.app.analysis`` IEC pass/fail verdicts.

Each table-driven case is hand-built so the pass/fail boundary for the
matching IEC clause is exercised at least twice (just above + just
below) plus the obvious "insufficient data" path.

The same threshold constants used by the frontend Analysis tab live in
``backend.app.analysis.iec_pass_fail`` — these tests pin them so a
silent constant drift becomes a CI failure.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import List

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.analysis import (  # noqa: E402
    GATE2_PMAX_DELTA_PERCENT,
    AnalysisResult,
    Reading,
    Verdict,
    bypass_diode_verdict,
    ground_continuity_verdict,
    letid_verdict,
    pmax_delta_verdict,
    reverse_current_verdict,
)


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def _ts(i: int) -> int:
    """Deterministic millisecond timestamp for the i-th sample."""
    return 1_700_000_000_000 + i * 500


def _series(samples: List[dict]) -> List[Reading]:
    """Build a Reading series from compact dicts."""
    out: List[Reading] = []
    for i, s in enumerate(samples):
        out.append(
            Reading(
                timestamp_ms=_ts(i),
                voltage=float(s.get("v", 0.0)),
                current=float(s.get("i", 0.0)),
                power=float(s.get("p", s.get("v", 0.0) * s.get("i", 0.0))),
                temperature=(
                    None if s.get("t") is None else float(s["t"])
                ),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Constant pinning
# ---------------------------------------------------------------------------

def test_gate2_threshold_pinned() -> None:
    """The frontend Gate-2 floor (frontend/types/test-session.ts:60)
    MUST agree with the backend constant. If you change one, change both."""
    assert GATE2_PMAX_DELTA_PERCENT == -5.0


# ---------------------------------------------------------------------------
# Pmax-delta verdict — TC / HF / DH
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("pre_w", "post_w", "expected"),
    [
        # Just above the floor — exactly at -5% is still PASS.
        (100.0, 95.0,  Verdict.PASS),
        # Comfortable PASS.
        (100.0, 99.0,  Verdict.PASS),
        # No degradation = PASS.
        (100.0, 100.0, Verdict.PASS),
        # Slight gain = PASS (instrumentation noise).
        (100.0, 101.5, Verdict.PASS),
        # Just below the floor — -5.01% is FAIL.
        (100.0, 94.99, Verdict.FAIL),
        # Catastrophic drop.
        (100.0, 50.0,  Verdict.FAIL),
        # Zero / unknown pre-Pmax — INSUFFICIENT_DATA.
        (0.0,   95.0,  Verdict.INSUFFICIENT_DATA),
        (-1.0,  95.0,  Verdict.INSUFFICIENT_DATA),
    ],
)
def test_pmax_delta_thermal_cycling(pre_w: float, post_w: float, expected: Verdict) -> None:
    """IEC 61215-2 MQT 11 — Thermal Cycling Pmax delta."""
    result = pmax_delta_verdict(pre_w, post_w)
    assert result.verdict is expected
    assert result.clause.startswith("IEC 61215-2")
    if expected is not Verdict.INSUFFICIENT_DATA:
        assert result.metric is not None


@pytest.mark.parametrize(
    ("pre_w", "post_w", "expected"),
    [
        (250.0, 245.0, Verdict.PASS),   # -2% → PASS for MQT 12
        (250.0, 237.5, Verdict.PASS),   # exactly -5% → PASS (boundary)
        (250.0, 237.4, Verdict.FAIL),   # past the floor → FAIL
    ],
)
def test_pmax_delta_humidity_freeze(pre_w: float, post_w: float, expected: Verdict) -> None:
    """IEC 61215-2 MQT 12 — Humidity Freeze reuses the Gate-2 floor."""
    result = pmax_delta_verdict(pre_w, post_w, clause="IEC 61215-2 MQT 12")
    assert result.verdict is expected
    assert "MQT 12" in result.clause


@pytest.mark.parametrize(
    ("pre_w", "post_w", "expected"),
    [
        (300.0, 290.0, Verdict.PASS),
        (300.0, 285.0, Verdict.PASS),   # exactly -5%
        (300.0, 284.0, Verdict.FAIL),
    ],
)
def test_pmax_delta_damp_heat(pre_w: float, post_w: float, expected: Verdict) -> None:
    """IEC 61215-2 MQT 13 — Damp Heat (1000h, 85°C/85%RH)."""
    result = pmax_delta_verdict(pre_w, post_w, clause="IEC 61215-2 MQT 13")
    assert result.verdict is expected
    assert "MQT 13" in result.clause


# ---------------------------------------------------------------------------
# LeTID — tighter 2% threshold
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("pre_w", "post_w", "expected"),
    [
        (320.0, 320.0,  Verdict.PASS),     # no loss
        (320.0, 313.6,  Verdict.PASS),     # exactly -2.0% → PASS at boundary
        (320.0, 313.5,  Verdict.FAIL),     # -2.03% → FAIL
        (320.0, 300.0,  Verdict.FAIL),     # -6.25%
        (0.0,   310.0,  Verdict.INSUFFICIENT_DATA),
    ],
)
def test_letid_pmax_loss(pre_w: float, post_w: float, expected: Verdict) -> None:
    """IEC TS 63342:2022 — LeTID Pmax loss < 2%."""
    result = letid_verdict(pre_w, post_w)
    assert result.verdict is expected
    assert result.clause == "IEC TS 63342:2022"


# ---------------------------------------------------------------------------
# Ground Continuity — V/I resistance check
# ---------------------------------------------------------------------------

def test_ground_continuity_pass_at_25a() -> None:
    """Five points at 25A with 2 V drop → R = 0.08 Ω → PASS (< 0.1 Ω)."""
    rs = _series([{"v": 2.0, "i": 25.0} for _ in range(5)])
    result = ground_continuity_verdict(rs)
    assert result.verdict is Verdict.PASS
    assert result.metric is not None
    assert result.metric == pytest.approx(0.08, rel=1e-9)


def test_ground_continuity_boundary_passes_at_exactly_0p1() -> None:
    rs = _series([{"v": 2.5, "i": 25.0}])  # R = 0.1 → boundary, PASS
    assert ground_continuity_verdict(rs).verdict is Verdict.PASS


def test_ground_continuity_fail_when_any_point_exceeds_threshold() -> None:
    rs = _series([
        {"v": 2.0,  "i": 25.0},   # R = 0.08
        {"v": 3.0,  "i": 25.0},   # R = 0.12 → FAIL
        {"v": 1.5,  "i": 25.0},   # R = 0.06
    ])
    result = ground_continuity_verdict(rs)
    assert result.verdict is Verdict.FAIL
    assert result.metric == pytest.approx(0.12, rel=1e-9)


def test_ground_continuity_insufficient_data_when_no_current() -> None:
    rs = _series([{"v": 1.0, "i": 0.0}, {"v": 2.0, "i": 0.0}])
    assert ground_continuity_verdict(rs).verdict is Verdict.INSUFFICIENT_DATA


def test_ground_continuity_insufficient_data_when_empty() -> None:
    assert ground_continuity_verdict([]).verdict is Verdict.INSUFFICIENT_DATA


# ---------------------------------------------------------------------------
# Bypass Diode — junction temperature
# ---------------------------------------------------------------------------

def test_bypass_diode_pass_under_threshold() -> None:
    rs = _series([{"v": 0.6, "i": 13.5, "t": 110.0 + n} for n in range(5)])
    result = bypass_diode_verdict(rs)
    assert result.verdict is Verdict.PASS
    assert result.metric == pytest.approx(114.0, rel=1e-9)


def test_bypass_diode_boundary_passes_at_exactly_128c() -> None:
    rs = _series([{"v": 0.7, "i": 13.5, "t": 128.0}])
    assert bypass_diode_verdict(rs).verdict is Verdict.PASS


def test_bypass_diode_fail_on_thermal_runaway() -> None:
    rs = _series([
        {"v": 0.6, "i": 13.5, "t": 120.0},
        {"v": 0.6, "i": 13.5, "t": 130.0},   # over 128 → FAIL
        {"v": 0.6, "i": 13.5, "t": 125.0},
    ])
    result = bypass_diode_verdict(rs)
    assert result.verdict is Verdict.FAIL
    assert result.metric == pytest.approx(130.0, rel=1e-9)


def test_bypass_diode_insufficient_data_when_no_temperature() -> None:
    rs = _series([{"v": 0.6, "i": 13.5}])
    assert bypass_diode_verdict(rs).verdict is Verdict.INSUFFICIENT_DATA


# ---------------------------------------------------------------------------
# Reverse Current Overload — current band check
# ---------------------------------------------------------------------------

def test_reverse_current_pass_within_tolerance() -> None:
    # Test at 1.35 × 10A = 13.5A; readings stay close (≤ +5%).
    rs = _series([{"v": 60.0, "i": 13.5 + n * 0.05} for n in range(5)])
    result = reverse_current_verdict(rs, test_current_a=13.5)
    assert result.verdict is Verdict.PASS


def test_reverse_current_boundary_passes_at_upper_band() -> None:
    rs = _series([{"v": 60.0, "i": 13.5 * 1.05}])  # exactly +5% → PASS
    assert reverse_current_verdict(rs, test_current_a=13.5).verdict is Verdict.PASS


def test_reverse_current_fail_when_exceeding_band() -> None:
    rs = _series([
        {"v": 60.0, "i": 13.5},
        {"v": 60.0, "i": 14.5},   # 14.5 > 13.5 × 1.05 = 14.175 → FAIL
        {"v": 60.0, "i": 13.6},
    ])
    result = reverse_current_verdict(rs, test_current_a=13.5)
    assert result.verdict is Verdict.FAIL
    assert result.metric == pytest.approx(14.5, rel=1e-9)


def test_reverse_current_insufficient_data_when_empty() -> None:
    result = reverse_current_verdict([], test_current_a=13.5)
    assert result.verdict is Verdict.INSUFFICIENT_DATA


# ---------------------------------------------------------------------------
# AnalysisResult convenience properties
# ---------------------------------------------------------------------------

def test_analysis_result_passed_failed_helpers() -> None:
    ok = AnalysisResult(Verdict.PASS, 0.0, -5.0, "x")
    bad = AnalysisResult(Verdict.FAIL, -7.0, -5.0, "x")
    unk = AnalysisResult(Verdict.INSUFFICIENT_DATA, None, -5.0, "x")
    assert ok.passed and not ok.failed
    assert bad.failed and not bad.passed
    assert not unk.passed and not unk.failed
