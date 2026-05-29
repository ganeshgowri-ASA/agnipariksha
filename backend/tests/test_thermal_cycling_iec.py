"""IEC 61215-2 MQT 11 contract tests for the TC orchestrator.

These tests pin the safety-critical invariants the bench operator
relies on: the Isc gate (current applied only when T_module > 25 \u00b0C)
and the ramp-rate clamp (\u2264 100 \u00b0C/h). Frontend mirrors the same math
in ``frontend/features/tc/analysis/tcAnalysis.ts``; the two MUST agree.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make ``backend`` importable in CI where pytest runs from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_programs.thermal_cycling import (  # noqa: E402
    MQT11_ISC_GATE_C,
    MQT11_MAX_RAMP_C_PER_H,
    clamp_ramp_rate,
    isc_gate_setpoint,
)


class TestIscGate:
    """MQT 11.6.3 a \u2014 Isc only when T_module > 25 \u00b0C."""

    def test_gate_closed_when_temperature_unknown(self) -> None:
        assert isc_gate_setpoint(None, 9.5) == 0.0

    def test_gate_closed_at_or_below_threshold(self) -> None:
        # Boundary is strict (>), so exactly 25.0 \u00b0C still keeps the gate closed.
        assert isc_gate_setpoint(MQT11_ISC_GATE_C, 9.5) == 0.0
        assert isc_gate_setpoint(MQT11_ISC_GATE_C - 0.01, 9.5) == 0.0
        assert isc_gate_setpoint(-40.0, 9.5) == 0.0

    def test_gate_open_above_threshold(self) -> None:
        assert isc_gate_setpoint(MQT11_ISC_GATE_C + 0.01, 9.5) == 9.5
        assert isc_gate_setpoint(85.0, 9.5) == 9.5

    def test_zero_isc_setpoint_short_circuits(self) -> None:
        # Even with the gate open the configured Isc of 0 yields 0 \u2014 trivial,
        # but pin it so the orchestrator never accidentally injects a hidden
        # default current.
        assert isc_gate_setpoint(60.0, 0.0) == 0.0


class TestRampClamp:
    """MQT 11.6.2 \u2014 temperature ramp shall not exceed 100 \u00b0C/h."""

    def test_under_ceiling_passes_through(self) -> None:
        assert clamp_ramp_rate(90.0) == 90.0
        assert clamp_ramp_rate(50.0) == 50.0

    def test_at_ceiling_unchanged(self) -> None:
        assert clamp_ramp_rate(MQT11_MAX_RAMP_C_PER_H) == MQT11_MAX_RAMP_C_PER_H

    def test_above_ceiling_clamped(self) -> None:
        assert clamp_ramp_rate(150.0) == MQT11_MAX_RAMP_C_PER_H
        assert clamp_ramp_rate(1_000.0) == MQT11_MAX_RAMP_C_PER_H

    def test_non_positive_rejected(self) -> None:
        with pytest.raises(ValueError):
            clamp_ramp_rate(0.0)
        with pytest.raises(ValueError):
            clamp_ramp_rate(-5.0)
