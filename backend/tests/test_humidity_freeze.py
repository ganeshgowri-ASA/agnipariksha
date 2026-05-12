"""Pytest coverage for IEC 61215-2 MQT 12 Humidity Freeze orchestrator.

These tests run the full Figure 9 profile under accelerated time
compression so the suite stays under a second.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.tests.humidity_freeze import (  # noqa: E402
    COLD_DWELL_MIN_MINUTES,
    HFConfig,
    HOT_DWELL_MIN_HOURS,
    HumidityFreezeRunner,
    MIN_BIAS_CURRENT_A,
    analyse_profile,
    generate_figure9_profile,
    grade,
    mqt01_visual_stub,
    mqt15_wet_leakage_stub,
)
from backend.app.tests.humidity_freeze import DwellCheck, HFResult, RampViolation  # noqa: E402
from backend.main import app  # noqa: E402


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def test_bias_current_floor_is_100_mA() -> None:
    # 0.5% of 1 A Imp = 5 mA -> clamps to 100 mA floor
    cfg = HFConfig(i_mp_stc_a=1.0)
    assert cfg.bias_current_a() == pytest.approx(MIN_BIAS_CURRENT_A)


def test_bias_current_scales_with_imp() -> None:
    # 0.5% of 25 A Imp = 125 mA -> exceeds floor, scales
    cfg = HFConfig(i_mp_stc_a=25.0)
    assert cfg.bias_current_a() == pytest.approx(0.125)


def test_profile_has_all_four_phases_each_cycle() -> None:
    cfg = HFConfig(cycles=3, time_compression=600.0)
    samples = generate_figure9_profile(cfg, sample_interval_s=30.0)
    by_phase = {(s.cycle, s.phase) for s in samples}
    for c in (1, 2, 3):
        for ph in ("hot_dwell", "ramp_down", "cold_dwell", "ramp_up"):
            assert (c, ph) in by_phase, f"missing {(c, ph)}"


def test_hot_dwell_holds_85c_85rh_within_tolerance() -> None:
    cfg = HFConfig(cycles=1, time_compression=600.0)
    samples = generate_figure9_profile(cfg, sample_interval_s=30.0)
    hot = [s for s in samples if s.phase == "hot_dwell"]
    assert hot, "no hot-dwell samples"
    assert all(abs(s.temperature_c - 85.0) <= 2.0 for s in hot)
    assert all(abs(s.rh_percent - 85.0) <= 5.0 for s in hot)


def test_ramp_down_does_not_exceed_200_c_per_hour() -> None:
    cfg = HFConfig(cycles=1, time_compression=600.0)
    samples = generate_figure9_profile(cfg, sample_interval_s=30.0)
    violations, _, _ = analyse_profile(samples, cfg)
    assert not violations, f"unexpected violations: {violations}"


def test_analyse_flags_too_fast_ramp() -> None:
    cfg = HFConfig(cycles=1, time_compression=600.0)
    samples = generate_figure9_profile(cfg, sample_interval_s=30.0)
    # Tighten ramp limit so the synthesized profile is now "too fast".
    strict = HFConfig(cycles=1, time_compression=600.0,
                      max_ramp_down_c_per_h=10.0, max_ramp_up_c_per_h=10.0)
    violations, _, _ = analyse_profile(samples, strict)
    assert violations, "expected violations under tight limits"
    assert any(v.phase == "ramp_down" for v in violations)


def test_dwell_check_passes_at_default_config() -> None:
    cfg = HFConfig(cycles=2, time_compression=600.0)
    samples = generate_figure9_profile(cfg, sample_interval_s=30.0)
    _, dwells, _ = analyse_profile(samples, cfg)
    hot_dwells = [d for d in dwells if d.phase == "hot_dwell"]
    cold_dwells = [d for d in dwells if d.phase == "cold_dwell"]
    assert len(hot_dwells) == 2 and all(d.ok for d in hot_dwells)
    assert len(cold_dwells) == 2 and all(d.ok for d in cold_dwells)
    assert hot_dwells[0].minimum_s == pytest.approx(HOT_DWELL_MIN_HOURS * 3600.0)
    assert cold_dwells[0].minimum_s == pytest.approx(COLD_DWELL_MIN_MINUTES * 60.0)


def _clean_result(cfg: HFConfig) -> HFResult:
    res = HFResult(session_id="x", started_at=0.0)
    for c in range(1, cfg.cycles + 1):
        res.dwell_checks.append(DwellCheck(
            cycle=c, phase="hot_dwell",
            duration_s=cfg.hot_dwell_hours * 3600,
            minimum_s=cfg.hot_dwell_hours * 3600,
            in_tolerance=True, ok=True,
        ))
        res.dwell_checks.append(DwellCheck(
            cycle=c, phase="cold_dwell",
            duration_s=cfg.cold_dwell_minutes * 60,
            minimum_s=cfg.cold_dwell_minutes * 60,
            in_tolerance=True, ok=True,
        ))
    return res


def test_grade_pass_when_clean() -> None:
    cfg = HFConfig()
    res = _clean_result(cfg)
    grade(res, cfg)
    assert res.verdict == "PASS", res.reasons
    assert res.reasons == []


def test_grade_fails_with_ramp_violations() -> None:
    cfg = HFConfig()
    res = _clean_result(cfg)
    res.ramp_violations.append(RampViolation(cycle=1, phase="ramp_down",
                                             rate_c_per_h=400.0, limit_c_per_h=200.0))
    grade(res, cfg)
    assert res.verdict == "FAIL"
    assert any("ramp" in r for r in res.reasons)


def test_mqt_stubs() -> None:
    assert mqt01_visual_stub() is True
    assert mqt01_visual_stub(False) is False
    # Default returns True (no measurement supplied)
    assert mqt15_wet_leakage_stub() is True
    # 40 MOhm.m2 threshold with 1.6 m2 module needs 25 MOhm minimum
    assert mqt15_wet_leakage_stub(measured_resistance_mohm=30.0, area_m2=1.6) is True
    assert mqt15_wet_leakage_stub(measured_resistance_mohm=10.0, area_m2=1.6) is False


# ---------------------------------------------------------------------------
# Runner integration -- runs the full simulator end-to-end
# ---------------------------------------------------------------------------

def test_runner_full_demo_passes_under_compression(tmp_path) -> None:
    cfg = HFConfig(cycles=10, time_compression=600.0)
    runner = HumidityFreezeRunner(scpi=None, cfg=cfg, raw_csv_dir=str(tmp_path))
    result = asyncio.run(runner.run())
    assert result.verdict == "PASS", result.reasons
    assert len(result.cycle_log) == 10
    assert result.raw_csv_path is not None
    assert Path(result.raw_csv_path).exists()
    # CSV header + at least one row per cycle.
    text = Path(result.raw_csv_path).read_text()
    assert "temperature_c" in text.splitlines()[0]
    assert len(text.splitlines()) > 10


# ---------------------------------------------------------------------------
# FastAPI HTTP surface
# ---------------------------------------------------------------------------

def test_http_profile_endpoint() -> None:
    with TestClient(app) as c:
        r = c.post("/api/tests/humidity-freeze/profile",
                   json={"cycles": 2, "time_compression": 600.0})
        assert r.status_code == 200
        body = r.json()
        assert body["cycles"] == 2
        assert body["bias_current_a"] >= MIN_BIAS_CURRENT_A
        assert "MQT 12" in body["iec_clause"]
        assert len(body["profile"]) > 8


def test_http_run_endpoint_returns_verdict() -> None:
    with TestClient(app) as c:
        r = c.post("/api/tests/humidity-freeze/run",
                   json={"cycles": 1, "time_compression": 600.0})
        assert r.status_code == 200
        body = r.json()
        assert body["verdict"] in {"PASS", "FAIL"}
        assert body["iec_clause"].startswith("IEC 61215-2")
        assert len(body["cycle_log"]) == 1


def test_http_analyse_endpoint_grades_uploaded_profile() -> None:
    cfg = HFConfig(cycles=1, time_compression=600.0)
    samples = generate_figure9_profile(cfg, sample_interval_s=30.0)
    payload = {
        "config": {"cycles": 1, "time_compression": 600.0},
        "profile": [
            {"t_s": s.t_s, "cycle": s.cycle, "phase": s.phase,
             "temperature_c": s.temperature_c, "rh_percent": s.rh_percent,
             "bias_current_a": s.bias_current_a}
            for s in samples
        ],
    }
    with TestClient(app) as c:
        r = c.post("/api/tests/humidity-freeze/analyse", json=payload)
        assert r.status_code == 200
        body = r.json()
        assert body["verdict"] == "PASS"
        assert body["ramp_violations"] == []
