"""Tests for the RCOT orchestrator (IEC 61730-2 MST 26) — demo-only.

Pins the three behaviours the safety story hinges on: thermal-abort logic,
verdict gating on the post-test manual checkbox, and enforcement of the
mandatory safety acknowledgements on Start. Also pins the LIVE path to
``NotImplementedError`` so a reverse-bias run can never execute here.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.rcot import (  # noqa: E402
    FAIL,
    LIVE_BLOCKED_MESSAGE,
    PASS,
    UNKNOWN,
    RcotParams,
    RcotSafetyError,
    compute_verdict,
    is_abort,
    overload_current_a,
    run,
    run_demo,
    validate_start,
)


def _ok(**kw) -> RcotParams:
    return RcotParams(**{**dict(fuse_rating_a=10.0, owner_at_bench=True, estop_wired=True), **kw})


# --- 1.35x overload current --------------------------------------------------

def test_overload_current_is_135pct_of_fuse() -> None:
    assert overload_current_a(10.0) == 13.5
    assert overload_current_a(20.0) == 27.0
    assert _ok(fuse_rating_a=15.0).test_current_a == 20.25


# --- abort logic -------------------------------------------------------------

def test_is_abort_threshold_is_strict() -> None:
    assert is_abort(200.1, 200.0) is True
    assert is_abort(200.0, 200.0) is False  # at threshold is not an abort
    assert is_abort(95.0, 200.0) is False


def test_run_demo_nominal_never_aborts() -> None:
    # Default 40->95 C ramp stays well under the 200 C Tj threshold.
    res = run_demo(_ok(), seed=1)
    assert res.aborted is False and res.abort_event is None
    assert res.peak_temp_c < 200.0


def test_run_demo_aborts_when_threshold_crossed() -> None:
    # A 60 C abort threshold sits inside the 40->95 C ramp, so the run trips.
    res = run_demo(_ok(tj_abort_c=60.0), seed=1)
    assert res.aborted is True
    assert res.abort_event is not None and res.abort_event.temp_c > 60.0
    assert res.verdict == FAIL  # an abort is a conclusive FAIL


def test_run_demo_logs_a_sample_every_interval() -> None:
    res = run_demo(_ok(duration_h=1.0, log_interval_s=10.0), seed=3)
    assert len(res.samples) == int(3600 // 10) + 1  # one sample per 10 s soak step


# --- verdict gating on the manual checkbox -----------------------------------

def test_verdict_gating() -> None:
    assert compute_verdict(aborted=False, manual_pass=None) == UNKNOWN   # default
    assert compute_verdict(aborted=False, manual_pass=True) == PASS      # both conditions
    assert compute_verdict(aborted=False, manual_pass=False) == FAIL     # operator saw damage
    assert compute_verdict(aborted=True, manual_pass=None) == FAIL       # abort overrides
    assert compute_verdict(aborted=True, manual_pass=True) == FAIL       # abort overrides


def test_run_demo_verdict_flips_to_pass_with_manual_ack() -> None:
    assert run_demo(_ok(), seed=2).verdict == UNKNOWN
    assert run_demo(_ok(), manual_pass=True, seed=2).verdict == PASS


# --- safety-checkbox enforcement on Start ------------------------------------

def test_validate_start_requires_both_safety_acks() -> None:
    with pytest.raises(RcotSafetyError, match="owner-at-bench"):
        validate_start(_ok(owner_at_bench=False))
    with pytest.raises(RcotSafetyError, match="E-stop"):
        validate_start(_ok(estop_wired=False))


def test_run_demo_refuses_to_start_without_safety_acks() -> None:
    with pytest.raises(RcotSafetyError):
        run_demo(RcotParams(fuse_rating_a=10.0))  # both acks default False


def test_validate_start_rejects_out_of_range_params() -> None:
    for bad in (
        _ok(fuse_rating_a=4.0),   # below 5 A
        _ok(fuse_rating_a=31.0),  # above 30 A
        _ok(duration_h=0.5),      # below 1.0 h
        _ok(duration_h=3.0),      # above 2.5 h
        _ok(ambient_c=35.0),      # below 40 C floor
    ):
        with pytest.raises(ValueError):
            validate_start(bad)


# --- LIVE is hard-blocked ----------------------------------------------------

def test_run_blocks_live() -> None:
    with pytest.raises(NotImplementedError) as exc:
        run(_ok(), demo=False)
    assert str(exc.value) == LIVE_BLOCKED_MESSAGE
