"""LeTID orchestrator tests — IEC TS 63342: DEMO synth, verdict threshold,
checkpoint idempotency, resume, and the LIVE guard. No IV code imported."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.letid import (  # noqa: E402
    DEFAULT_CHECKPOINTS_H, DEFAULT_DURATION_H, LetidSession,
    degradation, run_demo, synth_pmax, verdict,
)


def _session(tmp_path, **kw):
    kw.setdefault("session_id", "LETID-1")
    kw.setdefault("injection_current_a", 10.0)
    kw.setdefault("pmax_initial", 300.0)
    return LetidSession(root=tmp_path, **kw)


def test_degradation_zero_at_start_and_floor_at_duration():
    assert degradation(0.0) == 0.0
    assert degradation(DEFAULT_DURATION_H) == pytest.approx(-0.03, abs=1e-9)
    series = [degradation(h) for h in range(0, int(DEFAULT_DURATION_H) + 1, 6)]
    assert all(b <= a + 1e-12 for a, b in zip(series, series[1:]))  # monotone decline


def test_verdict_threshold():
    assert verdict(300.0, 291.0)["verdict"] == "PASS"   # 0.970
    assert verdict(300.0, 285.0)["verdict"] == "PASS"   # 0.950 boundary
    assert verdict(300.0, 284.9)["verdict"] == "FAIL"   # 0.9497
    assert verdict(0.0, 0.0)["verdict"] == "FAIL"       # no baseline


def test_demo_verdict_uses_synth_values():
    # DEMO verdict composes synth Pmax: -3% floor -> ratio 0.97 -> PASS.
    out = verdict(synth_pmax(0.0, 300.0), synth_pmax(DEFAULT_DURATION_H, 300.0))
    assert out["verdict"] == "PASS" and out["ratio"] == pytest.approx(0.97, abs=1e-6)


def test_run_demo_emits_marker_per_checkpoint(tmp_path):
    session = _session(tmp_path)
    fresh = run_demo(session)
    assert len(fresh) == len(DEFAULT_CHECKPOINTS_H)
    lines = session.checkpoint_path().read_text().splitlines()
    assert len(lines) == len(DEFAULT_CHECKPOINTS_H)
    first = json.loads(lines[0])
    assert first["type"] == "letid_checkpoint"
    assert first["t_hours"] == 0.0
    assert first["marker_id"] == "LETID-1@0h"
    assert "pmax" not in first and "iv" not in first  # markers only


def test_checkpoint_emission_idempotent(tmp_path):
    session = _session(tmp_path)
    run_demo(session)
    assert run_demo(session) == []
    assert len(session.checkpoint_path().read_text().splitlines()) == len(DEFAULT_CHECKPOINTS_H)


def test_resume_skips_already_emitted(tmp_path):
    run_demo(_session(tmp_path, checkpoints_h=[0, 4]))                 # interrupted
    fresh = run_demo(_session(tmp_path, checkpoints_h=[0, 4, 8, 16]))  # resume
    assert [e["t_hours"] for e in fresh] == [8.0, 16.0]
    assert len(_session(tmp_path).checkpoint_path().read_text().splitlines()) == 4


def test_live_mode_not_implemented(tmp_path):
    with pytest.raises(NotImplementedError, match="LIVE LeTID"):
        run_demo(_session(tmp_path, demo=False))
