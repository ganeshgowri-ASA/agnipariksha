"""Equipotential Bonding (EB) orchestrator — IEC 61730-2 MST 13.

Companion to Ground Continuity (GCT): GCT checks each exposed part against
the protective-earth terminal; EB checks the parts are bonded *to each
other* so they share one potential — no hazardous touch-voltage between any
two simultaneously accessible parts. The sweep walks every unique pair
(i, j), i < j, measuring 4-wire resistance via the shared GCT primitive
(no measurement code is duplicated). Verdict: PASS iff every pair < the
threshold (default 0.1 Ω), else FAIL listing the offending pairs.

DEMO_MODE draws each pair ~ Normal(0.05, 0.005) Ω. LIVE is intentionally
unimplemented — a real sweep needs a Keysight 34465A plus an operator
re-clipping the Kelvin leads between pairs.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from backend.app.gct import DEFAULT_MAX_RESISTANCE_OHM, GctSimulator, evaluate_pass

# EB demo distribution (Ω): an inter-part bond sits a touch above a direct
# ground strap — centre at 50 mΩ, tight spread, comfortably under 0.1 Ω.
DEMO_R_MEAN = 0.05
DEMO_R_SIGMA = 0.005

DEFAULT_TEST_CURRENT_A = 25.0
DEFAULT_DURATION_PER_PAIR_S = 120


def generate_pairs(n: int) -> list[tuple[int, int]]:
    """All unique unordered index pairs (i, j) with i < j for ``n`` points."""
    if n < 2:
        raise ValueError("equipotential bonding needs at least 2 points")
    return [(i, j) for i in range(n) for j in range(i + 1, n)]


def aggregate_verdict(pairs: list["PairResult"]) -> tuple[bool, list["PairResult"]]:
    """PASS iff there is at least one pair and none of them fail."""
    offending = [p for p in pairs if not p.passed]
    return (len(pairs) > 0 and not offending), offending


@dataclass
class PairResult:
    i: int
    j: int
    label_i: str
    label_j: str
    resistance: float
    passed: bool


@dataclass
class EbResult:
    labels: list[str]
    pairs: list[PairResult]
    max_resistance: float
    test_current: float
    duration_per_pair: int
    demo: bool

    @property
    def offending(self) -> list[PairResult]:
        return aggregate_verdict(self.pairs)[1]

    @property
    def passed(self) -> bool:
        return aggregate_verdict(self.pairs)[0]

    def matrix(self) -> list[list[Optional[float]]]:
        """Symmetric NxN resistance matrix; the diagonal (self-pair) is None."""
        n = len(self.labels)
        m: list[list[Optional[float]]] = [[None] * n for _ in range(n)]
        for p in self.pairs:
            m[p.i][p.j] = m[p.j][p.i] = round(p.resistance, 6)
        return m


def run_eb(
    labels: list[str],
    *,
    demo: bool = True,
    max_resistance: float = DEFAULT_MAX_RESISTANCE_OHM,
    test_current: float = DEFAULT_TEST_CURRENT_A,
    duration_per_pair: int = DEFAULT_DURATION_PER_PAIR_S,
) -> EbResult:
    """Sweep every unique point pair and return the aggregated EB verdict.

    DEMO_MODE draws each pair from the reusable GCT simulator
    (Normal(0.05, 0.005) Ω). LIVE acquisition is not implemented.
    """
    if max_resistance <= 0:
        raise ValueError("max_resistance must be > 0 Ω")
    if not demo:
        raise NotImplementedError("LIVE EB requires Keysight 34465A + owner-at-bench")

    sim = GctSimulator(mean=DEMO_R_MEAN, sigma=DEMO_R_SIGMA)
    pairs = [
        PairResult(
            i=i,
            j=j,
            label_i=labels[i],
            label_j=labels[j],
            resistance=(r := sim.sample()),
            passed=evaluate_pass(r, max_resistance),
        )
        for i, j in generate_pairs(len(labels))
    ]
    return EbResult(
        labels=list(labels),
        pairs=pairs,
        max_resistance=max_resistance,
        test_current=test_current,
        duration_per_pair=duration_per_pair,
        demo=demo,
    )
