"""IEC 61730-2 MST 26 contract tests for the RCO forward-bias helpers.

Pins the safety-critical invariants the bench relies on for the forward-bias
thermal/IR leg: the 1.35×Isc setpoint and the 1-2 h hold clamp. The frontend
mirrors the same math in
``frontend/features/rco/analysis/rcoThermal.ts``; the two MUST agree.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make ``backend`` importable in CI where pytest runs from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_programs.reverse_current import (  # noqa: E402
    MST26_HOLD_MAX_H,
    MST26_HOLD_MIN_H,
    MST26_ISC_FORWARD_MULTIPLIER,
    clamp_hold_hours,
    forward_bias_setpoint,
)


class TestForwardBiasSetpoint:
    """MST 26 §6 — forward-bias fault current = 1.35× Isc."""

    def test_multiplier_pinned_at_135pct(self) -> None:
        assert MST26_ISC_FORWARD_MULTIPLIER == 1.35

    def test_returns_135pct_of_isc(self) -> None:
        assert forward_bias_setpoint(10.0) == pytest.approx(13.5)
        assert forward_bias_setpoint(9.5) == pytest.approx(12.825)

    def test_zero_isc(self) -> None:
        assert forward_bias_setpoint(0.0) == 0.0

    def test_matches_constant_for_unit_isc(self) -> None:
        assert forward_bias_setpoint(1.0) == pytest.approx(MST26_ISC_FORWARD_MULTIPLIER)


class TestClampHoldHours:
    """MST 26 §6 — forward-bias hold clamped to the [1, 2] h window."""

    def test_in_range_passes_through(self) -> None:
        assert clamp_hold_hours(1.0) == 1.0
        assert clamp_hold_hours(1.5) == 1.5
        assert clamp_hold_hours(2.0) == 2.0

    def test_below_minimum_clamped_up(self) -> None:
        assert clamp_hold_hours(0.5) == MST26_HOLD_MIN_H
        assert clamp_hold_hours(0.0) == 1.0
        assert clamp_hold_hours(-3.0) == 1.0

    def test_above_maximum_clamped_down(self) -> None:
        assert clamp_hold_hours(2.5) == MST26_HOLD_MAX_H
        assert clamp_hold_hours(10.0) == 2.0

    @pytest.mark.parametrize("h", [0.0, 0.99, 1.0, 1.5, 2.0, 2.01, 5.0])
    def test_boundary_band(self, h: float) -> None:
        out = clamp_hold_hours(h)
        assert MST26_HOLD_MIN_H <= out <= MST26_HOLD_MAX_H


class TestClientServerParity:
    """The backend setpoint/clamp must equal the rcoThermal.ts results."""

    def test_setpoint_parity_examples(self) -> None:
        # Same fixtures asserted in rcoThermal.test.ts.
        assert forward_bias_setpoint(10.0) == pytest.approx(13.5)
        assert forward_bias_setpoint(9.5) == pytest.approx(12.825)

    def test_clamp_parity_examples(self) -> None:
        assert clamp_hold_hours(0.5) == 1.0
        assert clamp_hold_hours(2.5) == 2.0
        assert clamp_hold_hours(1.5) == 1.5
