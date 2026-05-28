"""Unit tests for the Equipotential Bonding (EB) orchestrator.

Focus per the spec: pair generation and verdict aggregation
(IEC 61730-2 MST 13), plus the demo/live run guards.
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.eb import (  # noqa: E402
    DEFAULT_TEST_CURRENT_A,
    EbResult,
    PairResult,
    aggregate_verdict,
    generate_pairs,
    run_eb,
)


def _pair(i: int, j: int, r: float, thr: float = 0.1) -> PairResult:
    return PairResult(i=i, j=j, label_i=f"p{i}", label_j=f"p{j}",
                      resistance=r, passed=r < thr)


# --- pair generation -------------------------------------------------------

def test_generate_pairs_count_and_order() -> None:
    pairs = generate_pairs(4)
    assert pairs == [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
    assert len(pairs) == 4 * 3 // 2  # n(n-1)/2 unique unordered pairs
    assert all(i < j for i, j in pairs)


def test_generate_pairs_two_points() -> None:
    assert generate_pairs(2) == [(0, 1)]


def test_generate_pairs_requires_at_least_two() -> None:
    for n in (0, 1):
        with pytest.raises(ValueError):
            generate_pairs(n)


# --- verdict aggregation ---------------------------------------------------

def test_verdict_all_below_threshold_passes() -> None:
    pairs = [_pair(0, 1, 0.04), _pair(0, 2, 0.06), _pair(1, 2, 0.03)]
    passed, offending = aggregate_verdict(pairs)
    assert passed is True
    assert offending == []


def test_verdict_offenders_fail_and_are_listed() -> None:
    bad = _pair(0, 2, 0.15)
    pairs = [_pair(0, 1, 0.04), bad, _pair(1, 2, 0.30)]
    passed, offending = aggregate_verdict(pairs)
    assert passed is False
    assert [(p.label_i, p.label_j) for p in offending] == [("p0", "p2"), ("p1", "p2")]


def test_verdict_empty_is_not_pass() -> None:
    passed, offending = aggregate_verdict([])
    assert passed is False
    assert offending == []


# --- orchestrator ----------------------------------------------------------

def test_run_eb_demo_builds_symmetric_matrix_and_passes() -> None:
    random.seed(1234)
    res = run_eb(["NW", "NE", "SW", "SE"], demo=True, max_resistance=0.1)
    assert isinstance(res, EbResult)
    assert len(res.pairs) == 6
    assert res.test_current == DEFAULT_TEST_CURRENT_A
    m = res.matrix()
    assert len(m) == 4 and all(len(row) == 4 for row in m)
    for i in range(4):
        assert m[i][i] is None
        for j in range(i + 1, 4):
            assert m[i][j] is not None and m[i][j] == m[j][i]
    # ~0.05 Ω demo draws sit comfortably under the 0.1 Ω limit.
    assert res.passed is True
    assert res.offending == []


def test_run_eb_live_not_implemented() -> None:
    with pytest.raises(NotImplementedError):
        run_eb(["a", "b"], demo=False)


def test_run_eb_rejects_non_positive_threshold() -> None:
    with pytest.raises(ValueError):
        run_eb(["a", "b"], demo=True, max_resistance=0)
