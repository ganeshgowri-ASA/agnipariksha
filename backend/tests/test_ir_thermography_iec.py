"""IEC TS 60904-12 contract tests for the IR thermography helpers.

These pin the temperature-distribution math the operator dashboard
relies on: grid statistics, hot-spot detection (cells above the grid
mean by more than the delta-T threshold), and histogram binning. The
frontend mirrors the same math in
``frontend/features/iir/analysis/heatmap.ts``; the two MUST agree.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make ``backend`` importable in CI where pytest runs from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_programs.ir_thermography import (  # noqa: E402
    HOTSPOT_DELTA_T_C,
    grid_stats,
    histogram,
    hotspot_cells,
)

# A known 3×3 grid: values 10..90 step 10 (mean 50).
KNOWN = [
    [10, 20, 30],
    [40, 50, 60],
    [70, 80, 90],
]


def uniform_grid(rows: int, cols: int, value: float) -> list[list[float]]:
    return [[value] * cols for _ in range(rows)]


class TestGridStats:
    def test_known_grid(self) -> None:
        s = grid_stats(KNOWN)
        assert s.min == 10
        assert s.max == 90
        assert s.mean == 50
        assert s.count == 9
        # population std of 10..90 step 10 = sqrt(6000/9) ≈ 25.8199
        assert s.std == pytest.approx(25.8199, abs=1e-3)

    def test_empty_grid(self) -> None:
        s = grid_stats([])
        assert (s.min, s.max, s.mean, s.std, s.count) == (0.0, 0.0, 0.0, 0.0, 0)

    def test_uniform_grid_zero_std(self) -> None:
        s = grid_stats(uniform_grid(4, 4, 42))
        assert s.mean == 42
        assert s.std == 0
        assert s.count == 16


class TestHotspotCells:
    def test_flags_cells_above_mean_plus_delta_sorted(self) -> None:
        # mean 50; ΔT=10 → threshold >60 → cells 70/80/90.
        cells = hotspot_cells(KNOWN, 10)
        assert len(cells) == 3
        assert [c.temp for c in cells] == [90, 80, 70]  # hottest first
        assert cells[0].delta_t == 40  # 90 - 50
        assert (cells[0].row, cells[0].col) == (2, 2)

    def test_default_threshold_is_iec_constant(self) -> None:
        assert hotspot_cells(KNOWN) == hotspot_cells(KNOWN, HOTSPOT_DELTA_T_C)

    def test_uniform_grid_flags_nothing(self) -> None:
        assert hotspot_cells(uniform_grid(5, 5, 30), 1) == []

    def test_stricter_threshold(self) -> None:
        # ΔT=35 → only cells >85 → just 90.
        cells = hotspot_cells(KNOWN, 35)
        assert len(cells) == 1
        assert cells[0].temp == 90


class TestHistogram:
    def test_counts_sum_to_cell_count(self) -> None:
        bins = histogram(KNOWN, 4)
        assert len(bins) == 4
        assert sum(b.count for b in bins) == 9  # every cell counted once
        assert bins[0].start == 10
        assert bins[-1].end == 90

    def test_all_equal_grid_single_bin(self) -> None:
        bins = histogram(uniform_grid(3, 3, 25), 8)
        assert len(bins) == 1
        assert bins[0].count == 9
        assert bins[0].start == bins[0].end == 25

    def test_max_value_lands_in_last_bin(self) -> None:
        bins = histogram(KNOWN, 9)
        assert sum(b.count for b in bins) == 9
        assert bins[-1].count >= 1  # 90 lands here

    def test_non_positive_bins_clamped_to_one(self) -> None:
        bins = histogram(KNOWN, 0)
        assert len(bins) == 1
        assert bins[0].count == 9

    def test_empty_grid_no_bins(self) -> None:
        assert histogram([], 8) == []
