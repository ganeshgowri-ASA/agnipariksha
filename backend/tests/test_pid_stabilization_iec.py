"""IEC 61215-2 MQT 21 + IEC TS 62804-1 contract tests for PID stabilization.

These tests pin the post-stabilization conformity invariants the bench
operator relies on: the [12, 24] h stabilization-time clamp and the *tight*
post-stab T/RH conformity bands (which NON-CONFORM where the wider in-run band
would still pass). Frontend mirrors the same math in
``frontend/features/pid/analysis/pidStabilization.ts``; the two MUST agree.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

# Make ``backend`` importable in CI where pytest runs from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_programs.pid_stabilization import (  # noqa: E402
    MAX_STABILIZATION_H,
    MIN_STABILIZATION_H,
    RH_TOL_TIGHT_PCT,
    RH_TOL_WIDE_PCT,
    T_TOL_TIGHT_C,
    T_TOL_WIDE_C,
    clamp_stabilization_hours,
    rh_conformity,
    stabilization_verdict,
    temp_conformity,
)


class TestStabilizationClamp:
    """MQT 21 — stabilization soak configurable within [12, 24] h."""

    def test_inside_window_passes_through(self) -> None:
        assert clamp_stabilization_hours(12.0) == 12.0
        assert clamp_stabilization_hours(18.0) == 18.0
        assert clamp_stabilization_hours(24.0) == 24.0

    def test_below_floor_clamped_to_12(self) -> None:
        assert clamp_stabilization_hours(11.9) == MIN_STABILIZATION_H
        assert clamp_stabilization_hours(0.0) == MIN_STABILIZATION_H
        assert clamp_stabilization_hours(-5.0) == MIN_STABILIZATION_H

    def test_above_ceiling_clamped_to_24(self) -> None:
        assert clamp_stabilization_hours(24.1) == MAX_STABILIZATION_H
        assert clamp_stabilization_hours(96.0) == MAX_STABILIZATION_H

    def test_nan_falls_back_to_floor(self) -> None:
        assert clamp_stabilization_hours(math.nan) == MIN_STABILIZATION_H


class TestTempConformity:
    """TS 62804-1 §6.2 — tight post-stab temperature band (±1 °C)."""

    def test_pending_without_reading(self) -> None:
        assert temp_conformity(None, 60.0) == "pending"

    def test_conform_at_setpoint_and_on_boundary(self) -> None:
        assert temp_conformity(60.0, 60.0) == "conform"
        assert temp_conformity(61.0, 60.0) == "conform"  # exactly +1 °C
        assert temp_conformity(59.0, 60.0) == "conform"  # exactly -1 °C

    def test_non_conform_past_tight_band(self) -> None:
        assert temp_conformity(61.1, 60.0) == "non-conform"
        # 1.5 °C is inside the WIDE band but breaches the tight band.
        assert T_TOL_WIDE_C > T_TOL_TIGHT_C
        assert temp_conformity(61.5, 60.0) == "non-conform"


class TestRhConformity:
    """TS 62804-1 §6.2 — tight post-stab humidity band (±3 %RH)."""

    def test_pending_without_reading(self) -> None:
        assert rh_conformity(None, 85.0) == "pending"

    def test_conform_at_setpoint_and_on_boundary(self) -> None:
        assert rh_conformity(85.0, 85.0) == "conform"
        assert rh_conformity(88.0, 85.0) == "conform"  # exactly +3 %
        assert rh_conformity(82.0, 85.0) == "conform"  # exactly -3 %

    def test_non_conform_past_tight_band(self) -> None:
        assert rh_conformity(88.1, 85.0) == "non-conform"
        # 4 % is inside the WIDE band but breaches the tight band.
        assert RH_TOL_WIDE_PCT > RH_TOL_TIGHT_PCT
        assert rh_conformity(89.0, 85.0) == "non-conform"


class TestStabilizationVerdict:
    """Composite post-stab verdict using the tight tolerances."""

    def test_pending_until_both_axes_present(self) -> None:
        assert stabilization_verdict(None, 60.0, 85.0, 85.0) == "pending"
        assert stabilization_verdict(60.0, 60.0, None, 85.0) == "pending"

    def test_conform_when_both_inside_tight_bands(self) -> None:
        assert stabilization_verdict(60.5, 60.0, 86.0, 85.0) == "conform"

    def test_non_conform_when_temperature_breaches(self) -> None:
        assert stabilization_verdict(62.0, 60.0, 85.0, 85.0) == "non-conform"

    def test_non_conform_when_humidity_breaches(self) -> None:
        assert stabilization_verdict(60.0, 60.0, 90.0, 85.0) == "non-conform"
