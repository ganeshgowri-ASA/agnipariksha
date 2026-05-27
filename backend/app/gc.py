"""Ground Continuity (GC) orchestrator — IEC 61730-2:2016 MST 13.

DEMO_MODE synthesizes R(t) ~ N(0.05, 0.005) Ω at 1 Hz for the requested
duration, records min/max/mean, and persists tests/gc/<sessionId>/data.csv.
LIVE is intentionally unimplemented (needs a Keysight 34465A 4-wire setup +
owner-at-bench confirmation). Verdict: PASS iff observed R_max <= threshold.
"""
from __future__ import annotations

import csv
import random
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from backend.config import get_settings

DEFAULT_TEST_CURRENT_A = 25.0
DEFAULT_DURATION_S = 120
DEFAULT_R_MAX_OHM = 0.1
_DEMO_R_MEAN = 0.05
_DEMO_R_SIGMA = 0.005
TESTS_ROOT = Path(__file__).resolve().parents[2] / "tests" / "gc"
CSV_HEADER = ["t_s", "resistance_ohm"]
DEMO_MODE = get_settings().DEMO_MODE


@dataclass
class GcResult:
    session_id: str
    test_current_a: float
    duration_s: int
    r_max_threshold: float
    bonding_point: str
    r_min: float
    r_max: float
    r_mean: float
    verdict: str  # "PASS" | "FAIL"
    csv_path: str
    demo: bool


def synth_series(duration_s: int, *, mean: float = _DEMO_R_MEAN,
                 sigma: float = _DEMO_R_SIGMA, rng: Optional[random.Random] = None) -> List[float]:
    """One resistance sample per second (1 Hz), clamped non-negative."""
    if duration_s <= 0:
        raise ValueError("duration_s must be > 0")
    gen = rng or random
    return [max(0.0, gen.gauss(mean, sigma)) for _ in range(int(duration_s))]


def verdict(r_max_observed: float, r_max_threshold: float) -> str:
    """MST 13 pass criterion — inclusive ceiling on the worst sample."""
    if r_max_threshold <= 0:
        return "FAIL"
    return "PASS" if r_max_observed <= r_max_threshold else "FAIL"


def _write_csv(path: Path, samples: List[float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(CSV_HEADER)
        writer.writerows([t, round(r, 6)] for t, r in enumerate(samples))


def run_gc(session_id: str, *, test_current_a: float = DEFAULT_TEST_CURRENT_A,
           duration_s: int = DEFAULT_DURATION_S, r_max_threshold: float = DEFAULT_R_MAX_OHM,
           bonding_point: str = "", demo: bool = DEMO_MODE,
           tests_root: Optional[Path] = None, rng: Optional[random.Random] = None) -> GcResult:
    """Run one Ground Continuity acquisition and persist its CSV."""
    if not demo:
        raise NotImplementedError(
            "LIVE GC requires Keysight 34465A 4-wire setup + owner-at-bench confirmation"
        )
    samples = synth_series(duration_s, rng=rng)
    r_max = max(samples)
    csv_path = (tests_root or TESTS_ROOT) / session_id / "data.csv"
    _write_csv(csv_path, samples)
    return GcResult(
        session_id=session_id, test_current_a=test_current_a, duration_s=int(duration_s),
        r_max_threshold=r_max_threshold, bonding_point=bonding_point,
        r_min=round(min(samples), 6), r_max=round(r_max, 6),
        r_mean=round(sum(samples) / len(samples), 6),
        verdict=verdict(r_max, r_max_threshold), csv_path=str(csv_path), demo=True,
    )
