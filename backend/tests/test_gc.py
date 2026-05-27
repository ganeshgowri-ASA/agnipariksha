"""GC orchestrator tests — verdict boundary, DEMO synth shape, CSV schema, LIVE guard."""
from __future__ import annotations

import csv
import random

import pytest

from backend.app.gc import CSV_HEADER, DEFAULT_R_MAX_OHM, GcResult, run_gc, synth_series, verdict


def test_verdict_boundary() -> None:
    assert verdict(0.05, 0.1) == "PASS"
    assert verdict(0.1, 0.1) == "PASS"  # inclusive ceiling: exactly at the limit passes
    assert verdict(0.1001, 0.1) == "FAIL"


def test_verdict_invalid_threshold() -> None:
    assert verdict(0.0, 0.0) == "FAIL"
    assert verdict(0.05, -1.0) == "FAIL"


def test_synth_series_shape_and_bounds() -> None:
    samples = synth_series(120, rng=random.Random(0))
    assert len(samples) == 120  # 1 Hz across the full duration
    assert all(r >= 0.0 for r in samples)
    assert 0.03 < sum(samples) / len(samples) < 0.07  # centered on the 0.05 Ω DEMO mean


def test_synth_series_rejects_nonpositive_duration() -> None:
    with pytest.raises(ValueError):
        synth_series(0)


def test_run_gc_csv_schema(tmp_path) -> None:
    res = run_gc("sess-1", duration_s=5, bonding_point="frame-corner-A",
                 demo=True, tests_root=tmp_path, rng=random.Random(0))
    assert isinstance(res, GcResult)
    assert res.csv_path == str(tmp_path / "sess-1" / "data.csv")
    with open(res.csv_path, newline="") as fh:
        rows = list(csv.reader(fh))
    assert rows[0] == CSV_HEADER
    body = rows[1:]
    assert [int(r[0]) for r in body] == [0, 1, 2, 3, 4]  # one row per second
    assert all(float(r[1]) >= 0.0 for r in body)
    assert res.r_min <= res.r_mean <= res.r_max
    assert res.r_max_threshold == DEFAULT_R_MAX_OHM
    assert res.verdict == "PASS"  # DEMO mean is well under the 0.1 Ω limit


def test_run_gc_live_raises() -> None:
    with pytest.raises(NotImplementedError, match="Keysight 34465A"):
        run_gc("sess-live", demo=False)
