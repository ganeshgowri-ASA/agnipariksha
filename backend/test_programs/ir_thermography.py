"""IR Thermography — IEC TS 60904-12 (forward-bias / inverted-IR).

Pure helpers for the temperature-distribution view: grid statistics,
hot-spot cell detection, and a histogram of the per-pixel temperatures.
These mirror the frontend math in
``frontend/features/iir/analysis/heatmap.ts`` so the bench (this module)
and the operator dashboard report the same distribution. Update both
files together when the standard revisions land.

No SCPI / hardware dependency — these are stateless functions over a
2-D, row-major temperature grid (``grid[row][col]`` in °C), the same
shape the frontend thermogram produces.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

# IEC TS 60904-12 thresholds — mirrored on the frontend
# (HEATMAP_CONSTANTS in heatmap.ts). The hot-spot delta-T over the grid
# mean (°C) flags cells significantly warmer than the module average
# under forward bias; 10 °C is the common operator default also used by
# the existing IIR verdict bands (DELTA_T_PASS).
HOTSPOT_DELTA_T_C = 10.0
# Default histogram bin count for the temperature distribution.
DEFAULT_BINS = 16

Grid = list[list[float]]


@dataclass(frozen=True)
class GridStats:
    """min / max / mean / population-std over every cell of the grid."""

    min: float
    max: float
    mean: float
    std: float
    count: int


@dataclass(frozen=True)
class HotspotCell:
    row: int
    col: int
    temp: float
    delta_t: float


@dataclass(frozen=True)
class HistogramBin:
    start: float
    end: float
    count: int


def _flatten(grid: Grid) -> list[float]:
    """Flatten a row-major grid into a single list of cell temperatures."""
    return [t for row in grid for t in row]


def grid_stats(grid: Grid) -> GridStats:
    """min / max / mean / population-std over every cell of the grid.

    Returns all-zero stats for an empty grid so callers stay branch-free,
    matching the frontend ``gridStats``.
    """
    values = _flatten(grid)
    count = len(values)
    if count == 0:
        return GridStats(min=0.0, max=0.0, mean=0.0, std=0.0, count=0)

    lo = min(values)
    hi = max(values)
    mean = sum(values) / count
    var = sum((t - mean) ** 2 for t in values) / count  # population variance
    return GridStats(min=lo, max=hi, mean=mean, std=math.sqrt(var), count=count)


def hotspot_cells(grid: Grid, delta_t: float = HOTSPOT_DELTA_T_C) -> list[HotspotCell]:
    """Cells whose temperature exceeds (grid mean + delta_t).

    Defaults to the IEC TS 60904-12 hot-spot threshold. Returned sorted
    hottest-first so callers can take the worst cells without re-sorting.
    """
    mean = grid_stats(grid).mean
    out: list[HotspotCell] = []
    for r, row in enumerate(grid):
        for c, temp in enumerate(row):
            d_t = temp - mean
            if d_t > delta_t:
                out.append(HotspotCell(row=r, col=c, temp=temp, delta_t=d_t))
    out.sort(key=lambda cell: cell.delta_t, reverse=True)
    return out


def histogram(grid: Grid, bins: int = DEFAULT_BINS) -> list[HistogramBin]:
    """Partition the grid temperatures into ``bins`` equal-width buckets.

    The bin counts always sum to the cell count. A degenerate grid (all
    cells equal, so min == max) collapses to a single populated bin.
    ``bins`` is clamped to >= 1. Returns an empty list for an empty grid.
    The right edge of the last bin is inclusive so the max value is
    counted — matching the frontend ``histogram``.
    """
    values = _flatten(grid)
    if not values:
        return []

    n = max(1, int(bins))
    stats = grid_stats(grid)
    lo, hi = stats.min, stats.max

    if hi == lo:
        return [HistogramBin(start=lo, end=hi, count=len(values))]

    width = (hi - lo) / n
    counts = [0] * n
    for t in values:
        idx = int((t - lo) / width)
        if idx >= n:
            idx = n - 1
        elif idx < 0:
            idx = 0
        counts[idx] += 1

    return [
        HistogramBin(
            start=lo + i * width,
            end=hi if i == n - 1 else lo + (i + 1) * width,
            count=counts[i],
        )
        for i in range(n)
    ]
