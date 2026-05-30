"""IEC 61215-2 MQT 11 contract tests for the TC extensions.

Pins the extension invariants the bench operator relies on:
  * junction-box mass-loading validation (MQT 11 mounting),
  * per-position tolerance sets (MQT 11.6.1 / 11.6.2),
  * point-to-point and cumulative ramp math (MQT 11.6.2).

Frontend mirrors the same constants and math in
``frontend/features/tc/analysis/tcExtensions.ts``; the two MUST agree.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make ``backend`` importable in CI where pytest runs from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_programs.thermal_cycling import (  # noqa: E402
    MQT11_MAX_RAMP_C_PER_H,
    MQT11_WARN_RAMP_C_PER_H,
    POSITION_TOLERANCES,
    classify_ramp_for_position,
    cumulative_ramp,
    point_to_point_ramp,
    position_tolerance_set,
    validate_mass_loading,
)


class TestPositionTolerances:
    """MQT 11.6.1 / 11.6.2 — per-position tolerance sets."""

    def test_every_position_has_a_set_with_clause_ref(self) -> None:
        for pos in ("BIFACIAL", "BSI", "BNBI"):
            tol = POSITION_TOLERANCES[pos]
            assert tol.clause.startswith("MQT 11.6.")
            assert tol.label
            assert tol.max_ramp_c_per_h > 0
            assert tol.warn_ramp_c_per_h >= tol.max_ramp_c_per_h
            assert tol.temp_tolerance_c > 0

    def test_bifacial_symmetric_baseline(self) -> None:
        tol = POSITION_TOLERANCES["BIFACIAL"]
        assert tol.max_ramp_c_per_h == 100.0
        assert tol.warn_ramp_c_per_h == 120.0
        assert tol.temp_tolerance_c == 2.0

    def test_bsi_tightens_the_ramp(self) -> None:
        tol = POSITION_TOLERANCES["BSI"]
        assert tol.max_ramp_c_per_h == 90.0
        assert tol.warn_ramp_c_per_h == 110.0
        assert tol.temp_tolerance_c == 2.0

    def test_bnbi_relaxes_the_plateau_band(self) -> None:
        tol = POSITION_TOLERANCES["BNBI"]
        assert tol.max_ramp_c_per_h == 100.0
        assert tol.warn_ramp_c_per_h == 120.0
        assert tol.temp_tolerance_c == 3.0

    def test_positions_are_distinct(self) -> None:
        assert (
            POSITION_TOLERANCES["BSI"].max_ramp_c_per_h
            != POSITION_TOLERANCES["BIFACIAL"].max_ramp_c_per_h
        )
        assert (
            POSITION_TOLERANCES["BNBI"].temp_tolerance_c
            != POSITION_TOLERANCES["BIFACIAL"].temp_tolerance_c
        )

    def test_resolver_returns_matching_set(self) -> None:
        assert position_tolerance_set("BSI") is POSITION_TOLERANCES["BSI"]
        assert position_tolerance_set("BNBI") is POSITION_TOLERANCES["BNBI"]

    def test_resolver_falls_back_to_bifacial(self) -> None:
        assert position_tolerance_set("LEGACY") is POSITION_TOLERANCES["BIFACIAL"]


class TestMassLoading:
    """MQT 11 mounting / mass-loading — must be a finite, positive figure."""

    def test_positive_passes_through(self) -> None:
        assert validate_mass_loading(2.5) == 2.5
        assert validate_mass_loading(0.05) == 0.05

    def test_zero_rejected(self) -> None:
        with pytest.raises(ValueError):
            validate_mass_loading(0.0)

    def test_negative_rejected(self) -> None:
        with pytest.raises(ValueError):
            validate_mass_loading(-1.0)

    def test_non_finite_rejected(self) -> None:
        with pytest.raises(ValueError):
            validate_mass_loading(float("nan"))
        with pytest.raises(ValueError):
            validate_mass_loading(float("inf"))


def _sample(ts_ms: float, temp_c: float) -> tuple[float, float]:
    return (ts_ms, temp_c)


class TestPointToPointRamp:
    """MQT 11.6.2 — instantaneous worst ramp."""

    def test_under_two_samples_is_zero(self) -> None:
        assert point_to_point_ramp([]) == 0.0
        assert point_to_point_ramp([_sample(0, 25)]) == 0.0

    def test_worst_consecutive_ramp(self) -> None:
        # +1 °C in 36 s = 100 °C/h, then +2 °C in 36 s = 200 °C/h (worst).
        samples = [_sample(0, 0), _sample(36_000, 1), _sample(72_000, 3)]
        assert point_to_point_ramp(samples) == pytest.approx(200.0)

    def test_sign_agnostic(self) -> None:
        # −1 °C in 36 s → magnitude 100 °C/h.
        assert point_to_point_ramp([_sample(0, 0), _sample(36_000, -1)]) == pytest.approx(100.0)

    def test_skips_non_advancing_time(self) -> None:
        # The dt=0 pair (same timestamp) is skipped; only the advancing
        # 0→1 °C over 36 s = 100 °C/h pair contributes.
        samples = [_sample(0, 0), _sample(0, 0), _sample(36_000, 1)]
        assert point_to_point_ramp(samples) == pytest.approx(100.0)


class TestCumulativeRamp:
    """MQT 11.6.2 — run-averaged ramp."""

    def test_under_two_samples_is_zero(self) -> None:
        assert cumulative_ramp([]) == 0.0
        assert cumulative_ramp([_sample(0, 25)]) == 0.0

    def test_averages_total_travel_over_time(self) -> None:
        # +1 °C then +1 °C over 72 s = 2 °C / 0.02 h = 100 °C/h.
        samples = [_sample(0, 0), _sample(36_000, 1), _sample(72_000, 2)]
        assert cumulative_ramp(samples) == pytest.approx(100.0)

    def test_sums_absolute_travel(self) -> None:
        # 0→1→0 °C over 72 s = 2 °C of |travel| / 0.02 h = 100 °C/h.
        samples = [_sample(0, 0), _sample(36_000, 1), _sample(72_000, 0)]
        assert cumulative_ramp(samples) == pytest.approx(100.0)

    def test_differs_from_point_to_point(self) -> None:
        # slow 50 then fast 150 → p2p=150, cumulative strictly between.
        samples = [_sample(0, 0), _sample(72_000, 1), _sample(108_000, 2.5)]
        p2p = point_to_point_ramp(samples)
        cum = cumulative_ramp(samples)
        assert p2p == pytest.approx(150.0)
        assert 0 < cum < p2p


class TestClassifyRampForPosition:
    """Verdict labels match the frontend RampVerdict (minus 'pending')."""

    def test_pass_warn_fail_bands(self) -> None:
        tol = POSITION_TOLERANCES["BSI"]  # 90 / 110
        assert classify_ramp_for_position(89.0, tol) == "pass"
        assert classify_ramp_for_position(90.0, tol) == "pass"
        assert classify_ramp_for_position(95.0, tol) == "warn"
        assert classify_ramp_for_position(110.0, tol) == "warn"
        assert classify_ramp_for_position(111.0, tol) == "fail"

    def test_same_ramp_differs_across_positions(self) -> None:
        # 95 °C/h: pass under BIFACIAL (≤100), warn under stricter BSI (>90).
        assert classify_ramp_for_position(95.0, POSITION_TOLERANCES["BIFACIAL"]) == "pass"
        assert classify_ramp_for_position(95.0, POSITION_TOLERANCES["BSI"]) == "warn"


class TestConstantsParityWithFrontend:
    """The shared ceilings must equal the frontend TC_CONSTANTS values."""

    def test_ceiling_and_warn_band(self) -> None:
        # frontend TC_CONSTANTS.MAX_RAMP_C_PER_H / RAMP_WARN_C_PER_H.
        assert MQT11_MAX_RAMP_C_PER_H == 100.0
        assert MQT11_WARN_RAMP_C_PER_H == 120.0
