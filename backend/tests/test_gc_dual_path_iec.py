"""IEC 61730-2 MST 13 dual-path contract tests for the GC orchestrator.

These pin the parity invariants the frontend mirrors in
``frontend/features/gct/analysis/dualPath.ts``: the per-path resistance
limit (R < 0.1 Ω), the frame-current tolerance band (25 A ± band) and the
composite verdict (NON-CONFORM if either path OR the current is out of
spec). The two MUST agree.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make ``backend`` importable in CI where pytest runs from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_programs.ground_continuity import (  # noqa: E402
    FRAME_CURRENT_MAX_A,
    FRAME_CURRENT_MIN_A,
    GC_CONTEXTS,
    MST13_MAX_R_OHM,
    NOMINAL_FRAME_CURRENT_A,
    dual_path_verdict,
    frame_current_in_band,
    path_resistance_verdict,
)


class TestPathResistanceVerdict:
    """MST 13 — R between a conductive part and ground shall be < 0.1 Ω."""

    def test_below_limit_conforms(self) -> None:
        assert path_resistance_verdict(0.0) == "conform"
        assert path_resistance_verdict(0.042) == "conform"
        assert path_resistance_verdict(0.099) == "conform"

    def test_boundary_is_non_conform(self) -> None:
        # Strictly less-than, so exactly 0.1 Ω fails (extra margin).
        assert path_resistance_verdict(MST13_MAX_R_OHM) == "non-conform"
        assert path_resistance_verdict(0.1) == "non-conform"

    def test_above_limit_is_non_conform(self) -> None:
        assert path_resistance_verdict(0.1001) == "non-conform"
        assert path_resistance_verdict(0.5) == "non-conform"

    def test_impossible_reading_is_non_conform(self) -> None:
        assert path_resistance_verdict(-0.01) == "non-conform"
        assert path_resistance_verdict(float("nan")) == "non-conform"
        assert path_resistance_verdict(float("inf")) == "non-conform"


class TestFrameCurrentInBand:
    """MST 13 — injected frame current within ± band of the 25 A nominal."""

    def test_band_bounds(self) -> None:
        # 25 A ± 10% → [22.5, 27.5] (float-tolerant: 25*1.1 is not exact)
        assert FRAME_CURRENT_MIN_A == pytest.approx(22.5)
        assert FRAME_CURRENT_MAX_A == pytest.approx(27.5)

    def test_nominal_and_inside_band_inclusive(self) -> None:
        assert frame_current_in_band(NOMINAL_FRAME_CURRENT_A) is True
        assert frame_current_in_band(25.0) is True
        assert frame_current_in_band(FRAME_CURRENT_MIN_A) is True
        assert frame_current_in_band(FRAME_CURRENT_MAX_A) is True

    def test_just_outside_band(self) -> None:
        assert frame_current_in_band(FRAME_CURRENT_MIN_A - 0.01) is False
        assert frame_current_in_band(FRAME_CURRENT_MAX_A + 0.01) is False
        assert frame_current_in_band(0.0) is False
        assert frame_current_in_band(40.0) is False

    def test_non_finite_out_of_band(self) -> None:
        assert frame_current_in_band(float("nan")) is False
        assert frame_current_in_band(float("inf")) is False


class TestDualPathVerdict:
    """MST 13 — composite verdict over shortest + longest path + current."""

    def test_pending_until_all_inputs_present(self) -> None:
        assert dual_path_verdict(None, None, None) == "pending"
        assert dual_path_verdict(0.04, None, 25.0) == "pending"
        assert dual_path_verdict(0.04, 0.08, None) == "pending"
        assert dual_path_verdict(None, 0.08, 25.0) == "pending"

    def test_conform_when_both_paths_and_current_ok(self) -> None:
        assert dual_path_verdict(0.038, 0.094, 25.0) == "conform"
        assert dual_path_verdict(0.099, 0.099, 27.5) == "conform"

    def test_non_conform_when_longest_path_at_or_above_limit(self) -> None:
        assert dual_path_verdict(0.04, 0.1, 25.0) == "non-conform"
        assert dual_path_verdict(0.04, 0.25, 25.0) == "non-conform"

    def test_non_conform_when_shortest_path_at_or_above_limit(self) -> None:
        assert dual_path_verdict(0.1, 0.05, 25.0) == "non-conform"

    def test_non_conform_when_current_out_of_band(self) -> None:
        # Both paths pass, but the injected current invalidates the run.
        assert dual_path_verdict(0.04, 0.08, 10.0) == "non-conform"
        assert dual_path_verdict(0.04, 0.08, 30.0) == "non-conform"


class TestGcContexts:
    """Cross-cutting attribution contexts (COP / DPTT / LeTID / IDD)."""

    def test_exact_contexts_in_order(self) -> None:
        assert GC_CONTEXTS == ("COP", "DPTT", "LeTID", "IDD")
