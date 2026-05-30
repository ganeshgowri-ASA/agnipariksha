"""IEC TS 63342 contract tests for the LeTID dark-voltage helpers.

Pins the stabilization (stop) criterion and the measurement-uncertainty budget
the bench orchestrator and IEC report rely on. The frontend mirrors the same
math in ``frontend/features/letid/analysis/darkVoltage.ts``; the two MUST agree.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

# Make ``backend`` importable in CI where pytest runs from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_programs.letid import (  # noqa: E402
    LETID_CAL_REL_STD,
    LETID_COVERAGE_K,
    LETID_MIN_SOAK_HRS,
    LETID_STABILIZATION_REL_THRESHOLD,
    LETID_STABILIZATION_WINDOW_HRS,
    LETID_VOLT_RESOLUTION_V,
    dark_voltage_uncertainty,
    letid_stop_criterion,
)


def _flat_series(end_hrs: float, span_hrs: float, v: float, jitter: float = 0.0):
    """A flat dark-voltage tail of `span_hrs` ending at `end_hrs`, 2 h cadence."""
    pts: list[tuple[float, float]] = []
    h = end_hrs - span_hrs
    while h <= end_hrs + 1e-9:
        pts.append((round(h, 2), v + (jitter * math.sin(h) if jitter else 0.0)))
        h += 2
    return pts


class TestStopCriterion:
    """TS 63342 dark-voltage stabilization rule."""

    def test_met_when_stable_after_minimum_soak(self) -> None:
        series = _flat_series(200, 200, 0.6, jitter=0.00005)
        r = letid_stop_criterion(series)
        assert r.met is True
        assert r.relative_drift is not None
        assert r.relative_drift < LETID_STABILIZATION_REL_THRESHOLD
        assert "Stabilized" in r.reason

    def test_not_met_when_trailing_window_still_drifts(self) -> None:
        # Long soak but a clear downward slope over the trailing window.
        series = [(h, 0.62 - 0.0002 * h) for h in range(0, 201, 2)]
        r = letid_stop_criterion(series)
        assert r.met is False
        assert "Not stabilized" in r.reason
        assert r.relative_drift is not None
        assert r.relative_drift > LETID_STABILIZATION_REL_THRESHOLD

    def test_not_met_when_below_minimum_soak(self) -> None:
        series = _flat_series(50, 50, 0.6)
        r = letid_stop_criterion(series)
        assert r.met is False
        assert "minimum" in r.reason
        assert r.relative_drift == 0.0

    def test_not_met_when_window_not_full(self) -> None:
        series = _flat_series(10, 10, 0.6)
        r = letid_stop_criterion(series)
        assert r.met is False
        assert "window not yet full" in r.reason
        assert r.relative_drift is None

    def test_empty_series(self) -> None:
        r = letid_stop_criterion([])
        assert r.met is False
        assert r.relative_drift is None
        assert r.window_span_hrs == 0.0

    def test_custom_config(self) -> None:
        series = _flat_series(80, 80, 0.6, jitter=0.00005)
        r = letid_stop_criterion(series, window_hrs=12, min_soak_hrs=60, rel_threshold=0.005)
        assert r.met is True

    def test_unsorted_input_is_handled(self) -> None:
        ordered = _flat_series(200, 200, 0.6, jitter=0.00005)
        shuffled = ordered[::-1]
        assert letid_stop_criterion(shuffled).met == letid_stop_criterion(ordered).met


class TestDarkVoltageUncertainty:
    """GUM quadrature with k=2 expansion."""

    def test_combines_cal_and_resolution_in_quadrature(self) -> None:
        value, cal, res = 0.6, 0.002, 0.001
        r = dark_voltage_uncertainty(value, cal_rel_std=cal, resolution=res, k=2)
        u_cal = cal * value
        u_res = res / math.sqrt(12)
        expected_std = math.hypot(u_cal, u_res)
        assert r.standard == pytest.approx(expected_std, rel=1e-12)
        assert r.expanded == pytest.approx(2 * expected_std, rel=1e-12)
        assert r.k == 2
        assert r.relative == pytest.approx((2 * expected_std) / value, rel=1e-12)

    def test_defaults_match_iec_constants(self) -> None:
        r = dark_voltage_uncertainty(0.6)
        u_cal = LETID_CAL_REL_STD * 0.6
        u_res = LETID_VOLT_RESOLUTION_V / math.sqrt(12)
        assert r.standard == pytest.approx(math.hypot(u_cal, u_res), rel=1e-12)
        assert r.k == LETID_COVERAGE_K

    def test_resolution_only_at_zero_value(self) -> None:
        r = dark_voltage_uncertainty(0.0, cal_rel_std=0.002, resolution=0.001, k=2)
        assert r.standard == pytest.approx(0.001 / math.sqrt(12), rel=1e-12)
        assert r.expanded == pytest.approx((2 * 0.001) / math.sqrt(12), rel=1e-12)
        assert math.isnan(r.relative)

    def test_calibration_scales_with_magnitude(self) -> None:
        small = dark_voltage_uncertainty(0.5, cal_rel_std=0.002, resolution=0.0)
        large = dark_voltage_uncertainty(50, cal_rel_std=0.002, resolution=0.0)
        assert large.expanded / small.expanded == pytest.approx(100, rel=1e-9)
        assert large.relative == pytest.approx(small.relative, rel=1e-12)


class TestClientServerParity:
    """Constants must match the frontend LETID_DARKV_CONSTANTS exactly."""

    def test_constants(self) -> None:
        assert LETID_STABILIZATION_WINDOW_HRS == 24.0
        assert LETID_STABILIZATION_REL_THRESHOLD == 0.005
        assert LETID_MIN_SOAK_HRS == 162.0
        assert LETID_CAL_REL_STD == 0.002
        assert LETID_VOLT_RESOLUTION_V == 0.001
        assert LETID_COVERAGE_K == 2.0
